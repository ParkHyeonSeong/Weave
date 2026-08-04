// frontend/library/s4CaptureRunner.mjs
// **커밋된 캡처 실행기.** surface manifest를 실제로 실행해 context와 PNG를 만드는 유일한 정본.
//
// 왜 필요한가: 이전까지 캡처는 매번 손으로 쓴 임시 드라이버가 만들었다. manifest의 action은
// validateSmokeCoverage가 **구조만** 검사했고 아무도 실행하지 않았다. 그래서 드라이버가
// expectPresent/expectAbsent를 아예 구현하지 않고 조용히 건너뛴 채로 24화면을 "성공" 처리한
// 일이 실제로 있었다(실측). 그 캡처는 "상태에 도달했다"는 증거를 갖지 못한다.
//
// ── 왜 driver를 주입받는가 ────────────────────────────────────────────────────
// playwright는 이 레포의 의존성이 아니다(frontend/node_modules에 없음). 브라우저를 직접
// import하는 실행기는 레포 안에서 테스트할 수 없고, 테스트할 수 없는 실행기는 임시 드라이버와
// 같은 문제를 반복한다. 그래서 **세만틱은 전부 이 파일이 소유**하고, driver는 원시 동작만 하는
// 얇은 어댑터로 둔다. 이 파일은 fake driver로 전수 테스트된다.
//
// ── 이 하네스가 증명하지 못하는 것 (읽는 사람이 반드시 알아야 함) ──────────────
// 1. **evaluate 채널은 환원 불가능한 신뢰 루트다.** driver.evaluate가 준 소스를 그 페이지에서
//    정직하게 실행하고 반환값을 그대로 돌려준다는 가정은 레포 안에서 검증할 수 없다.
//    모듈 해시는 "코드가 바뀌었는지"를 잡을 뿐 "그 코드가 실제로 브라우저를 몰았는지"의
//    증거가 아니다. 해시를 provenance로 오해하지 말 것.
// 2. **evaluate(DOM)와 screenshot(픽셀)은 별개 채널이다.** 둘을 잇는 단정은 PNG 치수와
//    surface 개수뿐이다. 두 채널이 협조해 거짓말하면 구별할 방법이 없다.
// 3. **actionLog는 provenance가 아니다.** validateActionLog는 로그가 manifest와 형태·의미상
//    모순되지 않는지만 본다. 로그의 모든 값이 spec에서 계산 가능하므로, 브라우저 없이 만든
//    합성 로그는 통과한다. 이 계약의 값어치는 "실행기를 우회하면 그 사실이 산출물에 남는다"가
//    아니라 "실행 주장이 명시되고 manifest와 교차검증된다"이다.
// 이 세 가지는 잔존 위험으로 수용한 것이고, 폐쇄가 아니라 **비용 상승**이 방어다.
//
// ── 신뢰 표면 ─────────────────────────────────────────────────────────────────
// driver.settle()은 **판정하지 않는다**. 대기 힌트일 뿐이고, 모든 postcondition은 러너가
// `driver.evaluate(ASSERT_SOURCE, ...)`로 직접 판정한다. 따라서 어댑터가 settle을 즉시
// resolve하며 거짓말해도 통과할 수 없다 — 상태에 도달하지 않았으면 assert가 실패한다.
// click/hover/goto/setStorage도 "상태에 도달시키는" 역할일 뿐 판정 권한이 없다.
// 남는 신뢰 가정은 정확히 하나다: **evaluate가 준 소스를 페이지에서 정직하게 실행해
// 그 반환값을 그대로 돌려준다.** probe도 같은 채널을 쓰므로 신뢰 가정이 늘지 않는다.
//
// driver 계약(전부 async 허용):
//   setViewport(width, height)
//   setStorage(key, value)
//   goto(url)
//   settle(selector, state, timeoutMs)   // 대기 힌트. 실패해도 러너가 assert로 최종 판정한다.
//   reload()                             // 현재 URL 재로딩(테마 적용·복원 확인용)
//   sleep(ms)                            // 픽셀 정착 확인용. **필수**다.
//   click(selector, nth, hasText)
//   hover(selector, nth)
//   evaluate(source, arg)                // 유일한 신뢰 채널
//   screenshot()                         // PNG bytes
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, renameSync, rmSync, existsSync, readdirSync,
  lstatSync, realpathSync, openSync, closeSync, unlinkSync, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname, sep } from 'node:path';
import { buildActionContext, resolveActions } from './s4Evaluator.mjs';
import { ASSERT_SOURCE, PROBE_SOURCE, RASTER_PROBE_SOURCE, THEME_PROBE_SOURCE, PSEUDO_PROBE_SOURCE,
  DATASET_PROBE_SOURCE, validateProbeResult, normalizeOccurrence } from './s4DomProbe.mjs';
import { decodePngHeader, derivePaintRect, outsetBySelector } from './s4Evaluator.mjs';

// 이 파일 전체 바이트가 실행 계약이다. specFingerprint가 해시한다(probe 모듈과 같은 이유).
export const RUNNER_MODULE_PATH = fileURLToPath(import.meta.url);
export const RUNNER_MODULE_BYTES = readFileSync(RUNNER_MODULE_PATH);

// 커밋된 진입점(어댑터)도 신뢰 입력이다. core만 해시하면 core를 우회해 자기 루프로 캡처를
// 쓰는 어댑터가 그대로 통과한다 — 그게 결함 1의 메커니즘이었다.
// 여기서 읽는 이유: evaluator가 scripts/를 import하면 의존 방향이 뒤집힌다(라이브러리 → 스크립트).
export const ADAPTER_MODULE_PATH = join(dirname(RUNNER_MODULE_PATH), '..', 'scripts', 's4-capture.mjs');
export const ADAPTER_MODULE_BYTES = readFileSync(ADAPTER_MODULE_PATH);

// 지원 op는 정확히 이 7개다. manifest에 다른 op가 생기면 조용히 무시되지 않고 즉시 중단된다.
// (실측: manifest 전체 op 분포 = setStorage 20 / goto 24 / waitFor 9 / click 23 / hover 10 /
//  expectPresent 6 / expectAbsent 4)
export const OP_SCHEMA = {
  setStorage: { required: ['key', 'value'], optional: [] },
  goto: { required: ['url'], optional: [] },
  waitFor: { required: ['selector', 'state'], optional: ['nth'] },
  click: { required: ['selector'], optional: ['nth', 'hasText'] },
  hover: { required: ['selector'], optional: ['nth'] },
  expectPresent: { required: ['selector'], optional: [] },
  expectAbsent: { required: ['selector'], optional: [] },
};
const ASSERTING_OPS = new Set(['waitFor', 'expectPresent', 'expectAbsent']);
export const SETTLE_TIMEOUT_MS = 12000;
export const PIXEL_SETTLE_MS = 300;   // 정착 확인 간격
export const PHASES = ['light', 'dark'];

