// frontend/scripts/s4-capture.mjs
// **커밋된 캡처 진입점.** 재현 가능한 캡처 명령은 이것 하나뿐이다.
//
// 왜 필요한가: s4CaptureRunner.mjs는 core일 뿐이고, 그것을 부르는 코드가 레포에 없으면
// 아무나 core를 우회해 자기 루프로 goto/click만 하고 candidate를 직접 써도 된다.
// 그게 정확히 결함 1의 메커니즘이었다(임시 드라이버가 expectPresent를 조용히 건너뜀).
//
// 이 파일의 계약:
//  - `runCapture()`만 호출한다. 액션 해석·postcondition·probe·정규화·paintRect 파생을
//    여기서 **재구현하지 않는다**.
//  - 산출물 쓰기는 하지 않는다. `node:fs`를 import하지 않는다 — 쓰기는 해시된 core의
//    `writeCandidate()`에만 존재한다. (아래 상설 테스트가 이 어휘 금지를 강제한다.)
//  - ASSERT_SOURCE/PROBE_SOURCE/THEME_PROBE_SOURCE를 재정의하지 않는다.
//
// ── driver 어댑터 ─────────────────────────────────────────────────────────────
// playwright는 이 레포의 의존성이 아니다. 그래서 브라우저는 **외부 프로세스**가 몰고,
// 이 CLI는 원시 명령만 주고받는 브리지를 연다. 어댑터는 selector도 술어도 모른다.
//
//   node scripts/s4-capture.mjs --phase light --port 10098
//
// 브리지 프로토콜(어댑터가 구현할 것 — 전부 원시 동작이다):
//   GET  /next            → {id, method, args} | {done:true}
//   POST /                ← {id, value, error}
// method는 정확히 이 10개다: setViewport·setStorage·goto·reload·settle·click·hover·evaluate·screenshot·sleep
// (screenshot의 value는 base64 PNG, 나머지는 JSON 값)
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import * as RAW_SPEC from '../library/s4Spec.mjs';
import { runCapture, writeCandidate, CANDIDATE_CAS_ANY, executeSurfaceSteps, PHASES } from '../library/s4CaptureRunner.mjs';
import { NETWORK_INSTALL_SOURCE, NETWORK_DRAIN_SOURCE, NETWORK_IDLE_SOURCE,
  NETWORK_HOOK_VERSION } from '../library/s4DomProbe.mjs';
import { snapshotSpec, specFingerprint, datasetDigest, validateDatasetContract,
  buildActionContext } from '../library/s4Evaluator.mjs';
import { createHash } from 'node:crypto';
import { headBlobBinding, worktreeDirtyEntries, currentHeadCommit,
  DISCOVERY_ENTRY, DISCOVERY_HASHED_MODULES, HASHED_MODULES,
  GENERATOR_ENTRY, GENERATOR_HASHED_MODULES } from '../library/s4Promote.mjs';
import { execSync } from 'node:child_process';

// 이 파일 전체 바이트도 신뢰 입력이다 — 우회 어댑터가 생기면 이 바이트가 그대로인지가 단서다.
export const ADAPTER_MODULE_PATH = fileURLToPath(import.meta.url);

export const BRIDGE_METHODS = ['hello', 'beginAttempt', 'endAttempt', 'shutdown',
  'setViewport', 'setStorage', 'goto', 'reload', 'settle',
  'click', 'hover', 'evaluate', 'screenshot', 'sleep', 'addInitScript'];
// 브리지에 **어떤 어댑터가 붙었는지**를 확인한다. HEAD blob은 디스크의 어댑터를 증명할 뿐
// 실제로 그 어댑터가 연결됐다는 증거가 아니다.
export const BRIDGE_PROTOCOL = 's4-bridge/2';
// ⚠️ handshake는 **protocol 호환성만** 증명한다. 붙은 쪽이 HEAD의 그 어댑터라는 증거가 아니다
// (브라우저 프로세스는 레포 파일을 해시할 수 없다). adapter identity는 HEAD blob 결속이 맡는다.
export const RPC_TIMEOUT_MS = 60000;
// shutdown은 상대가 이미 떠났을 수 있다 — 짧게 시도하고 넘어간다(무기한 대기 금지).
export const SHUTDOWN_TIMEOUT_MS = 1500;
// 커밋된 어댑터는 이 포트만 말한다(s4-adapter.playwright.js의 BRIDGE 상수).
// public CLI에서 다른 포트를 받으면 어댑터가 붙지 않는 조합을 문서화 없이 허용하게 된다.
// 내부 API(runObservation/runPhaseCapture)는 테스트를 위해 포트를 받되, main은 고정한다.
export const ADAPTER_PORT = 10098;

// 워킹트리 전체가 clean한지 **런타임에** 본다. HEAD blob 결속은 해시 대상 모듈만 보므로
// 그 외 파일(제품 코드·스타일)이 더러워도 통과한다 — 그러면 산출물의 출처가 흐려진다.
// porcelain -z로 읽어 공백·따옴표·rename이 섞인 경로도 놓치지 않는다.
// 워킹트리 authority는 **s4Promote가 소유한다**(승격이 자기 검사를 남에게 맡기지 않도록).
// 여기서는 그것을 그대로 re-export해 캡처 경로가 같은 구현을 쓴다.
export { worktreeDirtyEntries };

