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
import { runCapture, writeCandidate, executeSurfaceSteps, PHASES } from '../library/s4CaptureRunner.mjs';
import { NETWORK_INSTALL_SOURCE, NETWORK_DRAIN_SOURCE, NETWORK_IDLE_SOURCE,
  NETWORK_HOOK_VERSION } from '../library/s4DomProbe.mjs';
import { snapshotSpec, specFingerprint, datasetDigest } from '../library/s4Evaluator.mjs';
import { createHash } from 'node:crypto';
import { headBlobBinding } from '../library/s4Promote.mjs';
import { execSync } from 'node:child_process';

// 이 파일 전체 바이트도 신뢰 입력이다 — 우회 어댑터가 생기면 이 바이트가 그대로인지가 단서다.
export const ADAPTER_MODULE_PATH = fileURLToPath(import.meta.url);

export const BRIDGE_METHODS = ['hello', 'setViewport', 'setStorage', 'goto', 'reload', 'settle',
  'click', 'hover', 'evaluate', 'screenshot', 'sleep', 'addInitScript'];
// 브리지에 **어떤 어댑터가 붙었는지**를 확인한다. HEAD blob은 디스크의 어댑터를 증명할 뿐
// 실제로 그 어댑터가 연결됐다는 증거가 아니다.
export const BRIDGE_PROTOCOL = 's4-bridge/1';

export function parseCaptureArgs(argv, spec) {
  const out = { phase: null, port: 10098, discover: false, canary: null, repeat: 1 };
  const rest = [];
  for (const a of argv) { if (a === '--discover') out.discover = true; else rest.push(a); }
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i], v = rest[i + 1];
    if (v === undefined) return { error: `MISSING_VALUE ${k}` };
    if (k === '--phase') out.phase = v;
    else if (k === '--port') out.port = Number(v);
    else if (k === '--canary') out.canary = v;
    else if (k === '--repeat') out.repeat = Number(v);
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
  return out;
}

// 관찰 결과를 canonical 집합 + digest로. 두 실행이 같은지 exact 비교할 수 있어야 한다.
export function canonicalEndpoints(observed) {
  const set = [...new Set(observed.map((e) => `${e.method} ${e.url} ${e.status} ${e.ok ? 'ok' : 'fail'}`))].sort();
  return { set, digest: createHash('sha256').update(set.join('\n')).digest('hex') };
}

// 브리지 driver. 모든 메서드가 {method,args}를 큐에 넣고 어댑터 응답을 기다린다 —
// **판정은 하나도 하지 않는다**(그건 전부 core의 몫이다).
export function createBridgeDriver() {
  const state = { pending: null, seq: 0, done: false, waiters: new Map() };
  const call = (method, args) => new Promise((resolve, reject) => {
    const id = ++state.seq;
    state.pending = { id, method, args };
    state.waiters.set(id, { resolve, reject });
  });
  const driver = {};
  for (const m of BRIDGE_METHODS) driver[m] = (...args) => call(m, args);
  // screenshot만 base64 → Buffer로 되돌린다(브리지가 JSON이라).
  driver.screenshot = () => call('screenshot', []).then((b64) => Buffer.from(String(b64), 'base64'));
  return { driver, state };
}

export function bridgeResolve(state, body) {
  const slot = state.waiters.get(body && body.id);
  if (!slot) return false;
  state.waiters.delete(body.id);
  if (body.error) slot.reject(new Error(String(body.error)));
  else slot.resolve(body.value);
  return true;
}

