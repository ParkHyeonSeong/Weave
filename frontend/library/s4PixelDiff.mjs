// frontend/library/s4PixelDiff.mjs (커밋)
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { LIGHT_DIFF_MASKS } from './s4Spec.mjs';
import { validateMaskContract, rectPixelBounds, plainJsonErrors,
  validateRasterContext, validatePngRaster, decodePngHeader, specFingerprint, snapshotSpec } from './s4Evaluator.mjs';   // 정적 결속 — 주입 금지(no-op validator 우회 폐쇄)
// sha256은 **주입받지 않는다**. 주입하면 `() => 동결값`으로 동일성 검사를 통째로 무력화할 수 있다
// (validator 주입 금지 철칙과 같은 이유). 이 모듈은 도구 전용이라 node:crypto를 정적으로 쓴다.
import { createHash } from 'node:crypto';
const sha256Hex = (v) => createHash('sha256').update(Buffer.isBuffer(v) ? v : Buffer.from(v)).digest('hex');
import { q, qs, crossCheckScale } from './s4DomProbe.mjs';
export { LIGHT_DIFF_MASKS } from './s4Spec.mjs';   // 단일 원천은 s4Spec — 여기서 재정의하지 않는다
export function fillRects(png, rects, scale = 1) {   // 양쪽 이미지 동일 좌표를 단색으로 덮는다
  for (const r of rects) {
    // 픽셀 범위 규칙은 evaluator가 정본 — 예산 검증(countMaskedPixels)과 같은 함수를 쓴다.
    const { x0, y0, x1, y1 } = rectPixelBounds(r, png.width, png.height, scale);
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
// 양자화 규칙은 committed probe가 정본이다. 여기서 다시 정의하면 두 격자가 갈라질 수 있다.
export { QUANT, q, SCALE_QUANT, qs } from './s4DomProbe.mjs';

// 관측값 검증 — observed는 **필수**다. 생략하면 occurrence·geometry 게이트가 통째로 우회된다.
// 값 누락 시 Number(undefined)=NaN 이고 `NaN > eps`가 false라 조용히 통과하던 구멍도 함께 막는다.
// spec을 그대로 받는다(masks만 받던 이전 판은 호출부가 spec과 다른 mask 테이블을 주입할 수 있어,
// 정본과 무관한 selector 집합으로 검사를 무력화할 수 있었다).
export function validateObserved(ctx, surfaceName, observed, spec) {
  const errors = [];
  const masks = (spec || {}).LIGHT_DIFF_MASKS || {};
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
      for (const k of ['x', 'y', 'width', 'height', 'borderBoxWidth', 'borderBoxHeight']) {
        if (!finite(o[k])) { errors.push(`OBSERVE_NONFINITE ${surfaceName} ${sel}[${i}] ${k}`); continue; }
        if (q(o[k]) !== q(f[k])) errors.push(`OBSERVE_GEOMETRY ${surfaceName} ${sel}[${i}] ${k}`);
      }
      for (const k of ['scale', 'transformScaleX', 'transformScaleY']) {
        if (!finite(o[k])) { errors.push(`OBSERVE_NONFINITE ${surfaceName} ${sel}[${i}] ${k}`); continue; }
        if (qs(o[k]) !== qs(f[k])) errors.push(`OBSERVE_GEOMETRY ${surfaceName} ${sel}[${i}] ${k}`);
      }
      // 배율은 selector 전역값이 아니라 (surface, selector)별 정본 표와 대조한다.
      // 이전 판은 `masks[*].expectedScale`(selector 하나당 한 값)을 봤고, 캔버스 4개 selector를
      // 전부 1로 선언한 상태에서 실측 0.5를 통과시켰다.
      const declared = ((spec.ELEMENT_SCALES || {})[surfaceName] || {})[sel];
      if (!finite(declared) || !(declared > 0)) errors.push(`OBSERVE_SCALE_UNDECLARED ${surfaceName} ${sel}`);
      else if (finite(o.scale) && qs(o.scale) !== qs(declared))
        errors.push(`OBSERVE_SCALE_UNEXPECTED ${surfaceName} ${sel}[${i}] ${o.scale}!=${declared}`);
      // 관측값 안에서도 두 독립 파생이 일치해야 한다 — 동결값과 같이 위조해도 여기서 걸린다.
      errors.push(...crossCheckScale(o).map((e) => `OBSERVE_${e} ${surfaceName} ${sel}[${i}]`));
    }
  }
  return errors;
}