// 실행 계획 — 순수 함수. resolveActions 결과만 쓰고, 미해결 placeholder·미지 op·필드 누락을 잡는다.
export function planSurface(surface, rawContext) {
  const errors = [];
  if (!surface || typeof surface !== 'object') return { steps: [], errors: ['PLAN_SURFACE_SHAPE'] };
  if (!Array.isArray(surface.actions)) return { steps: [], errors: [`PLAN_NO_ACTIONS ${surface.name}`] };
  const flat = buildActionContext(rawContext || {});
  const { resolved, errors: rErrors } = resolveActions(surface.actions, flat);
  errors.push(...rErrors.map((e) => `PLAN_${e} ${surface.name}`));
  const steps = resolved.map((a, index) => {
    const schema = OP_SCHEMA[a.op];
    if (!schema) { errors.push(`PLAN_UNKNOWN_OP ${surface.name}[${index}] ${a.op}`); return { index, ...a }; }
    for (const f of schema.required)
      if (a[f] === undefined || a[f] === null || a[f] === '') errors.push(`PLAN_MISSING_FIELD ${surface.name}[${index}] ${a.op}.${f}`);
    const allowed = new Set(['op', ...schema.required, ...schema.optional]);
    for (const f of Object.keys(a)) if (!allowed.has(f)) errors.push(`PLAN_EXTRA_FIELD ${surface.name}[${index}] ${a.op}.${f}`);
    if (a.op === 'waitFor' && !['visible', 'hidden'].includes(a.state))
      errors.push(`PLAN_BAD_STATE ${surface.name}[${index}] ${a.state}`);
    return { index, ...a };
  });
  // manifest가 선언한 상태 증거를 실행 단계에 결합한다.
  //   coverageSelectors[*].provenBy = 그 상태를 만든 action의 인덱스
  //   그 action 직후에 러너가 실제로 확인해야 하는 selector를 여기서 정한다.
  const postByIndex = new Map();
  for (const o of surface.coverageSelectors || []) {
    if (!o.state) continue;
    if (!Number.isInteger(o.provenBy) || !steps[o.provenBy]) { errors.push(`PLAN_PROVENBY_RANGE ${surface.name} ${o.selector}`); continue; }
    const list = postByIndex.get(o.provenBy) || [];
    // hover/focus는 의사클래스로 실제 확인 가능하다(querySelectorAll('.X:hover')는 현재 hover된
    // 요소를 돌려준다). selected는 선언된 selector 자체가 결과 클래스를 담고 있다.
    const target = o.state === 'hover' ? `${o.selector}:hover`
      : o.state === 'focus' ? `${o.selector}:focus` : o.selector;
    list.push({ selector: resolvePlaceholderish(target, flat), why: `state:${o.state}`, transition: false });
    // produces는 **전이**를 요구한다: action 직전 0건, 직후 1건 이상.
    // 직후만 보면 이미 켜져 있던 상태를 그 action이 만든 것처럼 통과시킬 수 있다(공허한 증거).
    if (o.produces) list.push({ selector: resolvePlaceholderish(o.produces, flat), why: 'produces', transition: true });
    postByIndex.set(o.provenBy, list);
  }
  for (const s of steps) s.postAssert = postByIndex.get(s.index) || [];
  for (const s of steps) for (const p of s.postAssert)
    if (/\{[A-Za-z0-9_]+\}/.test(p.selector)) errors.push(`PLAN_UNRESOLVED_POST ${surface.name}[${s.index}] ${p.selector}`);
  return { steps, errors };
}
// coverageSelectors/produces에도 {placeholder}가 쓰인다(settings 계열 실측). resolveActions는
// action만 다루므로 여기서 같은 규칙으로 치환한다.
function resolvePlaceholderish(value, flat) {
  return String(value).replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (flat[k] !== undefined ? String(flat[k]) : m));
}

// ASSERT_SOURCE 결과 형태 검증 — 드라이버가 아무 값이나 돌려줘도 통과하지 못하게 한다.
export function validateAssertResult(result, selectors) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['ASSERT_RESULT_SHAPE'];
  const errors = [];
  for (const sel of selectors) {
    const v = result[sel];
    if (!v || typeof v !== 'object') { errors.push(`ASSERT_MISSING ${sel}`); continue; }
    for (const k of ['count', 'visible'])
      if (!Number.isInteger(v[k]) || v[k] < 0) errors.push(`ASSERT_BAD_${k.toUpperCase()} ${sel}`);
    if (Number.isInteger(v.count) && Number.isInteger(v.visible) && v.visible > v.count)
      errors.push(`ASSERT_VISIBLE_GT_COUNT ${sel}`);
  }
  for (const sel of Object.keys(result)) if (!selectors.includes(sel)) errors.push(`ASSERT_EXTRA ${sel}`);
  return errors;
}

async function assertVisibility(driver, selectors) {
  const raw = await driver.evaluate(ASSERT_SOURCE, selectors);
  const errors = validateAssertResult(raw, selectors);
  return { raw, errors };
}