export function parseCaptureArgs(argv, spec) {
  const out = { phase: null, port: 10098, discover: false, canary: null, repeat: 1, timeoutMs: RPC_TIMEOUT_MS };
  const rest = [];
  const seenFlags = new Set();
  for (const a of argv) {
    if (a !== '--discover') { rest.push(a); continue; }
    if (seenFlags.has('--discover')) return { error: 'DUPLICATE_FLAG --discover' };
    seenFlags.add('--discover'); out.discover = true;
  }
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i], v = rest[i + 1];
    if (v === undefined) return { error: `MISSING_VALUE ${k}` };
    if (seenFlags.has(k)) return { error: `DUPLICATE_FLAG ${k}` };
    seenFlags.add(k);
    if (k === '--phase') out.phase = v;
    else if (k === '--port') out.port = Number(v);
    else if (k === '--canary') out.canary = v;
    else if (k === '--repeat') out.repeat = Number(v);
    else if (k === '--timeoutMs') out.timeoutMs = Number(v);
    else return { error: `UNKNOWN_ARG ${k}` };
  }
  const modes = [out.discover, !!out.canary, !!out.phase].filter(Boolean).length;
  if (modes !== 1) return { error: 'EXACTLY_ONE_MODE (--discover | --canary <surface> | --phase <light|dark>)' };
  if (out.phase && !PHASES.includes(out.phase)) return { error: `PHASE_REQUIRED (${PHASES.join('|')})` };
  if (out.canary) {
    const names = (spec && spec.REQUIRED_SMOKE_SURFACES ? spec.REQUIRED_SMOKE_SURFACES : []).map((x) => x.name);
    if (names.length && !names.includes(out.canary)) return { error: `UNKNOWN_SURFACE ${out.canary}` };
    if (!Number.isInteger(out.repeat) || out.repeat < 2 || out.repeat > 5)
      return { error: `REPEAT_RANGE ${out.repeat} (2..5 — 1회는 재현성 증거가 아니다)` };
  } else if (out.repeat !== 1) return { error: 'REPEAT_ONLY_WITH_CANARY' };
  if (!Number.isInteger(out.port) || out.port < 1024 || out.port > 65535) return { error: `BAD_PORT ${out.port}` };
  if (!Number.isInteger(out.timeoutMs) || out.timeoutMs < 100) return { error: `BAD_TIMEOUT ${out.timeoutMs}` };
  return out;
}

// 네트워크가 정말 조용해졌는지. 고정 sleep은 느린 응답을 놓친다.
async function waitIdle(dd, name) {
  for (let t = 0; t < 60; t += 1) {
    const st = await dd.evaluate(NETWORK_IDLE_SOURCE, 400);
    if (!st || !st.installed) return `NETWORK_HOOK_MISSING ${name}`;
    if (st.stale) return `NETWORK_HOOK_STALE ${name} v${st.version}`;
    if (st.idle) return null;
    await dd.sleep(200);
  }
  return `NETWORK_NEVER_IDLE ${name}`;
}

// 관찰이 **실제로 무언가를 잡았는지**. 빈 집합은 두 번 반복해도 digest가 같아 GREEN이 된다.
export function apiOriginParts(apiOrigin) {
  try {
    const u = new URL(apiOrigin);
    const base = u.pathname.replace(/\/$/, '');   // 예: '/api'
    return { origin: u.origin, base };
  } catch (e) { return null; }
}

// URL이 그 API에 속하는지 — **origin exact + path 경계**로 본다.
// startsWith(apiOrigin)는 '/apiary/...'도 통과시켰다(실증).
export function isApiRequest(url, apiOrigin) {
  const parts = apiOriginParts(apiOrigin);
  if (!parts) return false;
  let u = null;
  try { u = new URL(String(url)); } catch (e) { return false; }
  if (u.origin !== parts.origin) return false;
  if (!parts.base) return true;
  return u.pathname === parts.base || u.pathname.startsWith(`${parts.base}/`);
}

// 이 surface가 반드시 냈어야 하는 route-load 요청. 지금은 track 상세로 가는 화면만 안다
// (TrackDetail이 진입 시 GET /api/tracks/{id}를 낸다). 모르는 화면은 null이고 강제하지 않는다.
export function requiredRouteLoad(surface, scenario) {
  const goto = (surface.actions || []).find((a) => a.op === 'goto');
  if (!goto) return null;
  const url = String(goto.url).replace('{id}', String(scenario.trackId));
  if (!/^\/tracks\/\d+$/.test(url)) return null;
  // **surface에 결속한다.** 전역 method+URL 집합으로 보면 한 화면의 GET이 다른 화면의
  // route-load 의무까지 충족한다(실증: canvas의 /tracks/5가 detail 몫까지 대신했다).
  return { surface: surface.name, method: 'GET', url: `${scenario.apiOrigin}/tracks/${scenario.trackId}` };
}

// 관찰이 **실제로 무언가를 잡았는지**. 빈 집합은 두 번 반복해도 digest가 같아 GREEN이 된다.
// expectedSurfaces를 받아 **요청이 0건인 화면**도 잡는다 — observed에 등장한 것만 순회하면
// 23개 중 1개만 요청을 내도 통과한다(실증).
export function liveEvidenceErrors(observed, apiOrigin, expectedSurfaces = [], requiredRequests = []) {
  const errors = [];
  if (!apiOriginParts(apiOrigin)) { errors.push('API_ORIGIN_UNKNOWN'); return errors; }
  if (!observed.length) errors.push('NO_REQUESTS_OBSERVED');
  const counts = new Map();
  for (const name of expectedSurfaces) counts.set(name, 0);      // 0으로 초기화 — 빠진 화면을 본다
  for (const e of observed) counts.set(e.surface, (counts.get(e.surface) || 0) + 1);
  for (const [name, n] of counts) if (!(n > 0)) errors.push(`SURFACE_NO_REQUESTS ${name}`);
  const apiHits = observed.filter((e) => isApiRequest(e.url, apiOrigin));
  if (!apiHits.length) errors.push(`NO_API_REQUESTS ${apiOrigin}`);
  else if (!apiHits.some((e) => e.ok)) errors.push(`NO_SUCCESSFUL_API_REQUEST ${apiOrigin}`);
  // 알려진 route-load 요청은 **그 surface에서** 성공으로 관찰돼야 한다.
  const seen = new Set(observed.filter((e) => e.ok).map((e) => `${e.surface} ${e.method} ${e.url}`));
  for (const req of requiredRequests) {
    if (!req) continue;
    const key = `${req.surface} ${req.method} ${req.url}`;
    if (!seen.has(key)) errors.push(`MISSING_ROUTE_LOAD ${key}`);
  }
  return errors;
}