// 캡처에 필요한 시나리오 스칼라. 실제 값의 진위는 레포 안에서 검증할 수 없다(잔존 위험) —
// 그러나 **어디서 왔는지는 명시**된다. 임시 드라이버가 매번 다른 값을 쓰던 상태보다 낫다.
export const CAPTURE_SCENARIO = {
  trackId: 5,
  normalItemTitle: 'Alpha Two',
  branchName: '- Alpha',
  epicName: 'Alpha Epic',
  addMenuEpicLabel: 'Epic',
  scrumBoardId: 10,
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
export const DISCOVERY_ENTRY = 'frontend/scripts/s4-capture.mjs';
export const DISCOVERY_HASHED_MODULES = [
  'frontend/library/cssColorLiterals.mjs',
  'frontend/library/s4Canonicalize.mjs',
  'frontend/library/s4CaptureRunner.mjs',
  'frontend/library/s4DomProbe.mjs',
  'frontend/library/s4Evaluator.mjs',
  'frontend/library/s4Promote.mjs',
  'frontend/library/s4Spec.mjs',
  'frontend/scripts/s4-capture.mjs',
  // 어댑터는 import되지 않는다(브라우저 프로세스에서 돈다) — 그래서 명시적으로 더한다.
  'frontend/scripts/s4-adapter.playwright.js',
];
// 캡처는 산출물을 만든다 — 승격까지의 전 경로가 clean이어야 한다.
export const HASHED_MODULES = [
  ...DISCOVERY_HASHED_MODULES,
  'frontend/scripts/s4-promote-capture.mjs',
];
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

export async function main(argv, { log = console.log, err = console.error } = {}) {
  const rawSnap0 = snapshotSpec(RAW_SPEC);
  const cli = parseCaptureArgs(argv, rawSnap0.spec);
  if (cli.error) {
    err('usage: node scripts/s4-capture.mjs (--discover | --canary <surface> --repeat 2 | --phase <light|dark>) [--port 10098]');
    err(`  ${cli.error}`);
    return 2;
  }

  // spec은 캡처 시작 전에 한 번 스냅샷한다 — 캡처 도중 값이 갈리면 산출물의 의미가 흔들린다.
  const snap = snapshotSpec(RAW_SPEC);
  if (snap.errors.length) { err(`SPEC_NOT_PLAIN — total=${snap.errors.length}`); for (const e of snap.errors.slice(0, 10)) err(`  ${e}`); return 1; }
  const SPEC = snap.spec;

  // 캡처 시작 전에 해시 입력 모듈이 clean HEAD인지 확인한다. 그렇지 않으면 산출물의
  // "어떤 코드가 만들었나"가 리뷰 diff에 남지 않는다.
  const head = headBlobBinding(REPO_DIR, (cli.discover || cli.canary) ? DISCOVERY_HASHED_MODULES : HASHED_MODULES,
    (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  if (head.errors.length) {
    err(`HEAD_BINDING_FAILED — total=${head.errors.length}`);
    for (const e of head.errors) err(`  ${e}`);
    return 1;
  }

  // ── 관찰(discovery / canary) ────────────────────────────────────────────────
  // 두 모드는 **같은 코드**를 쓴다. 다른 것은 대상 surface 집합과 반복 횟수뿐이다.
  if (cli.discover || cli.canary) {
    const targets = cli.canary
      ? SPEC.REQUIRED_SMOKE_SURFACES.filter((x) => x.name === cli.canary)
      : SPEC.REQUIRED_SMOKE_SURFACES;
    const runs = [];
    for (let attempt = 0; attempt < cli.repeat; attempt += 1) {
      const { driver: dd, state: ds } = createBridgeDriver();
      const server0 = makeBridgeServer(ds);
      await new Promise((r) => server0.listen(cli.port, '127.0.0.1', r));
      err(`bridge on ${cli.port} — ${cli.canary ? `canary ${cli.canary} #${attempt + 1}/${cli.repeat}` : 'discovery'}`);
      const observed = [];
      const failures = [];
      const waitIdle = async (name) => {
        for (let t = 0; t < 60; t += 1) {
          const st = await dd.evaluate(NETWORK_IDLE_SOURCE, 400);
          if (!st || !st.installed) return `NETWORK_HOOK_MISSING ${name}`;
          if (st.stale) return `NETWORK_HOOK_STALE ${name} v${st.version}`;
          if (st.idle) return null;
          await dd.sleep(200);
        }
        return `NETWORK_NEVER_IDLE ${name}`;
      };
      try {
        // 어댑터 handshake — 붙은 쪽이 같은 protocol의 커밋된 어댑터인지 확인한다.
        const hello = await dd.hello(BRIDGE_PROTOCOL);
        if (!hello || hello.protocol !== BRIDGE_PROTOCOL) {
          err(`BRIDGE_PROTOCOL_MISMATCH ${hello && hello.protocol} != ${BRIDGE_PROTOCOL}`);
          return 1;
        }
        if (typeof dd.addInitScript !== 'function') { err('DRIVER_NO_ADD_INIT_SCRIPT'); return 1; }
        // ACK는 hook이 실제로 심겼다는 응답이어야 한다 — 예외를 삼키고 true를 돌려주면 안 된다.
        const ack = await dd.addInitScript(NETWORK_INSTALL_SOURCE);
        if (!ack || ack.ok !== true || ack.version !== NETWORK_HOOK_VERSION) {
          err(`ADD_INIT_SCRIPT_NOT_ACKED ${JSON.stringify(ack)}`);
          return 1;
        }
        for (const surface of targets) {
          const r = await executeSurfaceSteps({ surface, rawContext: CAPTURE_SCENARIO, driver: dd,
            raster: SPEC.RASTER_CONTRACT });
          if (r.errors.length) { failures.push(`${surface.name}: ${r.errors[0]}`); continue; }
          const idleErr = await waitIdle(surface.name);
          if (idleErr) { failures.push(idleErr); continue; }
          const drained = await dd.evaluate(NETWORK_DRAIN_SOURCE, null);
          if (!drained || drained.ok !== true) { failures.push(`${surface.name}: DRAIN ${JSON.stringify(drained)}`); continue; }
          // 새 문서에서 hook이 **로드 이전**에 심겼는지 — navigation-time 요청을 잡았다는 증거다.
          if (drained.installedAtReadyState !== 'loading')
            failures.push(`${surface.name}: HOOK_INSTALLED_TOO_LATE ${drained.installedAtReadyState}`);
          for (const e of drained.entries)
            observed.push({ surface: surface.name, method: e.method, url: e.url, status: e.status, ok: e.ok });
        }
      } finally { ds.done = true; await new Promise((r) => server0.close(r)); }
      if (failures.length) {
        err(`OBSERVE_INCOMPLETE — ${failures.length}건`);
        for (const f of failures) err(`  ${f}`);
        return 1;
      }
      runs.push({ observed, ...canonicalEndpoints(observed) });
    }

    // 종료 시점 HEAD 재검증 — 관찰 도중 워킹카피가 바뀌면 이 목록의 출처가 흔들린다.
    const head2 = headBlobBinding(REPO_DIR, DISCOVERY_HASHED_MODULES,
      (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), head.headCommit);
    if (head2.errors.length || JSON.stringify(head2.blobs) !== JSON.stringify(head.blobs)) {
      err('HEAD_BINDING_DRIFTED_DURING_OBSERVE');
      for (const e of head2.errors) err(`  ${e}`);
      return 1;
    }
    // 반복 실행은 **exact 일치**해야 한다. 다르면 그 화면은 아직 결정적이지 않다.
    const drift = runs.slice(1).findIndex((r) => r.digest !== runs[0].digest);
    if (drift >= 0) {
      err(`ENDPOINT_DRIFT_BETWEEN_RUNS run1 vs run${drift + 2}`);
      const a = new Set(runs[0].set), b = new Set(runs[drift + 1].set);
      for (const x of runs[0].set) if (!b.has(x)) err(`  -${x}`);
      for (const x of runs[drift + 1].set) if (!a.has(x)) err(`  +${x}`);
      return 1;
    }
    log(JSON.stringify({
      mode: cli.canary ? 'canary' : 'discovery',
      // 카나리는 일부 화면만 본다 — manifest 근거로 쓰면 안 된다.
      eligibleForManifest: !cli.canary,
      provenance: { headCommit: head.headCommit, blobs: head.blobs,
        specFingerprint: specFingerprint(SPEC, (v) => createHash('sha256').update(v).digest('hex')),
        hookVersion: NETWORK_HOOK_VERSION, bridgeProtocol: BRIDGE_PROTOCOL },
      surfaces: targets.map((x) => x.name),
      surfacesCompleted: targets.length,
      repeats: cli.repeat,
      digest: runs[0].digest,
      endpoints: runs[0].set,
    }, null, 1));
    err(cli.canary
      ? 'canary 완료 — 부분 관찰이므로 manifest 근거로 쓸 수 없다(eligibleForManifest:false).'
      : 'discovery 완료 — 아무것도 쓰지 않았다. 사람이 검수해 EXPECTED_DATASET_MANIFEST를 별도 커밋할 것.');
    return 0;
  }

  const { driver, state } = createBridgeDriver();
  const server = makeBridgeServer(state);
  await new Promise((r) => server.listen(cli.port, '127.0.0.1', r));
  err(`bridge on ${cli.port} — phase=${cli.phase}`);

  const fixturesDir = fileURLToPath(new URL('../library/__fixtures__/', import.meta.url));
  let result;
  try {
    result = await runCapture({
      spec: SPEC, rawContext: CAPTURE_SCENARIO, driver,
      selectors: captureSelectors(SPEC), phase: cli.phase,
      // 산출물에 "무엇이 만들었나"를 새긴다 — 승인 시 재대조한다.
      provenance: { headCommit: head.headCommit, blobs: head.blobs,
        specFingerprint: specFingerprint(SPEC, (v) => createHash('sha256').update(v).digest('hex')) },
    });
  } finally { state.done = true; setTimeout(() => server.close(), 200); }

  // 데이터셋 postflight: 시작·종료 digest가 같아야 한다(캡처 도중 데이터가 바뀌지 않았음).
  const sha256 = (v) => createHash('sha256').update(v).digest('hex');
  const dStart = datasetDigest(result.datasetStart || [], SPEC, sha256);
  const dEnd = datasetDigest(result.datasetEnd || [], SPEC, sha256);
  if (dStart.errors.length || dEnd.errors.length) {
    err('DATASET_DIGEST_FAILED');
    for (const e of [...dStart.errors, ...dEnd.errors].slice(0, 10)) err(`  ${e}`);
    return 1;
  }
  if (dStart.digest !== dEnd.digest) {
    err(`DATASET_CHANGED_DURING_CAPTURE ${dStart.digest} != ${dEnd.digest}`);
    return 1;
  }
  result.context.provenance.datasetDigest = dStart.digest;
  result.contextRaw = JSON.stringify(result.context, null, 1);

  // 캡처 종료 후 **쓰기 전에** 재검증한다 — 도중에 워킹카피가 바뀌면 산출물의 출처가 흔들리고,
  // 먼저 쓰면 오염된 candidate가 디스크에 남는다.
  const head2 = headBlobBinding(REPO_DIR, HASHED_MODULES,
    (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), head.headCommit);
  if (head2.errors.length || JSON.stringify(head2.blobs) !== JSON.stringify(head.blobs)) {
    err('HEAD_BINDING_DRIFTED_DURING_CAPTURE');
    for (const e of head2.errors) err(`  ${e}`);
    return 1;
  }

  if (result.errors.length) {
    err(`CAPTURE FAILED — total=${result.errors.length}`);
    for (const e of result.errors.slice(0, 20)) err(`  ${e}`);
    return 1;                                       // 아무것도 쓰지 않는다
  }
  // postflight를 통과한 뒤에만 candidate를 기록한다.
  const wErrors = writeCandidate({ fixturesDir, phase: cli.phase, contextRaw: result.contextRaw,
    pngByCaptureName: result.pngByCaptureName, expectedCaptureNames: result.expectedCaptureNames });
  if (wErrors.length) { err(`WRITE FAILED`); for (const e of wErrors) err(`  ${e}`); return 1; }
  log(`captured phase=${cli.phase} surfaces=${SPEC.REQUIRED_SMOKE_SURFACES.length} → candidate only`);
  log('승격: 두 phase 캡처 후 `node scripts/s4-promote-capture.mjs`');
  return 0;
}

if (process.argv[1] && process.argv[1] === ADAPTER_MODULE_PATH)
  main(process.argv.slice(2)).then((code) => process.exit(code));