// manifest 액션을 실행하는 **공용 구간**. 캡처와 discovery가 같은 의미론을 쓴다.
//
// 왜 공용인가: discovery가 op를 따로 해석하면 postcondition 판정이 빠지고(실증: click/hover/
// goto/setStorage만 처리, waitFor·expectPresent·expectAbsent 없음) "관찰은 됐지만 그 상태가
// 아니었던" 목록이 나온다. 그 목록으로 endpoint를 동결하면 근거가 되지 못한다.
//
// 첫 오류에서 즉시 중단한다(fail-closed) — 어디까지 실제로 도달했는지가 흐려지면 안 된다.
export async function executeSurfaceSteps({ surface, rawContext, driver, raster }) {
  const log = [];
  const { steps, errors: planErrors } = planSurface(surface, rawContext);
  if (planErrors.length) return { errors: planErrors, log, steps: [] };
  const fail = (e) => ({ errors: [e], log, steps });
  if (raster) await driver.setViewport(raster.width, raster.height);
  for (const s of steps) {
    const entry = { index: s.index, op: s.op, selector: s.selector, decided: null };
    try {
      // 전이를 요구하는 증거는 action **직전** 상태를 먼저 읽어둔다.
      const preSels = (s.postAssert || []).filter((p) => p.transition).map((p) => p.selector);
      let pre = null;
      if (preSels.length) {
        const { raw, errors } = await assertVisibility(driver, preSels);
        if (errors.length) return fail(`RUN_ASSERT_INVALID ${surface.name}[${s.index}] ${errors[0]}`);
        pre = raw;
      }
      entry.pre = pre;
      if (s.op === 'setStorage') await driver.setStorage(s.key, s.value);
      else if (s.op === 'goto') await driver.goto(s.url);
      else if (s.op === 'click') await driver.click(s.selector, s.nth == null ? 0 : s.nth, s.hasText);
      else if (s.op === 'hover') await driver.hover(s.selector, s.nth == null ? 0 : s.nth);
      else if (ASSERTING_OPS.has(s.op)) {
        const wantVisible = !(s.op === 'expectAbsent' || (s.op === 'waitFor' && s.state === 'hidden'));
        try { await driver.settle(s.selector, wantVisible ? 'visible' : 'hidden', SETTLE_TIMEOUT_MS); }
        catch (e) { /* 힌트 실패는 아래 판정으로 넘긴다 */ }
        const { raw, errors } = await assertVisibility(driver, [s.selector]);
        if (errors.length) return fail(`RUN_ASSERT_INVALID ${surface.name}[${s.index}] ${errors[0]}`);
        entry.decided = raw[s.selector];
        const ok = wantVisible ? raw[s.selector].visible > 0 : raw[s.selector].visible === 0;
        log.push(entry);
        if (!ok) return fail(`RUN_POSTCONDITION_FAILED ${surface.name}[${s.index}] ${s.op} ${s.selector} ` +
          `count=${raw[s.selector].count} visible=${raw[s.selector].visible}`);
        continue;
      } else return fail(`RUN_UNKNOWN_OP ${surface.name}[${s.index}] ${s.op}`);
    } catch (e) { log.push(entry); return fail(`RUN_OP_THREW ${surface.name}[${s.index}] ${s.op} ${e && e.message}`); }

    if (s.postAssert.length) {
      const sels = s.postAssert.map((p) => p.selector);
      // postAssert는 이 action의 **결과**다 — action이 반환한 순간이 아니라 결과가 나타난
      // 순간에 읽어야 한다. goto는 domcontentloaded까지만 기다리는데 SPA 헤더는 그보다
      // 늦게 붙는다(실측: DCL 시점 .TrackHeader__ViewBtn--active 0개, ~230ms에 1개).
      // 즉시 1회만 읽으면 통과/실패가 스케줄링에 좌우된다 — 실제 카나리 attempt 2가
      // 그렇게 죽었고 attempt 1이 통과한 건 운이었다.
      // settle은 **힌트일 뿐**이고 판정은 아래 커밋된 probe가 한다. 상태가 끝내 나타나지
      // 않으면 settle이 타임아웃해도 probe가 count=0을 보고해 그대로 RED다.
      for (const sel of sels) {
        try { await driver.settle(sel, 'visible', SETTLE_TIMEOUT_MS); }
        catch (e) { /* 판정은 probe가 한다 */ }
      }
      const { raw, errors } = await assertVisibility(driver, sels);
      if (errors.length) { log.push(entry); return fail(`RUN_ASSERT_INVALID ${surface.name}[${s.index}] ${errors[0]}`); }
      entry.decided = raw;
      log.push(entry);
      for (const p of s.postAssert) {
        if (!(raw[p.selector].visible > 0))
          return fail(`RUN_STATE_UNPROVEN ${surface.name}[${s.index}] ${p.why} ${p.selector} ` +
            `count=${raw[p.selector].count} visible=${raw[p.selector].visible}`);
        if (p.transition && entry.pre && entry.pre[p.selector] && entry.pre[p.selector].count !== 0)
          return fail(`RUN_NO_TRANSITION ${surface.name}[${s.index}] ${p.selector} ` +
            `before count=${entry.pre[p.selector].count} (이미 존재했으므로 이 action의 증거가 아니다)`);
      }
      continue;
    }
    log.push(entry);
  }
  return { errors: [], log, steps };
}