// surface 귀속과 요청 횟수 — 사람 검수의 근거다.
export function surfaceEndpointMap(observed) {
  const out = {};
  for (const e of observed) {
    const k = `${e.method} ${e.url} ${e.status}`;
    out[e.surface] = out[e.surface] || {};
    out[e.surface][k] = (out[e.surface][k] || 0) + 1;
  }
  return out;
}

// 관찰 결과를 canonical 집합 + digest로. 두 실행이 같은지 exact 비교할 수 있어야 한다.
export function canonicalEndpoints(observed) {
  // **surface와 요청 횟수까지** 포함한다. global endpoint set만 비교하면 surface 간 요청을
  // 교환하거나 횟수를 바꿔도 같은 digest가 나온다(실증).
  const counts = new Map();
  for (const e of observed) {
    const k = `${e.surface} ${e.method} ${e.url} ${e.status} ${e.ok ? 'ok' : 'fail'}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const set = [...counts.entries()].map(([k, n]) => `${k} x${n}`).sort();
  return { set, digest: createHash('sha256').update(set.join('\n')).digest('hex') };
}

// 브리지 driver. 모든 메서드가 {method,args}를 큐에 넣고 어댑터 응답을 기다린다 —
// **판정은 하나도 하지 않는다**(그건 전부 core의 몫이다).
export function createBridgeDriver({ timeoutMs = RPC_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const state = { pending: null, seq: 0, done: false, waiters: new Map() };
  // 모든 RPC에 timeout을 건다 — 상대가 사라지면 무기한 대기하던 자리다(실증: 두 번째 hello).
  const call = (method, args) => new Promise((resolve, reject) => {
    const id = ++state.seq;
    const t = setTimer(() => {
      if (!state.waiters.has(id)) return;
      state.waiters.delete(id);
      reject(new Error(`BRIDGE_RPC_TIMEOUT ${method} after ${timeoutMs}ms`));
    }, timeoutMs);
    state.pending = { id, method, args };
    state.waiters.set(id, { resolve, reject, timer: t, clearTimer });
  });
  const driver = {};
  for (const m of BRIDGE_METHODS) driver[m] = (...args) => call(m, args);
  // 남은 RPC를 정리한다 — 타이머가 남으면 프로세스가 안 끝난다.
  driver.cancelAll = (reason) => {
    for (const [, slot] of state.waiters) {
      if (slot.timer && slot.clearTimer) slot.clearTimer(slot.timer);
      slot.reject(new Error(reason || 'BRIDGE_CANCELLED'));
    }
    state.waiters.clear();
    state.pending = null;
  };
  // screenshot만 base64 → Buffer로 되돌린다(브리지가 JSON이라).
  driver.screenshot = () => call('screenshot', []).then((b64) => Buffer.from(String(b64), 'base64'));
  return { driver, state };
}

export function bridgeResolve(state, body) {
  const slot = state.waiters.get(body && body.id);
  if (!slot) return false;
  state.waiters.delete(body.id);
  if (slot.timer && slot.clearTimer) slot.clearTimer(slot.timer);
  if (body.error) slot.reject(new Error(String(body.error)));
  else slot.resolve(body.value);
  return true;
}

// 캡처에 필요한 시나리오 스칼라. 실제 값의 진위는 레포 안에서 검증할 수 없다(잔존 위험) —
// 그러나 **어디서 왔는지는 명시**된다. 임시 드라이버가 매번 다른 값을 쓰던 상태보다 낫다.
// **dataset identity 필드는 여기서 정하지 않는다.** s4Spec의 SCENARIO_CANON이 단일 원천이고
// 이 객체는 그것을 소비한다. 여기에 따로 적으면 URL이 가리키는 대상과 화면이 클릭하는 대상이
// 갈릴 수 있고, 그때 어느 쪽이 정본인지가 사라진다.
// 아래 직접 적힌 값은 **UI 조작에만 쓰이는** 것들이다(클릭 텍스트·프리셋 색).
export const CAPTURE_SCENARIO = {
  ...RAW_SPEC.SCENARIO_CANON,
  normalItemTitle: 'Alpha Two',
  addMenuEpicLabel: 'Epic',
  scrumInactivePreset: '#DC2626',
  settingsPreset: { editBranchIndex: 0, inactivePresetValue: '#16A34A' },
};

// fingerprint 입력이 되는 모듈들. 캡처 시작 시점에 **HEAD와 같은 바이트**여야 한다.
// CI에서만 보면 늦다 — 이미 만들어진 산출물의 출처를 되돌릴 수 없다.
// 캡처 실행에 관여하는 **전체** 모듈. 이전 판은 3개만 결속했는데, spec·evaluator·promote도
// 액션 해석·paintRect 파생·검증에 직접 관여한다 — 그것들이 바뀌면 산출물의 의미가 달라진다.
// discovery는 관찰만 한다 — 승격 모듈이 clean일 필요가 없고, 요구하면 discovery가
// 승격 준비 상태에 묶여 (b) 순서(discovery 먼저)가 성립하지 않는다.
// 이 CLI의 **정적 import closure**(기계 산출) + 브라우저를 실제로 모는 어댑터.
// 손으로 열거하면 빠진다 — 실증: s4Evaluator가 쓰는 cssColorLiterals.mjs가 없었다.
// 상설 테스트가 closure를 다시 계산해 이 목록과 exact 대조한다.
// **정본은 s4Promote가 소유한다.** 이전 판은 이 스크립트가 목록을 정의해 승격에 넘겼고,
// 그래서 승격 authority의 범위가 caller 손에 있었다. 여기서는 재수출만 한다 —
// capture/audit/promotion이 같은 값을 본다.
export { DISCOVERY_ENTRY, DISCOVERY_HASHED_MODULES, HASHED_MODULES,
  GENERATOR_ENTRY, GENERATOR_HASHED_MODULES };
export const REPO_DIR = fileURLToPath(new URL('../../', import.meta.url));

export function captureSelectors(spec) {
  return [...new Set(Object.values(spec.LIGHT_DIFF_MASKS || {}).map((m) => m.selector))];
}

// 브리지 HTTP 서버 — discovery와 capture가 같은 것을 쓴다.
function makeBridgeServer(state) {
  return createServer((req, res) => {
    const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url && req.url.startsWith('/next')) {
      const t = setInterval(() => {
        if (state.pending) { clearInterval(t); const p = state.pending; state.pending = null; send(p); }
        else if (state.done) { clearInterval(t); send({ done: true }); }
      }, 20);
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { body = null; }
      send({ ok: body ? bridgeResolve(state, body) : false });
    });
  });
}

// ── 브리지 수명주기 primitive ────────────────────────────────────────────────
// **discovery와 phase가 같은 구현을 쓴다.** 이전에는 phase 경로가 lifecycle을 하나도
// 내보내지 않아(실증: 첫 RPC가 곧바로 evaluate) 커밋된 어댑터의 `!page → NO_ACTIVE_ATTEMPT`에
// 걸려 죽었고, shutdown도 없어 어댑터가 닫힌 서버를 폴링했다. 복제 구현을 두면 한쪽만
// 고쳐지므로 primitive를 하나만 둔다.
//
// 계약:
//  - hello로 protocol을 확인한 뒤에만 body를 돈다.
//  - shutdown ACK는 **정상 경로에서만** 필수다. 이미 실패 중이면 best-effort로 두고
//    기존 primary 오류를 덮지 않는다.
//  - body가 던지든 아니든 서버·RPC 타이머를 정리한다.
export async function withBridge({ cli, err, label }, run) {
  const { driver: dd, state: ds } = createBridgeDriver({ timeoutMs: cli.timeoutMs });
  const server = makeBridgeServer(ds);
  await new Promise((r) => server.listen(cli.port, '127.0.0.1', r));
  err(`bridge on ${cli.port} — ${label}`);
  let fatal = null;
  let value = null;
  const setFatal = (c) => { fatal = c || 1; };
  try {
    const hello = await dd.hello(BRIDGE_PROTOCOL);
    if (!hello || hello.protocol !== BRIDGE_PROTOCOL)
      throw new Error(`BRIDGE_PROTOCOL_MISMATCH ${hello && hello.protocol} != ${BRIDGE_PROTOCOL}`);
    value = await run(dd, setFatal);
  } catch (e) {
    // primary를 먼저, **그 다음** lifecycle 진단. 순서를 바꾸면 원인이 부수효과에 묻힌다.
    err(String((e && e.message) || e));
    for (const le of (e && e.lifecycleErrors) || []) err(`  [lifecycle] ${le}`);
    fatal = fatal || 1;
  } finally {
    const UNACKED = Symbol('unacked');
    let ack = UNACKED;
    try {
      ack = await Promise.race([dd.shutdown(),
        new Promise((r) => setTimeout(() => r(UNACKED), SHUTDOWN_TIMEOUT_MS))]);
    } catch (e) { ack = UNACKED; }
    if (!fatal && (ack === UNACKED || !ack || ack.ok !== true)) {
      err(`BRIDGE_SHUTDOWN_UNACKED ${ack === UNACKED ? '(timeout/throw)' : JSON.stringify(ack)}`);
      fatal = 1;
    }
    dd.cancelAll('BRIDGE_CLOSING');
    ds.done = true;
    await new Promise((r) => server.close(r));
  }
  return { code: fatal || 0, value };
}

// attempt 하나를 연다.
//
// **primary 우선순위가 계약이다.** body의 실패가 첫 원인이고, endAttempt의 실패는 그것을
// 덮지 못한다. 실증된 두 구멍을 닫는다:
//   (a) endAttempt 응답을 보지 않아 {ok:false}(어댑터가 context를 못 닫음)가 통과했다.
//   (b) body가 throw가 아니라 **structured {errors:[...]}**로 실패를 알린 경우 primary로
//       취급되지 않아, 뒤이은 endAttempt throw가 유일한 오류로 남았다.
// lifecycle 오류는 버리지 않고 `lifecycleErrors`로 함께 남긴다 — 단, 첫 원인은 primary다.
export async function withAttempt(dd, n, fn) {
  const begun = await dd.beginAttempt(n);
  if (!begun || begun.ok !== true) throw new Error(`BEGIN_ATTEMPT_FAILED ${JSON.stringify(begun)}`);
  let out = null, thrown = null;
  try { out = await fn(); } catch (e) { thrown = e; }
  // structured 실패도 primary다 — throw만 primary로 보면 (b)가 재개통된다.
  const structured = !thrown && out && Array.isArray(out.errors) && out.errors.length
    ? `RUN_ERRORS ${out.errors[0]}` : null;
  let lifecycle = null;
  try {
    const ended = await dd.endAttempt(n);
    if (!ended || ended.ok !== true) lifecycle = `END_ATTEMPT_NOT_OK ${JSON.stringify(ended)}`;
  } catch (e) { lifecycle = `END_ATTEMPT_FAILED ${(e && e.message) || e}`; }

  if (thrown) {                                  // throw primary 보존
    if (lifecycle) thrown.lifecycleErrors = [...(thrown.lifecycleErrors || []), lifecycle];
    throw thrown;
  }
  if (structured) {                              // structured primary 보존
    if (lifecycle) out.lifecycleErrors = [...(out.lifecycleErrors || []), lifecycle];
    return out;
  }
  if (lifecycle) throw new Error(lifecycle);     // primary가 없을 때만 lifecycle이 원인이다
  return out;
}

// 관찰 실행(브리지 수명주기 + 증거 판정). main의 HEAD 게이트를 통과한 뒤 호출된다.
//
// **분리한 이유**: 이 구간은 fake adapter로 전수 테스트해야 하는데, main 전체를 돌리면
// HEAD 결속 때문에 워킹트리가 clean일 때만 통과한다. 게이트에 테스트용 우회 스위치를 만드는 건
// 그 자체가 구멍이라, 게이트는 main에 남기고 수명주기만 여기로 뺀다.
export async function runObservation({ SPEC, cli, head, log = console.log, err = console.error }) {

    const targets = cli.canary
      ? SPEC.REQUIRED_SMOKE_SURFACES.filter((x) => x.name === cli.canary)
      : SPEC.REQUIRED_SMOKE_SURFACES;
    // 브리지는 **하나만** 유지한다. 반복마다 서버를 새로 만들면 어댑터는 첫 세션에서
    // 종료해 두 번째 hello가 무기한 대기한다(실증). 반복은 attempt lifecycle로 표현한다.
    const runs = [];
    const session = await withBridge(
      { cli, err, label: cli.canary ? `canary ${cli.canary} x${cli.repeat}` : 'discovery' },
      async (dd, setFatal) => {
      let fatal = null;
      for (let attempt = 0; attempt < cli.repeat; attempt += 1) {
        // attempt마다 **child context만** 새로 만든다(브리지는 그대로).
        const observed = [];
        const failures = [];
        await withAttempt(dd, attempt + 1, async () => {
          const ack = await dd.addInitScript(NETWORK_INSTALL_SOURCE);
          if (!ack || ack.ok !== true || ack.version !== NETWORK_HOOK_VERSION)
            throw new Error(`ADD_INIT_SCRIPT_NOT_ACKED ${JSON.stringify(ack)}`);
          for (const surface of targets) {
            const r = await executeSurfaceSteps({ surface, rawContext: CAPTURE_SCENARIO, driver: dd,
              raster: SPEC.RASTER_CONTRACT });
            if (r.errors.length) { failures.push(`${surface.name}: ${r.errors[0]}`); continue; }
            const idleErr = await waitIdle(dd, surface.name);
            if (idleErr) { failures.push(idleErr); continue; }
            const drained = await dd.evaluate(NETWORK_DRAIN_SOURCE, null);
            if (!drained || drained.ok !== true) { failures.push(`${surface.name}: DRAIN ${JSON.stringify(drained)}`); continue; }
            if (drained.installedAtReadyState !== 'loading')
              failures.push(`${surface.name}: HOOK_INSTALLED_TOO_LATE ${drained.installedAtReadyState}`);
            for (const e of drained.entries)
              observed.push({ surface: surface.name, method: e.method, url: e.url, status: e.status, ok: e.ok });
          }
        });
        if (failures.length) {
          err(`OBSERVE_INCOMPLETE — attempt ${attempt + 1}, ${failures.length}건`);
          for (const f of failures) err(`  ${f}`);
          fatal = 1; setFatal(1); break;
        }
        // 빈 관찰은 재현성 증거가 아니다 — 두 번 다 0건이면 digest가 같아 GREEN이 된다(실증).
        const live = liveEvidenceErrors(observed, CAPTURE_SCENARIO.apiOrigin,
          targets.map((x) => x.name),
          targets.map((x) => requiredRouteLoad(x, CAPTURE_SCENARIO)).filter(Boolean));
        if (live.length) {
          err(`OBSERVE_NO_EVIDENCE — attempt ${attempt + 1}`);
          for (const e of live) err(`  ${e}`);
          fatal = 1; setFatal(1); break;
        }
        runs.push({ observed, ...canonicalEndpoints(observed) });
      }
      // **drift는 shutdown 전에 확정한다.** finally 뒤에서 판정하면 shutdown 무응답이 먼저
      // fatal을 세워 drift가 통째로 사라진다(실증: BRIDGE_SHUTDOWN_UNACKED만 남았다).
      // 여기서 fatal이 서면 아래 shutdown은 자동으로 best-effort가 된다.
      if (!fatal) {
        const drift = runs.slice(1).findIndex((r) => r.digest !== runs[0].digest);
        if (drift >= 0) {
          err(`ENDPOINT_DRIFT_BETWEEN_RUNS run1 vs run${drift + 2}`);
          const a = new Set(runs[0].set), b = new Set(runs[drift + 1].set);
          for (const x of runs[0].set) if (!b.has(x)) err(`  -${x}`);
          for (const x of runs[drift + 1].set) if (!a.has(x)) err(`  +${x}`);
          fatal = 1; setFatal(1);
        }
      }
      return null;
    });
    if (session.code) return { code: session.code, payload: null };

    const payload = {
      mode: cli.canary ? 'canary' : 'discovery',
      eligibleForManifest: !cli.canary,
      provenance: { headCommit: head.headCommit, blobs: head.blobs,
        specFingerprint: specFingerprint(SPEC, (v) => createHash('sha256').update(v).digest('hex')),
        hookVersion: NETWORK_HOOK_VERSION, bridgeProtocol: BRIDGE_PROTOCOL },
      surfaces: targets.map((x) => x.name),
      surfacesCompleted: targets.length,
      repeats: cli.repeat,
      digest: runs[0].digest,
      endpoints: runs[0].set,
      // 사람 검수를 위해 surface 귀속과 요청 횟수를 보존한다.
      bySurface: surfaceEndpointMap(runs[0].observed),
    };
    err(cli.canary
      ? 'canary 완료 — 부분 관찰이므로 manifest 근거로 쓸 수 없다(eligibleForManifest:false).'
      : 'discovery 완료 — 아무것도 쓰지 않았다. 사람이 검수해 EXPECTED_DATASET_MANIFEST를 별도 커밋할 것.');
    return { code: 0, payload };
}

export async function main(argv, { log = console.log, err = console.error } = {}) {
  const rawSnap0 = snapshotSpec(RAW_SPEC);
  const cli = parseCaptureArgs(argv, rawSnap0.spec);
  if (cli.error) {
    err('usage: node scripts/s4-capture.mjs (--discover | --canary <surface> --repeat 2 | --phase <light|dark>) [--port 10098]');
    err(`  ${cli.error}`);
    return 2;
  }

  // public CLI는 커밋된 어댑터가 말하는 포트만 쓴다.
  if (cli.port !== ADAPTER_PORT) {
    err(`PORT_FIXED ${cli.port} != ${ADAPTER_PORT} (커밋된 어댑터가 말하는 포트다)`);
    return 1;
  }
  // spec은 캡처 시작 전에 한 번 스냅샷한다 — 캡처 도중 값이 갈리면 산출물의 의미가 흔들린다.
  const snap = snapshotSpec(RAW_SPEC);
  if (snap.errors.length) { err(`SPEC_NOT_PLAIN — total=${snap.errors.length}`); for (const e of snap.errors.slice(0, 10)) err(`  ${e}`); return 1; }
  const SPEC = snap.spec;

  // ── 관찰(discovery / canary) ────────────────────────────────────────────────
  // 두 모드는 **같은 코드**를 쓴다. 다른 것은 대상 surface 집합과 반복 횟수뿐이다.
  //
  // ⚠️ worktree/HEAD 게이트는 **여기(관찰 경로)와 orchestrator(phase 경로)에 각각 하나씩**
  // 있고 서로 겹치지 않는다. main에 공통 게이트를 두면 orchestrator를 우회하는 mutant가
  // main의 게이트에 걸려 잡히지 않는다(실증).
  if (cli.discover || cli.canary) {
    const dirtyObs = worktreeDirtyEntries(REPO_DIR);
    if (dirtyObs.length) {
      err(`WORKTREE_DIRTY — total=${dirtyObs.length}`);
      for (const e of dirtyObs.slice(0, 20)) err(`  ${e}`);
      return 1;
    }
    const head = headBlobBinding(REPO_DIR, DISCOVERY_HASHED_MODULES);
    if (head.errors.length) {
      err(`HEAD_BINDING_FAILED — total=${head.errors.length}`);
      for (const e of head.errors) err(`  ${e}`);
      return 1;
    }
    const r = await runObservation({ SPEC, cli, head, log: () => {}, err });
    if (r.code) return r.code;
    // 관찰 도중 워킹카피가 바뀌었으면 이 목록의 출처가 흔들린다 — **출력 전에** 확인한다.
    const head2 = headBlobBinding(REPO_DIR, DISCOVERY_HASHED_MODULES, head.headCommit);
    if (head2.errors.length || JSON.stringify(head2.blobs) !== JSON.stringify(head.blobs)) {
      err('HEAD_BINDING_DRIFTED_DURING_OBSERVE');
      for (const e of head2.errors) err(`  ${e}`);
      return 1;
    }
    const dirty1 = worktreeDirtyEntries(REPO_DIR);
    if (dirty1.length) {
      err(`WORKTREE_DIRTIED_DURING_OBSERVE — total=${dirty1.length}`);
      for (const e of dirty1.slice(0, 20)) err(`  ${e}`);
      return 1;
    }
    log(JSON.stringify(r.payload, null, 1));
    return 0;
  }

  // ── phase capture는 dataset 계약이 성립한 뒤에만 시작한다 ──────────────────
  // 브리지를 열기 **전에** 본다. 나중에 보면 브라우저를 다 몰고 나서야 계약 부재를 알게 되고,
  // 그 사이 candidate가 생길 여지가 남는다. discovery/canary는 계약 없이 endpoint를 찾는
  // 용도이므로 이 게이트를 적용하지 않는다(위에서 이미 return했다).
  const contractErrors = validateDatasetContract(SPEC, buildActionContext(CAPTURE_SCENARIO));
  if (contractErrors.length) {
    err(`DATASET_CONTRACT_FAILED — total=${contractErrors.length}`);
    for (const e of contractErrors.slice(0, 20)) err(`  ${e}`);
    return 1;
  }

  const fixturesDir = fileURLToPath(new URL('../library/__fixtures__/', import.meta.url));
  // **production sink는 non-exported다.** 다른 곳에서 부를 수 없으므로 우회 경로가 없다.
  return runPhaseCaptureImpl({ SPEC, cli, fixturesDir, log, err });
}

// phase 캡처 실행. **runObservation과 같은 이유로 main에서 분리한다** — fake adapter로
// 수명주기와 실패 경로를 전수 시험해야 하는데, main 전체는 HEAD 결속 때문에 워킹트리가
// clean일 때만 통과한다. 게이트에 테스트용 우회를 만드는 대신 게이트는 main에 남긴다.
// **pure core: 메모리 결과만 돌려준다.** 파일도 쓰지 않고 provenance 루트도 받지 않는다.
// 브리지/runner 축은 이 함수로 시험하고, 쓰기와 HEAD/worktree 게이트는 main이 소유한다.
// 이렇게 나눠야 exported writer가 caller가 준 repoDir로 provenance를 바꾸는 경로가 없다.
export async function capturePhaseCore({ SPEC, cli, head, log = console.log, err = console.error }) {
  // **discovery와 같은 수명주기 primitive를 쓴다.** 이전 판은 lifecycle을 하나도 내보내지
  // 않아 커밋된 어댑터의 `!page → NO_ACTIVE_ATTEMPT`에 첫 RPC부터 걸렸다(실증).
  const session = await withBridge({ cli, err, label: `phase=${cli.phase}` }, async (dd, setFatal) => {
    const r = await withAttempt(dd, 1, () => runCapture({
      spec: SPEC, rawContext: CAPTURE_SCENARIO, driver: dd,
      selectors: captureSelectors(SPEC), phase: cli.phase,
      // 산출물에 "무엇이 만들었나"를 새긴다 — 승인 시 재대조한다.
      provenance: { headCommit: head.headCommit, blobs: head.blobs,
        specFingerprint: specFingerprint(SPEC, (v) => createHash('sha256').update(v).digest('hex')) },
    }));
    // 러너 오류는 **primary**다. 여기서 fatal을 세워야 뒤따르는 shutdown이 best-effort가 되고,
    // 어댑터가 ACK를 못 줘도 BRIDGE_SHUTDOWN_UNACKED가 원래 실패를 덮지 않는다(실증).
    if (r && Array.isArray(r.errors) && r.errors.length) setFatal(1);
    return r;
  });
  const result = session.value;

  // ── 반환 직후 검사 ────────────────────────────────────────────────────────
  // **errors를 먼저 본다.** 이전 판은 dataset digest와 provenance를 먼저 만졌고,
  // 실패 시 context가 null이라 `context.provenance`에서 TypeError로 죽었다(실증).
  // 그건 controlled error가 아니라 크래시이고, 그 뒤의 write 게이트에 도달하지도 못한다.
  if (result && Array.isArray(result.errors) && result.errors.length) {
    err(`CAPTURE FAILED — total=${result.errors.length}`);
    for (const e of result.errors.slice(0, 20)) err(`  ${e}`);
    // primary **다음에** lifecycle 진단을 낸다 — result에만 붙고 사라지면 어댑터가
    // attempt를 못 닫았다는 사실이 사람 눈에 안 보인다.
    for (const e of (result.lifecycleErrors || [])) err(`  [lifecycle] ${e}`);
    return { code: 1, result: null };               // 아무것도 쓰지 않는다
  }
  if (result && (result.lifecycleErrors || []).length)
    for (const e of result.lifecycleErrors) err(`[lifecycle] ${e}`);
  // 브리지 수명주기 자체의 오류(protocol 불일치·shutdown 미ACK 등). 이미 err로 보고됐다.
  if (session.code) return { code: session.code, result: null };
  if (!result || typeof result !== 'object') { err('CAPTURE_RESULT_SHAPE'); return { code: 1, result: null }; }
  if (!Array.isArray(result.errors)) { err('CAPTURE_ERRORS_SHAPE'); return { code: 1, result: null }; }
  if (!result.context || typeof result.context !== 'object' || Array.isArray(result.context)) {
    err('CAPTURE_CONTEXT_MISSING'); return { code: 1, result: null };
  }
  if (!Array.isArray(result.datasetStart) || !Array.isArray(result.datasetEnd)) {
    err('CAPTURE_DATASET_MISSING'); return { code: 1, result: null };
  }

  // 데이터셋 postflight: 시작·종료 digest가 같아야 한다(캡처 도중 데이터가 바뀌지 않았음).
  const sha256 = (v) => createHash('sha256').update(v).digest('hex');
  const dStart = datasetDigest(result.datasetStart, SPEC, sha256);
  const dEnd = datasetDigest(result.datasetEnd, SPEC, sha256);
  if (dStart.errors.length || dEnd.errors.length) {
    err('DATASET_DIGEST_FAILED');
    for (const e of [...dStart.errors, ...dEnd.errors].slice(0, 10)) err(`  ${e}`);
    return { code: 1, result: null };
  }
  if (dStart.digest !== dEnd.digest) {
    err(`DATASET_CHANGED_DURING_CAPTURE ${dStart.digest} != ${dEnd.digest}`);
    return { code: 1, result: null };
  }
  result.context.provenance.datasetDigest = dStart.digest;
  result.contextRaw = JSON.stringify(result.context, null, 1);

  return { code: 0, result };
}

// 게이트의 **순수 결정 함수**. git 출력과 HEAD 결속 결과만 받아 통과/차단을 정한다.
// production은 module-bound 실제 git만 쓰고(주입 없음), 테스트는 이 함수 또는 임시 checkout의
// 실제 CLI를 쓴다 — 게이트 자체에 우회 스위치를 만들지 않기 위한 분리다.
export function phaseGateDecision({ stage, dirtyEntries, head, pinnedBlobs, canonPaths,
  startCommit, currentCommit }) {
  const out = [];
  if (stage !== 'start' && stage !== 'end') return { ok: false, errors: [`GATE_STAGE_INVALID ${String(stage)}`] };
  if (!Array.isArray(dirtyEntries)) return { ok: false, errors: [`GATE_DIRTY_SHAPE ${stage}`] };
  if (dirtyEntries.length) {
    out.push(`${stage === 'start' ? 'WORKTREE_DIRTY' : 'WORKTREE_DIRTIED_DURING_CAPTURE'} — total=${dirtyEntries.length}`);
    for (const e of dirtyEntries.slice(0, 20)) out.push(`  ${e}`);
    return { ok: false, errors: out };
  }
  // head 형태를 fail-closed로 본다. {errors:[],blobs:null,headCommit:null}은 "검사하지 않았다"는
  // 뜻이고, 그것이 통과하면 게이트가 있으나 마나다.
  if (!head || typeof head !== 'object' || !Array.isArray(head.errors))
    return { ok: false, errors: [`GATE_HEAD_SHAPE ${stage}`] };
  if (head.errors.length) {
    out.push(stage === 'start' ? `HEAD_BINDING_FAILED — total=${head.errors.length}`
      : 'HEAD_BINDING_DRIFTED_DURING_CAPTURE');
    for (const e of head.errors) out.push(`  ${e}`);
    return { ok: false, errors: out };
  }
  if (typeof head.headCommit !== 'string' || !/^[0-9a-f]{40}$/.test(head.headCommit))
    return { ok: false, errors: [`GATE_HEAD_COMMIT_INVALID ${stage} ${String(head.headCommit)}`] };
  if (!head.blobs || typeof head.blobs !== 'object' || Array.isArray(head.blobs)
    || Object.getPrototypeOf(head.blobs) !== Object.prototype)
    return { ok: false, errors: [`GATE_HEAD_BLOBS_SHAPE ${stage}`] };
  const gotKeys = Object.keys(head.blobs).sort();
  const wantKeys = [...(canonPaths || [])].sort();
  if (!wantKeys.length) return { ok: false, errors: [`GATE_CANON_PATHS_MISSING ${stage}`] };
  if (JSON.stringify(gotKeys) !== JSON.stringify(wantKeys))
    return { ok: false, errors: [`GATE_HEAD_BLOB_PATHS ${stage} [${gotKeys}] != [${wantKeys}]`] };
  for (const [k, v] of Object.entries(head.blobs))
    if (typeof v !== 'string' || !/^[0-9a-f]{40}$/.test(v))
      return { ok: false, errors: [`GATE_HEAD_BLOB_OID ${stage} ${k}`] };
  if (stage === 'end') {
    // **HEAD 이동을 독립적으로 본다.** pinnedCommit으로 blob을 읽는 것만으로는 캡처 도중
    // HEAD가 다른 commit으로 옮겨간 것을 알 수 없다(인프라 파일이 같으면 blob도 같다).
    if (typeof currentCommit !== 'string' || !/^[0-9a-f]{40}$/.test(currentCommit))
      return { ok: false, errors: [`GATE_CURRENT_COMMIT_INVALID ${String(currentCommit)}`] };
    if (currentCommit !== startCommit)
      return { ok: false, errors: [`HEAD_MOVED_DURING_CAPTURE ${startCommit} -> ${currentCommit}`] };
    if (pinnedBlobs !== undefined && JSON.stringify(head.blobs) !== JSON.stringify(pinnedBlobs))
      return { ok: false, errors: ['HEAD_BINDING_DRIFTED_DURING_CAPTURE', '  BLOBS_DIFFER'] };
  }
  return { ok: true, errors: [] };
}

// **production orchestration.** 시작·종료의 worktree/HEAD 검증을 한 경로가 모두 소유한다.
// REPO_DIR만 쓴다 — provenance 루트는 인자로 받지 않는다.
// exec만 주입 가능하다(git 호출 주체). 그래야 dirty 상황을 **행동으로** 시험할 수 있고,
// 게이트 자체에는 우회 스위치가 없다.
async function runPhaseCaptureImpl({ SPEC, cli, fixturesDir, log = console.log, err = console.error }) {
  const repoDir = REPO_DIR;
  // git은 **module-bound**다 — 주입 지점이 없다.

  const readHeadCommit = () => {
    return currentHeadCommit(repoDir);
  };
  // ① 시작: worktree를 **정확히 한 번** 읽는다. 두 번 읽으면 첫 관측이 dirty인데 두 번째가
  // clean인 창이 생기고, 그 사이에 HEAD 결속이 끼어든다.
  const dirty0 = worktreeDirtyEntries(repoDir);
  if (dirty0.length) {
    const g = phaseGateDecision({ stage: 'start', dirtyEntries: dirty0, head: null, canonPaths: HASHED_MODULES });
    for (const e of g.errors) err(e);
    return 1;                                   // headBlobBinding을 부르지 않는다
  }
  // ② clean일 때만 HEAD를 한 번 계산한다.
  const head = headBlobBinding(repoDir, HASHED_MODULES);
  const g0 = phaseGateDecision({ stage: 'start', dirtyEntries: dirty0, head, canonPaths: HASHED_MODULES });
  if (!g0.ok) { for (const e of g0.errors) err(e); return 1; }
  // ③ pure capture
  const core = await capturePhaseCore({ SPEC, cli, head, log, err });
  if (core.code) return core.code;
  const result = core.result;
  // ④⑤ 종료: 쓰기 전에 다시 본다. 먼저 쓰면 오염된 candidate가 남는다.
  const g1 = phaseGateDecision({ stage: 'end',
    dirtyEntries: worktreeDirtyEntries(repoDir),
    head: headBlobBinding(repoDir, HASHED_MODULES, head.headCommit),
    pinnedBlobs: head.blobs, canonPaths: HASHED_MODULES,
    startCommit: head.headCommit, currentCommit: readHeadCommit() });
  if (!g1.ok) { for (const e of g1.errors) err(e); return 1; }

  // postflight를 통과한 뒤에만 candidate를 기록한다.
  const wErrors = writeCandidate({ fixturesDir, phase: cli.phase, contextRaw: result.contextRaw,
    // 캡처는 **방금 찍은 것을 공개하는 것**이 계약이다 — 이전 candidate가 무엇이든 교체한다.
    expectedCurrentBundleName: CANDIDATE_CAS_ANY,
    pngByCaptureName: result.pngByCaptureName, expectedCaptureNames: result.expectedCaptureNames });
  if (wErrors.length) { err(`WRITE FAILED`); for (const e of wErrors) err(`  ${e}`); return 1; }
  log(`captured phase=${cli.phase} surfaces=${SPEC.REQUIRED_SMOKE_SURFACES.length} → candidate only`);
  log('승격: 두 phase 캡처 후 `node scripts/s4-promote-capture.mjs`');
  return 0;
}

if (process.argv[1] && process.argv[1] === ADAPTER_MODULE_PATH)
  main(process.argv.slice(2)).then((code) => process.exit(code));