// 단일 진입점.
//
// **입력은 raw bytes/문자열만 받는다.** 이전 판은 이미 파싱된 객체를 받았고, descriptor 기반
// plainJsonErrors로 막으려 했지만 Proxy에는 원리적으로 통하지 않는다(getOwnPropertyDescriptor는
// target으로 투과하므로 get 트랩이 보이지 않는다). 실측: 검증 중에는 정직한 paintRect를,
// maskRectsForSurface 시점에만 3000x3000을 돌려주는 Proxy로 plainJsonErrors=0 / errors=0 /
// diff=0 / ok=true 가 재현됐고 마스크 밖 회귀가 숨었다.
// 문자열을 받아 **정확히 한 번** JSON.parse하면 그 산출물은 정의상 plain data이고,
// 검증과 소비가 같은 스냅샷을 본다. 이건 우회 가능한 검사가 아니라 구조적 불가능성이다.
// (선례: validateCommittedArtifacts도 committedFixtureRaw 문자열을 받는다.)
//
// 순서: 파싱 → surface 소속 → raster(context) → raster(PNG 바이트) → 승인 산출물 동일성
//       → 마스크 계약 → 관측 → 동결 paintRect → diffPng.
// validator는 주입받지 않는다(정적 import).
export function diffSurfaceLight({ baseBuf, afterBuf, fixtureRaw, spec: rawSpec, contextRaw, surfaceName, observedRaw }) {
  const fail = (errs) => ({ ok: false, diff: -1, reason: errs.slice(0, 5).join('; '), errors: errs });
  // spec도 정확히 한 번 스냅샷한다 — 검증과 소비가 같은 spec을 보게 한다(context/observed와 같은 원리).
  const snapped = snapshotSpec(rawSpec);
  if (snapped.errors.length) return fail(snapped.errors);
  const spec = snapped.spec;
  for (const [name, v] of [['fixtureRaw', fixtureRaw], ['contextRaw', contextRaw], ['observedRaw', observedRaw]])
    if (typeof v !== 'string') return fail([`DIFF_${name.toUpperCase()}_REQUIRED`]);
  let fixture, context, observed;
  try { fixture = JSON.parse(fixtureRaw); } catch (e) { return fail(['DIFF_FIXTURE_UNPARSEABLE']); }
  try { context = JSON.parse(contextRaw); } catch (e) { return fail(['DIFF_CONTEXT_UNPARSEABLE']); }
  try { observed = JSON.parse(observedRaw); } catch (e) { return fail(['DIFF_OBSERVED_UNPARSEABLE']); }
  for (const [n, v] of [['FIXTURE', fixture], ['CONTEXT', context]])
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail([`DIFF_${n}_SHAPE`]);
  // JSON.parse 산출물이 plain이라는 것은 정의상 참이다. 그래도 한 번 단정해 둔다 —
  // 나중에 누가 객체 인자를 다시 열면 이 단정이 먼저 깨진다(회귀 방지용 앵커).
  const plain = [...plainJsonErrors(context, 'context').map((e) => `CTX_${e}`),
    ...plainJsonErrors(observed, 'observed').map((e) => `OBS_${e}`)];
  if (plain.length) return fail(plain);

  const errors = [];
  const surface = (spec.REQUIRED_SMOKE_SURFACES || []).find((x) => x.name === surfaceName);
  if (!surface) errors.push(`SURFACE_UNKNOWN ${surfaceName}`);
  if (!Object.prototype.hasOwnProperty.call(context.baseLightMaskRects || {}, surfaceName))
    errors.push(`SURFACE_NOT_IN_CONTEXT ${surfaceName}`);
  if (errors.length) return fail(errors);

  // fixture ↔ spec 신뢰 루트. 이게 없으면 호출부가 **관대한 spec**(마스크 표를 넓힌 것)과
  // 그에 맞춘 손수 만든 fixture를 함께 넘겨 모든 계약을 무력화할 수 있다.
  // fingerprint를 묶으면 spec을 바꾸는 순간 fixture도 바꿔야 하고, 커밋된 fixture의
  // fingerprint가 실제 spec을 고정한다.
  const fp = specFingerprint(spec, sha256Hex);
  if (fixture.fingerprint !== fp) errors.push(`DIFF_FINGERPRINT_DRIFT ${fixture.fingerprint} != ${fp}`);
  if (fixture.base !== spec.BASE) errors.push(`DIFF_BASE_DRIFT ${fixture.base} != ${spec.BASE}`);
  // raster 계약 — 승인 경로와 **같은 함수**를 쓴다(복제하면 한쪽만 느슨해진다).
  errors.push(...validateRasterContext(context, spec));
  errors.push(...validatePngRaster(baseBuf, spec, 'BASE'));
  errors.push(...validatePngRaster(afterBuf, spec, 'AFTER'));
  // BASE와 AFTER는 **같은 규격**이어야 한다. 각각 허용 집합에 들어가는 것만으로는 부족하다 —
  // BASE가 colorType 2, AFTER가 6이면 둘 다 통과하지만 같은 조건의 렌더가 아니다.
  const hb = decodePngHeader(baseBuf), ha = decodePngHeader(afterBuf);
  if (hb.ok && ha.ok) for (const k of ['width', 'height', 'depth', 'colorType', 'interlace'])
    if (hb[k] !== ha[k]) errors.push(`RASTER_PNG_SHAPE_MISMATCH ${k} BASE=${hb[k]} AFTER=${ha[k]}`);
  // 승인된 산출물과 동일한 스냅샷만 소비한다.
  //  - contextRaw : fixture에 동결된 해시와 exact 일치
  //  - BASE PNG   : 이 surface의 captureName에 대해 동결된 해시와 exact 일치
  //  - AFTER PNG  : 새 렌더이므로 동결 해시가 없다 → raster 규격까지만 강제할 수 있다.
  //    "AFTER가 BASE와 같은 바이트면 거부"는 넣지 않는다. S4 변환은 리터럴을 같은 라이트 값으로
  //    해석되는 var()로 바꾸는 것이라 **픽셀 동일이 정상 기대값**이고, 그 검사는 이상적인 결과를
  //    false RED로 만든다. 반면 공격 억제력은 없다(마스크 안 1픽셀만 바꿔도 통과).
  //    AFTER의 출처는 캡처 실행기의 책임이며 이 함수가 증명할 수 있는 성질이 아니다.
  const smoke = fixture.smoke || {};
  if (typeof smoke.contextSha256 !== 'string') errors.push('DIFF_FIXTURE_NO_CONTEXT_SHA');
  else if (smoke.contextSha256 !== sha256Hex(contextRaw))
    errors.push(`DIFF_CONTEXT_NOT_APPROVED ${smoke.contextSha256} != ${sha256Hex(contextRaw)}`);
  if (surface) {
    // 정확히 1건이어야 한다. find()는 중복 중 첫 항목을 집어, 같은 captureName을 두 번 넣고
    // 하나만 정답으로 맞추는 위조를 통과시킨다.
    const hits = (smoke.captures || []).filter((c) => c && c.captureName === surface.captureName);
    const cap = hits[0];
    if (hits.length > 1) errors.push(`DIFF_BASE_CAPTURE_DUP ${surface.captureName} x${hits.length}`);
    if (!cap) errors.push(`DIFF_BASE_NOT_IN_FIXTURE ${surface.captureName}`);
    else if (cap.sha256 !== sha256Hex(baseBuf))
      errors.push(`DIFF_BASE_NOT_APPROVED ${surface.captureName} ${cap.sha256} != ${sha256Hex(baseBuf)}`);
  }
  if (errors.length) return fail(errors);

  errors.push(...validateMaskContract(fixture, spec, context));
  errors.push(...validateObserved(context, surfaceName, observed, spec));
  if (errors.length) return fail(errors);
  const rects = maskRectsForSurface(context, surfaceName);
  const res = diffPng(baseBuf, afterBuf, rects);
  return { ...res, errors: [], maskCount: rects.length };
}