// 한 surface 캡처. 액션 실행은 공용 함수에 맡기고, 여기서는 측정·증거·스크린샷을 한다.
export async function runSurface({ surface, rawContext, driver, selectors, raster, spec, phase }) {
  const exec = await executeSurfaceSteps({ surface, rawContext, driver, raster });
  const log = exec.log, steps = exec.steps;
  const fail = (e) => ({ errors: [e], log, occurrences: null, png: null });
  if (exec.errors.length) return { errors: exec.errors, log, occurrences: null, png: null };

  // 캡처 직전 테마 재확인 — 액션 중간에 reload가 일어나면 테마가 되돌아갈 수 있다.
  if (phase) {
    const th = await driver.evaluate(THEME_PROBE_SOURCE, null);
    if (!th || typeof th !== 'object') return fail(`RUN_THEME_PROBE_INVALID ${surface.name}`);
    if (th.dataTheme !== phase) return fail(`RUN_THEME_MISMATCH ${surface.name} data-theme=${th.dataTheme} != ${phase}`);
    if (th.stored !== phase) return fail(`RUN_THEME_STORAGE ${surface.name} stored=${th.stored} != ${phase}`);
  }
  // 선언된 상태(hover/focus/selected)를 **캡처 직전에 다시** 단정한다.
  // action 직후에만 보면 그 사이 hover가 풀리거나 포커스가 옮겨가도 그대로 찍힌다.
  const stateSels = [...new Set(steps.flatMap((s2) => (s2.postAssert || []).map((p) => p.selector)))];
  if (stateSels.length) {
    const { raw, errors } = await assertVisibility(driver, stateSels);
    if (errors.length) return fail(`RUN_ASSERT_INVALID ${surface.name} final-state ${errors[0]}`);
    for (const sel of stateSels)
      if (!(raw[sel].visible > 0))
        return fail(`RUN_STATE_LOST ${surface.name} ${sel} visible=${raw[sel].visible} (캡처 직전에 상태가 사라졌다)`);
  }
  // 캡처 조건을 페이지에서 실측한다 — context.capture.dpr을 자기신고에서 실측으로 바꾼다.
  if (raster) {
    const rp = await driver.evaluate(RASTER_PROBE_SOURCE, null);
    if (!rp || typeof rp !== 'object') return fail(`RUN_RASTER_PROBE_INVALID ${surface.name}`);
    if (rp.innerWidth !== raster.width || rp.innerHeight !== raster.height)
      return fail(`RUN_RASTER_VIEWPORT ${surface.name} ${rp.innerWidth}x${rp.innerHeight} != ${raster.width}x${raster.height}`);
    if (rp.dpr !== raster.dpr) return fail(`RUN_RASTER_DPR ${surface.name} ${rp.dpr} != ${raster.dpr}`);
    if (rp.scrollX !== 0 || rp.scrollY !== 0) return fail(`RUN_RASTER_SCROLLED ${surface.name} ${rp.scrollX},${rp.scrollY}`);
  }
  // manifest가 이 화면의 증거라고 선언한 요소들이 **캡처 시점에 실제로 보이는지** 확인한다.
  // count가 아니라 **visible**이다 — DOM에만 있고 숨겨진 요소는 픽셀 증거가 아니다.
  // (실증 지적: 숨은 BranchKey/Group/GroupHint도 통합 canvas의 증거로 통과했다.)
  const flatCtx = buildActionContext(rawContext || {});
  const covAll = surface.coverageSelectors || [];
  const covSels = [...new Set([
    ...covAll.filter((o) => !o.locator).map((o) => resolvePlaceholderish(o.selector, flatCtx)),
    ...(surface.requiredElements || []),
  ])];
  const coverageEvidence = {};
  if (covSels.length) {
    const { raw, errors } = await assertVisibility(driver, covSels);
    if (errors.length) return fail(`RUN_ASSERT_INVALID ${surface.name} coverage ${errors[0]}`);
    for (const sel of covSels) {
      coverageEvidence[sel] = raw[sel];
      if (!(raw[sel].visible > 0))
        return fail(`RUN_COVERAGE_ABSENT ${surface.name} ${sel} count=${raw[sel].count} visible=${raw[sel].visible}`);
    }
  }
  // 의사요소는 selector로 잡을 수 없으므로 computed style 전용 probe로 판정한다.
  const pseudoPairs = covAll.filter((o) => o.locator && o.locator.pseudo)
    .map((o) => [resolvePlaceholderish(o.locator.selector, flatCtx), o.locator.pseudo]);
  if (pseudoPairs.length) {
    const praw = await driver.evaluate(PSEUDO_PROBE_SOURCE, pseudoPairs);
    if (!praw || typeof praw !== 'object') return fail(`RUN_PSEUDO_PROBE_INVALID ${surface.name}`);
    for (const [host, pseudo] of pseudoPairs) {
      const v = praw[host + pseudo];
      if (!v || !Number.isInteger(v.present)) return fail(`RUN_PSEUDO_SHAPE ${surface.name} ${host}${pseudo}`);
      coverageEvidence[host + pseudo] = v;
      if (!(v.present > 0)) return fail(`RUN_COVERAGE_ABSENT ${surface.name} ${host}${pseudo} present=0`);
    }
  }
  // dark phase에서는 darkReviewSelectors를 **실제로 실행**한다. 선언만 있고 아무도 확인하지
  // 않으면 "다크 육안 검토 대상"이 화면에 없어도 그대로 통과한다.
  const darkReview = {};
  if (phase === 'dark') {
    const plain = (surface.darkReviewSelectors || []).filter((x) => !String(x).includes('::'));
    const pseudo = (surface.darkReviewSelectors || []).filter((x) => String(x).includes('::'))
      .map((x) => { const i = x.indexOf('::'); return [resolvePlaceholderish(x.slice(0, i), flatCtx), x.slice(i)]; });
    if (plain.length) {
      const { raw, errors } = await assertVisibility(driver, plain.map((x) => resolvePlaceholderish(x, flatCtx)));
      if (errors.length) return fail(`RUN_ASSERT_INVALID ${surface.name} darkReview ${errors[0]}`);
      for (const x of plain) {
        const sel = resolvePlaceholderish(x, flatCtx);
        darkReview[x] = { ...raw[sel], pass: raw[sel].visible > 0 };
        if (!darkReview[x].pass) return fail(`RUN_DARK_REVIEW_ABSENT ${surface.name} ${x} visible=${raw[sel].visible}`);
      }
    }
    if (pseudo.length) {
      const praw = await driver.evaluate(PSEUDO_PROBE_SOURCE, pseudo);
      if (!praw || typeof praw !== 'object') return fail(`RUN_PSEUDO_PROBE_INVALID ${surface.name} darkReview`);
      for (const [host, ps] of pseudo) {
        const v = praw[host + ps];
        darkReview[host + ps] = { ...(v || {}), pass: !!(v && v.present > 0) };
        if (!darkReview[host + ps].pass) return fail(`RUN_DARK_REVIEW_ABSENT ${surface.name} ${host}${ps} present=0`);
      }
    }
  }

  // 측정 — 정확히 committed PROBE_SOURCE로, 15 selector 전수.
  const probeRaw = await driver.evaluate(PROBE_SOURCE, selectors);
  const probeErrors = validateProbeResult(probeRaw, selectors);
  if (probeErrors.length) return fail(`RUN_PROBE_INVALID ${surface.name} ${probeErrors[0]}`);
  // paintRect는 **검증기와 같은 함수**로 파생한다(공식을 두 곳에 적으면 갈라진다).
  // normalizeOccurrence는 일부러 paintRect를 만들지 않는다 — 관측물이 아니라 파생물이기 때문이다.
  const outsets = outsetBySelector(spec || { LIGHT_DIFF_MASKS: {} });
  const occurrences = {};
  for (const sel of selectors) {
    const outset = outsets.get(sel);
    if (probeRaw[sel].length && !Number.isFinite(outset)) return fail(`RUN_NO_OUTSET ${surface.name} ${sel}`);
    occurrences[sel] = probeRaw[sel].map((o) => {
      const n = normalizeOccurrence(o);
      return { ...n, paintRect: derivePaintRect(n, outset) };
    });
  }

  const png = await driver.screenshot();
  if (!png || typeof png.length !== 'number' || png.length === 0) return fail(`RUN_SCREENSHOT_EMPTY ${surface.name}`);
  if (raster) {
    const hdr = decodePngHeader(png);
    if (!hdr.ok) return fail(`RUN_SCREENSHOT_DECODE ${surface.name} ${hdr.reason}`);
    if (hdr.width !== raster.width || hdr.height !== raster.height)
      return fail(`RUN_SCREENSHOT_SIZE ${surface.name} ${hdr.width}x${hdr.height} != ${raster.width}x${raster.height}`);
  }
  // 픽셀 정착 — 같은 상태에서 두 번 찍어 바이트가 같아야 한다. 다르면 애니메이션·비동기 렌더가
  // 남아 있어 그 PNG는 재현 가능한 증거가 아니다. 수렴하지 않으면 RED다(은폐보다 낫다).
  // **선택이 아니다.** 이전 판은 driver.sleep이 있을 때만 돌아서, sleep 없는 어댑터를 쓰면
  // 변동하는 PNG도 GREEN이었다. 정착 검사를 못 하는 driver는 캡처를 만들 자격이 없다.
  if (typeof driver.sleep !== 'function') return fail(`RUN_DRIVER_NO_SLEEP ${surface.name}`);
  await driver.sleep(PIXEL_SETTLE_MS);
  const again = await driver.screenshot();
  const settled = !!again && again.length === png.length && Buffer.compare(Buffer.from(png), Buffer.from(again)) === 0;
  if (!settled) return fail(`RUN_UNSTABLE_PIXELS ${surface.name} ${png.length} vs ${again ? again.length : 'null'}`);
  return { errors: [], log, occurrences, png, settled, coverageEvidence, darkReview };
}

