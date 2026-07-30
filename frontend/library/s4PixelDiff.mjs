// frontend/library/s4PixelDiff.mjs (커밋)
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { LIGHT_DIFF_MASKS } from './s4Spec.mjs';
import { validateMaskContract } from './s4Evaluator.mjs';   // 정적 결속 — 주입 금지(no-op validator 우회 폐쇄)
export { LIGHT_DIFF_MASKS } from './s4Spec.mjs';   // 단일 원천은 s4Spec — 여기서 재정의하지 않는다
export function fillRects(png, rects, scale = 1) {   // 양쪽 이미지 동일 좌표를 단색으로 덮는다
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x * scale)), y0 = Math.max(0, Math.floor(r.y * scale));
    const x1 = Math.min(png.width, Math.ceil((r.x + r.width) * scale));
    const y1 = Math.min(png.height, Math.ceil((r.y + r.height) * scale));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (png.width * y + x) << 2;
      png.data[i] = 0; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255;
    }
  }
  return png;
}
export function diffPng(baseBuf, afterBuf, rects, scale = 1) {
  const a = PNG.sync.read(baseBuf), b = PNG.sync.read(afterBuf);
  if (a.width !== b.width || a.height !== b.height)
    return { ok: false, reason: `SIZE ${a.width}x${a.height} vs ${b.width}x${b.height}`, diff: -1 };
  fillRects(a, rects, scale); fillRects(b, rects, scale);
  const out = new PNG({ width: a.width, height: a.height });
  const diff = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0, includeAA: true });
  return { ok: diff === 0, diff, png: out };
}

// ── validated context → 실제 pixel diff 소비 단일 경로 ────────────────────────
// Task 6은 diffPng에 rect를 직접 넘기지 않는다. 아래 단일 진입점만 쓴다.
// 내부에서 (1) 마스크 계약 검증 (2) 관측값 검증 (3) 동결 paintRect 추출 (4) diffPng 순으로 실행한다.
// 이전 판은 "generator가 예전에 검증했을 것"이라는 시간적 결합이라, 임의 context를 넘기면
// border rect 1x1 + 화면 전체 paintRect 같은 조합이 모든 회귀를 덮고 GREEN이 됐다.

// 동결 context에서 한 surface의 마스크 rect를 뽑는다. 반드시 paintRect를 쓴다(border rect 금지).
export function maskRectsForSurface(ctx, surfaceName) {
  const bysel = (ctx.baseLightMaskRects || {})[surfaceName] || {};
  const out = [];
  for (const [selector, rects] of Object.entries(bysel))
    for (const r of rects) {
      if (!r || !r.paintRect) throw new Error(`MASK_PAINT_MISSING ${surfaceName} ${selector}`);
      out.push({ selector, ...r.paintRect });
    }
  return out;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// 좌표는 1/64 CSS px로 양자화한 뒤 **exact** 비교한다. 임의 허용오차(0.01)는 0.005 이동을
// 통과시켰다 — 캡처 시점에 같은 규칙으로 정규화하면 오차 허용 자체가 필요 없다.
export const QUANT = 64;
export const q = (v) => Math.round(v * QUANT) / QUANT;

// 관측값 검증 — observed는 **필수**다. 생략하면 occurrence·geometry 게이트가 통째로 우회된다.
// 값 누락 시 Number(undefined)=NaN 이고 `NaN > eps`가 false라 조용히 통과하던 구멍도 함께 막는다.
export function validateObserved(ctx, surfaceName, observed, masks) {
  const errors = [];
  if (observed === undefined || observed === null || typeof observed !== 'object' || Array.isArray(observed)) {
    errors.push(`OBSERVE_REQUIRED ${surfaceName}`);
    return errors;
  }
  const base = (ctx.baseLightMaskRects || {})[surfaceName] || {};
  const want = new Map(Object.values(masks).map((m) => [m.selector, m]));
  for (const sel of want.keys())
    if (!Object.prototype.hasOwnProperty.call(observed, sel)) errors.push(`OBSERVE_KEY_MISSING ${surfaceName} ${sel}`);
    else if (!Array.isArray(observed[sel])) errors.push(`OBSERVE_KEY_MISSING ${surfaceName} ${sel}`);
  for (const sel of Object.keys(observed)) if (!want.has(sel)) errors.push(`OBSERVE_EXTRA ${surfaceName} ${sel}`);
  for (const [sel, m] of want) {
    const obs = observed[sel];
    if (!Array.isArray(obs)) continue;
    const frozen = base[sel] || [];
    if (obs.length !== frozen.length) { errors.push(`OBSERVE_COUNT ${surfaceName} ${sel} ${obs.length}!=${frozen.length}`); continue; }
    for (let i = 0; i < frozen.length; i++) {
      const o = obs[i], f = frozen[i];
      if (!o || typeof o !== 'object') { errors.push(`OBSERVE_SHAPE ${surfaceName} ${sel}[${i}]`); continue; }
      for (const k of ['x', 'y', 'width', 'height', 'scale']) {
        if (!finite(o[k])) { errors.push(`OBSERVE_NONFINITE ${surfaceName} ${sel}[${i}] ${k}`); continue; }
        if (q(o[k]) !== q(f[k])) errors.push(`OBSERVE_GEOMETRY ${surfaceName} ${sel}[${i}] ${k}`);
      }
      if (finite(o.scale) && m.expectedScale !== undefined && q(o.scale) !== q(m.expectedScale))
        errors.push(`OBSERVE_SCALE_UNEXPECTED ${surfaceName} ${sel}[${i}] ${o.scale}!=${m.expectedScale}`);
    }
  }
  return errors;
}

// 단일 진입점. 마스크 계약 → 관측 → 동결 paintRect → diffPng 를 이 순서로만 통과시킨다.
// validator는 주입받지 않는다(정적 import). surfaceName은 manifest 소속 + context 보유를 강제한다.
export function diffSurfaceLight({ baseBuf, afterBuf, fixture, spec, context, surfaceName, observed }) {
  const errors = [];
  const names = new Set((spec.REQUIRED_SMOKE_SURFACES || []).map((x) => x.name));
  if (!names.has(surfaceName)) errors.push(`SURFACE_UNKNOWN ${surfaceName}`);
  if (!context || !Object.prototype.hasOwnProperty.call(context.baseLightMaskRects || {}, surfaceName))
    errors.push(`SURFACE_NOT_IN_CONTEXT ${surfaceName}`);
  if (errors.length) return { ok: false, diff: -1, reason: errors.join('; '), errors };
  errors.push(...validateMaskContract(fixture, spec, context));
  errors.push(...validateObserved(context, surfaceName, observed, spec.LIGHT_DIFF_MASKS || {}));
  if (errors.length) return { ok: false, diff: -1, reason: errors.slice(0, 5).join('; '), errors };
  const rects = maskRectsForSurface(context, surfaceName);
  const res = diffPng(baseBuf, afterBuf, rects);
  return { ...res, errors: [], maskCount: rects.length };
}