// 산출물은 **candidate 위치에만**, **phase별로 분리해서** 쓴다.
//
// 왜 분리인가: 이전 판은 light와 dark가 같은 context 파일과 같은 s4-shots/candidate/에 썼다.
// dark 실행이 light 산출물을 덮어썼고, 매니페스트에서 빠진 PNG는 그대로 잔존했다(실증).
// 두 phase는 역할이 다르다 — light는 diff의 BASE(baselineLight), dark는 육안 검토(reviewDark)다.
//
// 쓰기 규칙:
//  - 파일명 집합이 manifest와 **exact** 일치해야 한다(모자라도 남아돌아도 거부).
//  - temp 디렉터리에 전부 완성한 뒤 목적지를 통째로 교체한다 — 부분 산출물이나 잔존 파일이
//    남지 않는다. committed 이름을 쓰려는 시도는 거부한다.
export const CANDIDATE_CONTEXT_NAME = (phase) => `s4-smoke-context.${phase}.candidate.json`;
export const CANDIDATE_SHOTS_DIR = (phase) => `candidate-${phase}`;
export const COMMITTED_CONTEXT_NAME = (phase) => (phase === 'light' ? 's4-smoke-context.json' : `s4-smoke-context.${phase}.json`);
export const COMMITTED_SHOTS_DIR = (phase) => (phase === 'light' ? 'base' : `${phase}-review`);

// candidate는 **전용 ignored root 아래의 content-addressed immutable bundle + 단일 pointer**다.
//
// 왜 전용 root인가: 이전 판은 커밋 대상인 `s4-shots/` 안에 썼다. `.gitignore`는 옛 이름
// (`candidate-*/`)만 덮어서 pointer와 `bundle-*` 디렉터리가 **추적되지 않은 파일로 노출**됐고,
// light를 쓴 직후 worktree가 dirty가 되어 dark phase가 시작조차 못 했다(실증).
// 전용 root 하나를 통째로 ignore하면 그 결합이 끊긴다.
//
// 왜 pointer 하나인가: dest→parked→tmp→dest 두 rename은 public 경로가 사라지는 순간을
// 만들고 rollback을 필요로 한다. 여기서는 bundle을 먼저 완성해 두고 pointer만 atomic
// rename하므로 되돌릴 것이 없다.
export const CANDIDATE_ROOT = 's4-candidates';
export const CANDIDATE_POINTER = (phase) => `${phase}.pointer`;
export const CANDIDATE_BUNDLE_DIR = (phase) => `candidate-${phase}`;   // 승격 경로 호환 이름
export const BUNDLE_CONTEXT_NAME = 'content.json';
const BUNDLE_PREFIX = (phase) => `bundle-${phase}-`;

export function bundleContentHash(contextRaw, pngByCaptureName) {
  const h = createHash('sha256');
  h.update(`ctx\n${contextRaw}\n`);
  for (const name of Object.keys(pngByCaptureName).sort()) {
    h.update(`png ${name} `);
    h.update(createHash('sha256').update(pngByCaptureName[name]).digest('hex'));
    h.update('\n');
  }
  return h.digest('hex');
}

// 경로가 **일반 파일/디렉터리**이고 fixturesDir 안에 있는지. symlink는 거부한다 —
// 링크를 따라가면 산출물이 fixtures 밖에 생기거나 밖의 내용을 읽게 된다.
function safeNode(fixturesDir, p, kind) {
  let rootReal = null;
  try { rootReal = realpathSync(fixturesDir); } catch (e) { return `NODE_ROOT_UNREADABLE ${fixturesDir}`; }
  let st = null;
  try { st = lstatSync(p); } catch (e) { return null; }        // 없으면 검사할 것이 없다
  if (st.isSymbolicLink()) return `NODE_SYMLINK ${p}`;
  if (kind === 'dir' && !st.isDirectory()) return `NODE_NOT_DIR ${p}`;
  if (kind === 'file' && !st.isFile()) return `NODE_NOT_FILE ${p}`;
  let real = null;
  try { real = realpathSync(p); } catch (e) { return `NODE_UNRESOLVABLE ${p}`; }
  if (real !== rootReal && !real.startsWith(rootReal + sep)) return `NODE_ESCAPES_FIXTURES ${p} -> ${real}`;
  return null;
}

// bundle 디렉터리가 **정확히 기대한 내용**인지 재검증한다. rename race에서 다른 프로세스가
// 먼저 올린 디렉터리를 그대로 믿으면, 같은 이름이어도 내용이 다를 수 있다(불완전 쓰기·수동 조작).
function verifyBundleDir(fixturesDir, dir, want, hash) {
  const bad = safeNode(fixturesDir, dir, 'dir');
  if (bad) return [`BUNDLE_${bad}`];
  let names = null;
  try { names = readdirSync(dir); } catch (e) { return [`BUNDLE_UNREADABLE ${dir}`]; }
  const expect = [...want, BUNDLE_CONTEXT_NAME].sort();
  if (JSON.stringify([...names].sort()) !== JSON.stringify(expect))
    return [`BUNDLE_FILE_SET got=[${[...names].sort()}] want=[${expect}]`];
  for (const n of names) {
    const e = safeNode(fixturesDir, join(dir, n), 'file');
    if (e) return [`BUNDLE_${e}`];
  }
  let ctx = null; const pngs = {};
  try {
    ctx = readFileSync(join(dir, BUNDLE_CONTEXT_NAME), 'utf8');
    for (const n of want) pngs[n] = readFileSync(join(dir, n));
  } catch (e) { return [`BUNDLE_READ_FAILED ${(e && e.message) || e}`]; }
  if (bundleContentHash(ctx, pngs) !== hash) return [`BUNDLE_HASH_MISMATCH ${dir}`];
  return [];
}

// **commit point는 pointer rename이다.** 그 전에 실패하면 아무것도 공개되지 않았고,
// 그 뒤에 실패하면(readback 등) 이미 공개된 것이다 — 두 경우를 다르게 보고한다.
export const COMMIT_POINT = 'pointer-rename';

// **lock 계약**: 정상 cooperative writer와 기존 foreign lock은 보호한다.
// same-user out-of-band unlink/replace가 ownership 검사 직후 발생하는 경우는 범위 밖이다.
// stale lock은 자동 회수하지 않고 아래 절차를 따른다.
//
// **수동 복구 절차** (자동 stale 회수는 의도적으로 없다):
//  1) `WRITE_LOCK_BUSY` — 다른 writer가 살아 있는지 먼저 확인한다. 없다면(SIGKILL 잔존)
//     `s4-candidates/.lock-<phase>`를 사람이 지운다. mtime만 보고 지우지 말 것.
//  2) `WRITE_LOCK_OWNERSHIP_LOST` — 누군가 lock을 교체했다. pointer는 쓰이지 않았으므로
//     이전 candidate가 유효하다. 남의 lock을 지우지 말고 그 writer가 끝나기를 기다린다.
//  3) `WRITE_COMMITTED_BUT_*` — pointer는 이미 전환됐고 그 뒤 손상이 확인된 상태다.
//     candidate를 신뢰하지 말고 해당 phase를 다시 캡처한다. pointer를 손으로 되돌리지 말 것.
export const LOCK_RECOVERY = ['WRITE_LOCK_BUSY', 'WRITE_LOCK_OWNERSHIP_LOST', 'WRITE_COMMITTED_BUT'];

export function writeCandidate({ fixturesDir, phase, contextRaw, pngByCaptureName, expectedCaptureNames }) {
  if (typeof contextRaw !== 'string') return ['WRITE_CONTEXT_RAW_REQUIRED'];
  if (!PHASES.includes(phase)) return [`WRITE_PHASE_INVALID ${phase}`];
  // 해시 전에 입력 형태를 못박는다 — Array/plain object/byte 값이 아니면 해시가 의미를 잃는다.
  if (!Array.isArray(expectedCaptureNames)) return ['WRITE_EXPECTED_NAMES_NOT_ARRAY'];
  if (expectedCaptureNames.some((n) => typeof n !== 'string' || !n)) return ['WRITE_EXPECTED_NAMES_NOT_STRINGS'];
  if (new Set(expectedCaptureNames).size !== expectedCaptureNames.length)
    return [`WRITE_EXPECTED_NAMES_DUPLICATE [${expectedCaptureNames}]`];
  if (!pngByCaptureName || typeof pngByCaptureName !== 'object' || Array.isArray(pngByCaptureName))
    return ['WRITE_PNGS_REQUIRED'];
  if (Object.getPrototypeOf(pngByCaptureName) !== Object.prototype
    && Object.getPrototypeOf(pngByCaptureName) !== null) return ['WRITE_PNGS_NOT_PLAIN'];
  for (const [k, v] of Object.entries(pngByCaptureName))
    if (!Buffer.isBuffer(v) && !(v instanceof Uint8Array)) return [`WRITE_PNG_NOT_BYTES ${k}`];
  const got = Object.keys(pngByCaptureName).sort();
  const want = [...expectedCaptureNames].sort();
  if (JSON.stringify(got) !== JSON.stringify(want))
    return [`WRITE_CAPTURE_SET_MISMATCH got=${got.length} want=${want.length} ` +
      `missing=[${want.filter((n) => !got.includes(n))}] extra=[${got.filter((n) => !want.includes(n))}]`];
  for (const name of got) {
    if (name.includes('/') || name.includes('..')) return [`WRITE_BAD_NAME ${name}`];
    if (name.startsWith('.')) return [`WRITE_DOTFILE_NAME ${name}`];   // 읽기가 dotfile을 건너뛴다
  }
  if (got.includes(BUNDLE_CONTEXT_NAME)) return [`WRITE_NAME_RESERVED ${BUNDLE_CONTEXT_NAME}`];

  const root = join(fixturesDir, CANDIDATE_ROOT);
  const hash = bundleContentHash(contextRaw, pngByCaptureName);
  const bundleName = `${BUNDLE_PREFIX(phase)}${hash}`;
  const bundleDir = join(root, bundleName);
  const pointer = join(root, CANDIDATE_POINTER(phase));
  let tmp = null;
  let lockFd = null;
  let lockId = null;
  const lockPath = join(root, `.lock-${phase}`);
  // 우리가 연 lock이 아직 우리 것인지 — dev/ino로 본다. 이름이 같아도 다른 파일일 수 있다.
  const lockStillOurs = () => {
    try { const st = lstatSync(lockPath); return `${st.dev}:${st.ino}` === lockId; }
    catch (e) { return false; }
  };
  try {
    mkdirSync(root, { recursive: true });
    // **containment/symlink 검증을 먼저** 한다. root가 밖을 가리키면 lock조차 밖에 만들면 안 된다.
    for (const [p2, k] of [[root, 'dir'], [bundleDir, 'dir'], [pointer, 'file']]) {
      const e = safeNode(fixturesDir, p2, k);
      if (e) return [`WRITE_${e}`];
    }
    // cooperative lock — O_EXCL. **자동 stale 회수는 없다**(소유자가 살아 있어도 탈취된다).
    // 잔존 lock 복구는 아래 LOCK_RECOVERY 절차대로 사람이 한다.
    try { lockFd = openSync(lockPath, 'wx'); }
    catch (e) { return [`WRITE_LOCK_BUSY ${lockPath}`]; }
    try { const st = fstatSync(lockFd); lockId = `${st.dev}:${st.ino}`; }
    catch (e) { return [`WRITE_LOCK_STAT_FAILED ${(e && e.message) || e}`]; }
    if (!existsSync(bundleDir)) {
      tmp = mkdtempSync(join(root, `.tmp-${phase}-`));
      for (const [name, bytes] of Object.entries(pngByCaptureName)) writeFileSync(join(tmp, name), bytes);
      writeFileSync(join(tmp, BUNDLE_CONTEXT_NAME), contextRaw);
      const stErr = verifyBundleDir(fixturesDir, tmp, want, hash);
      if (stErr.length) return stErr.map((e) => `WRITE_STAGING_${e}`);
      try { renameSync(tmp, bundleDir); tmp = null; }
      catch (e) { if (!existsSync(bundleDir)) return [`WRITE_BUNDLE_PUBLISH_FAILED ${(e && e.message) || e}`]; }
    }
    // **race winner를 그대로 믿지 않는다.** 이미 있었든 방금 올렸든 동일 기준으로 재검증한다.
    const vErr = verifyBundleDir(fixturesDir, bundleDir, want, hash);
    if (vErr.length) return vErr.map((e) => `WRITE_${e}`);

    // commit **직전**에 lock 소유권을 확인한다. 잃었으면 pointer를 쓰지 않는다.
    if (!lockStillOurs()) return ['WRITE_LOCK_OWNERSHIP_LOST'];
    // ── commit point ────────────────────────────────────────────────────────
    // 여기까지의 실패는 **publish되지 않은 실패**다. pointer rename이 성공하는 순간
    // 새 candidate가 공개된다.
    const ptmpDir = mkdtempSync(join(root, `.ptr-${phase}-`));
    const ptmp = join(ptmpDir, 'pointer');
    let committed = false;
    try { writeFileSync(ptmp, `${bundleName}\n`); renameSync(ptmp, pointer); committed = true; }
    catch (e) { return [`WRITE_POINTER_FAILED ${(e && e.message) || e}`]; }
    finally { try { rmSync(ptmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

    // **writer-success ⇒ immediate-reader-success.** commit 뒤의 readback 실패는
    // "publish되지 않았다"가 아니라 **publish된 뒤의 손상**이다 — 그렇게 보고한다.
    const back = readCandidateBundle(fixturesDir, phase);
    if (back.errors.length)
      return back.errors.map((e) => `WRITE_COMMITTED_BUT_UNREADABLE ${e}`);
    if (back.contextRaw !== contextRaw) return ['WRITE_COMMITTED_BUT_CONTEXT_MISMATCH'];
    void committed;
  } catch (e) {
    return [`WRITE_FAILED ${(e && e.message) || e}`];
  } finally {
    if (tmp) try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    if (lockFd !== null) {
      // 우리 것일 때만 반납한다. **범위 주의**: 정상 cooperative writer와 이미 존재하던
      // foreign lock은 보호하지만, ownership 검사 **직후** 같은 사용자가 out-of-band로
      // unlink/replace하는 창은 범위 밖이다(OS advisory lock을 도입하지 않는다).
      const ours = lockStillOurs();
      try { closeSync(lockFd); } catch (e) { /* noop */ }
      if (ours) try { unlinkSync(lockPath); } catch (e) { /* noop */ }
    }
  }
  return [];
}

export function readCandidateBundle(fixturesDir, phase) {
  const fail = (e) => ({ errors: Array.isArray(e) ? e : [e], contextRaw: null, pngByName: null });
  if (!PHASES.includes(phase)) return fail(`BUNDLE_PHASE_INVALID ${String(phase)}`);
  const root = join(fixturesDir, CANDIDATE_ROOT);
  const pointer = join(root, CANDIDATE_POINTER(phase));
  for (const [p2, k] of [[root, 'dir'], [pointer, 'file']]) {
    const e = safeNode(fixturesDir, p2, k);
    if (e) return fail(`BUNDLE_${e}`);
  }
  if (!existsSync(pointer)) return fail(`BUNDLE_MISSING ${phase}`);
  let name = null;
  try { name = readFileSync(pointer, 'utf8').trim(); } catch (e) { return fail(`BUNDLE_POINTER_UNREADABLE ${(e && e.message) || e}`); }
  if (!name.startsWith(BUNDLE_PREFIX(phase)) || name.includes('/') || name.includes('..'))
    return fail(`BUNDLE_POINTER_INVALID ${name}`);
  const dir = join(root, name);
  if (!existsSync(dir)) return fail(`BUNDLE_TARGET_MISSING ${name}`);
  const bad = safeNode(fixturesDir, dir, 'dir');
  if (bad) return fail(`BUNDLE_${bad}`);
  let names = null;
  try { names = readdirSync(dir); } catch (e) { return fail(`BUNDLE_UNREADABLE ${name}`); }
  // dotfile을 조용히 건너뛰지 않는다 — 있으면 그 자체가 오류다.
  if (names.some((n) => n.startsWith('.'))) return fail(`BUNDLE_DOTFILE ${names.filter((n) => n.startsWith('.'))}`);
  if (!names.includes(BUNDLE_CONTEXT_NAME)) return fail(`BUNDLE_NO_CONTEXT ${phase}`);
  for (const n of names) { const e = safeNode(fixturesDir, join(dir, n), 'file'); if (e) return fail(`BUNDLE_${e}`); }
  let contextRaw = null; const pngByName = {};
  try {
    contextRaw = readFileSync(join(dir, BUNDLE_CONTEXT_NAME), 'utf8');
    for (const n of names) if (n !== BUNDLE_CONTEXT_NAME) pngByName[n] = readFileSync(join(dir, n));
  } catch (e) { return fail(`BUNDLE_READ_FAILED ${(e && e.message) || e}`); }
  const wantName = `${BUNDLE_PREFIX(phase)}${bundleContentHash(contextRaw, pngByName)}`;
  if (wantName !== name) return fail(`BUNDLE_CONTENT_DRIFT ${name} != ${wantName}`);
  return { errors: [], contextRaw, pngByName, bundleName: name };
}

// 디렉터리의 파일명 집합이 정확히 기대와 같은지. BASE·candidate 양쪽에 쓴다.
export function exactCaptureSet(dir, expectedCaptureNames) {
  if (!existsSync(dir)) return [`CAPTURE_DIR_MISSING ${dir}`];
  const got = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  const want = [...expectedCaptureNames].sort();
  if (JSON.stringify(got) !== JSON.stringify(want))
    return [`CAPTURE_SET_MISMATCH ${dir} missing=[${want.filter((n) => !got.includes(n))}] extra=[${got.filter((n) => !want.includes(n))}]`];
  return [];
}

// 전체 실행.
//
// phase('light' | 'dark')를 **만들고 확인한다** — 읽고 복원만 하는 게 아니다.
// 순서: 원래 상태 읽기 → theme=phase 설정 → reload → data-theme exact 확인 → surface 실행
//       → (각 surface는 캡처 직전에 테마를 재확인) → finally에서 원복 → reload → 원복 확인.
// 이전 판은 기존 theme을 읽어 복원만 했다. 다크로 남아 있던 브라우저에서 돌리면
// "라이트 BASE"가 다크 픽셀이 되고 아무도 그것을 잡지 못했다.
export async function runCapture({ spec, rawContext, driver, selectors, phase, provenance }) {
  const errors = [];
  if (!PHASES.includes(phase)) return { errors: [`RUN_PHASE_INVALID ${phase}`], context: null };
  const surfaces = spec.REQUIRED_SMOKE_SURFACES || [];
  const raster = spec.RASTER_CONTRACT;
  const trackId = rawContext && rawContext.trackId;
  const VIEW_KEY = `track:${trackId}:lastView`;

  // 복원 대상 원래 값을 **먼저** 읽는다. resolved data-theme까지 기록한다 —
  // localStorage만 되돌리고 문서가 다른 테마로 남아 있어도 이전 판은 errors=[]였다(실증).
  let prev = { theme: { present: false, value: null }, lastView: { present: false, value: null }, dataTheme: null };
  try {
    const read = await driver.evaluate(READ_STORAGE_SOURCE, ['theme', VIEW_KEY]);
    if (read && read.theme && read[VIEW_KEY]) prev = { ...prev, theme: read.theme, lastView: read[VIEW_KEY] };
    else errors.push('RUN_PREV_STATE_UNREADABLE');
    const th0 = await driver.evaluate(THEME_PROBE_SOURCE, null);
    if (th0 && typeof th0 === 'object') prev.dataTheme = th0.dataTheme;
    else errors.push('RUN_PREV_THEME_UNREADABLE');
  } catch (e) { errors.push(`RUN_PREV_STATE_THREW ${e && e.message}`); }
  if (errors.length) return { errors, context: null };

  const baseLightMaskRects = {}, actionLog = {}, pngByCaptureName = {};
  const coverageEvidence = {}, darkReview = {};
  let datasetStart = null, datasetEnd = null;
  let themeTouched = false;
  try {
    // phase를 실제로 적용하고 **확인**한다.
    if (typeof driver.reload !== 'function') { errors.push('RUN_DRIVER_NO_RELOAD'); throw new Error('__abort');
    }
    themeTouched = true;                    // 이 시점부터는 실패해도 반드시 복원해야 한다
    await driver.setStorage('theme', phase);
    await driver.reload();
    const th = await driver.evaluate(THEME_PROBE_SOURCE, null);
    if (!th || typeof th !== 'object') { errors.push('RUN_THEME_PROBE_INVALID setup'); throw new Error('__abort'); }
    if (th.dataTheme !== phase) { errors.push(`RUN_THEME_NOT_APPLIED data-theme=${th.dataTheme} != ${phase}`); throw new Error('__abort'); }

    // 데이터셋을 **시작 시점에** 수집한다. 종료 시점과 비교해 캡처 도중 데이터가 바뀌지
    // 않았음을 보이고, light/dark 쌍 승인에서 두 phase의 동일성을 본다.
    const flatCtx0 = buildActionContext(rawContext || {});
    const endpoints = (spec.DATASET_ENDPOINTS || []).map((u) => resolvePlaceholderish(u, flatCtx0));
    if (endpoints.length) {
      datasetStart = await driver.evaluate(DATASET_PROBE_SOURCE, endpoints);
      if (!Array.isArray(datasetStart)) { errors.push('RUN_DATASET_PROBE_INVALID start'); throw new Error('__abort'); }
    }

    for (const surface of surfaces) {
      const r = await runSurface({ surface, rawContext, driver, selectors, raster, spec, phase });
      if (r.errors.length) { errors.push(...r.errors); throw new Error('__abort'); }
      baseLightMaskRects[surface.name] = r.occurrences;
      actionLog[surface.name] = r.log;
      coverageEvidence[surface.name] = r.coverageEvidence;
      if (phase === 'dark') darkReview[surface.name] = r.darkReview;
      pngByCaptureName[surface.captureName] = r.png;
    }
    // 종료 시점 재수집 — 캡처 도중 데이터가 바뀌면 그 산출물은 한 데이터셋의 증거가 아니다.
    if (endpoints.length) {
      datasetEnd = await driver.evaluate(DATASET_PROBE_SOURCE, endpoints);
      if (!Array.isArray(datasetEnd)) { errors.push('RUN_DATASET_PROBE_INVALID end'); throw new Error('__abort'); }
    }
  } catch (e) {
    // __abort는 위에서 이미 errors에 이유를 넣은 정상 중단이다. 다른 예외는 그대로 기록한다.
    // **조기 return을 쓰지 않는 이유**: finally에서 발생한 복원 실패가 결과에서 사라진다(실증).
    if (!e || e.message !== '__abort') errors.push(`RUN_THREW ${e && e.message}`);
  } finally {
    // 복원은 **테마를 건드렸다면 무조건** 시도한다(setup probe가 실패해도 마찬가지다).
    // 그리고 storage·resolved data-theme·lastView를 전부 exact 대조한다.
    if (themeTouched) {
      try {
        await driver.evaluate(RESTORE_STORAGE_SOURCE, [['theme', prev.theme], [VIEW_KEY, prev.lastView]]);
        await driver.reload();
        const back = await driver.evaluate(THEME_PROBE_SOURCE, null);
        const storage = await driver.evaluate(READ_STORAGE_SOURCE, ['theme', VIEW_KEY]);
        const wantTheme = prev.theme.present ? prev.theme.value : null;
        if (!back || back.stored !== wantTheme) errors.push(`RUN_RESTORE_THEME_STORAGE ${back && back.stored} != ${wantTheme}`);
        if (!back || back.dataTheme !== prev.dataTheme) errors.push(`RUN_RESTORE_DATA_THEME ${back && back.dataTheme} != ${prev.dataTheme}`);
        const lv = storage && storage[VIEW_KEY];
        if (!lv || lv.present !== prev.lastView.present || lv.value !== prev.lastView.value)
          errors.push(`RUN_RESTORE_LAST_VIEW ${JSON.stringify(lv)} != ${JSON.stringify(prev.lastView)}`);
      } catch (e) { errors.push(`RUN_RESTORE_FAILED ${e && e.message}`); }
    }
  }
  if (errors.length) return { errors, context: null };

  const context = {
    ...rawContext,
    phase,
    viewport: { width: raster.width, height: raster.height },
    capture: { type: 'png', scale: raster.screenshotScale, dpr: raster.dpr },
    prevTheme: prev.theme, prevLastView: prev.lastView, prevDataTheme: prev.dataTheme,
    // 어떤 코드가 이 캡처를 만들었는지. 승인 시 fingerprint 입력 모듈과 재대조한다.
    provenance: provenance || null,
    // **원본 응답**을 남긴다 — 검증기가 digest를 직접 재계산할 수 있어야 자기신고가 아니다.
    datasetResponses: datasetStart,
    actionLog, coverageEvidence, baseLightMaskRects,
    ...(phase === 'dark' ? { darkReview } : {}),
  };
  // **여기서 쓰지 않는다.** 이전 판은 candidate를 먼저 쓰고 호출부가 나중에 HEAD를 재검사해서,
  // 도중 변경을 잡아 종료해도 오염된 candidate가 디스크에 남았다.
  // 순서는 `메모리 캡처 → postflight → writeCandidate` 여야 한다.
  const contextRaw = JSON.stringify(context, null, 1);
  return { errors, context, contextRaw, pngByCaptureName, datasetStart, datasetEnd,
    expectedCaptureNames: surfaces.map((x) => x.captureName) };
}

// 브라우저에서 실행되는 보조 소스 두 개. 여기 있으므로 RUNNER_MODULE_BYTES에 포함된다.
export const READ_STORAGE_SOURCE = `function (keys) {
  var out = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], v = null, present = false;
    try { v = localStorage.getItem(k); present = v !== null; } catch (e) { }
    out[k] = { present: present, value: present ? v : null };
  }
  return out;
}`;
export const RESTORE_STORAGE_SOURCE = `function (pairs) {
  for (var i = 0; i < pairs.length; i++) {
    var k = pairs[i][0], s = pairs[i][1];
    try { if (s && s.present) localStorage.setItem(k, s.value); else localStorage.removeItem(k); } catch (e) { }
  }
  return true;
}`;
