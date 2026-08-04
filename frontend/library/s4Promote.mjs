// frontend/library/s4Promote.mjs
// candidate 생성(staging)과 committed 승격을 **분리된 두 함수**로 둔다.
//
// 이 모듈이 막는 것(전부 리뷰에서 실증된 경로):
//  - `--promote`가 staging을 다시 만든 뒤 승격 → 검토한 candidate가 승격되지 않음
//  - validator를 주입할 수 있어 `validate: () => []`로 `NOT JSON`도 승격됨
//  - `prevSha`를 promote 시작 시점에 읽어, staging 이후 committed가 바뀌어도 그 최신값을
//    정상 기준으로 삼아 오래된 candidate가 덮어씀
//  - CAS 확인과 rename 사이에 lock이 없어, 검증 도중 committed가 바뀌어도 그대로 덮어씀
//  - 고정 temp 경로 → 동시 실행 충돌 / 심볼릭 링크 추적
//
// 계약
//  - stageBytes: 고유 exclusive temp → fsync → atomic rename.
//    **생성 시점의 committed SHA를 함께 동결**해 돌려준다({ candidateSha, baseCommittedSha }).
//  - promoteStaged: staging을 재생성하지 않고 읽는다. validator를 받지 않는다.
//    호출부가 **전체 승인 경로에서 재계산한 canonicalBytes**를 주고, staging과 exact 대조한다.
//    lock을 잡은 뒤 CAS(fromSha) → 대조 → unique temp → rename 까지 한 임계구역에서 처리한다.
import { mkdtempSync, writeFileSync, readFileSync, renameSync, rmSync, openSync, fsyncSync, closeSync,
  lstatSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { join, dirname, basename, sep } from 'node:path';
import { readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
// 구체 검증기를 정적으로 결속한다(주입 금지).
import { readCandidateBundle, CANDIDATE_BUNDLE_DIR } from './s4CaptureRunner.mjs';
import { verifyDiscoveryEvidence } from './s4Evaluator.mjs';
import { snapshotSpec } from './s4Evaluator.mjs';
import { validateCaptureBundle, datasetDigest, validateMaskContract,
  validateDatasetContract, validateScenarioIdentity, validateScenarioCanon,
  buildActionContext } from './s4Evaluator.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

// CLI 문법 정본 — 정확히 두 형태만 허용한다. includes/indexOf 방식은 unknown·중복·여분
// 인자를 통과시키고, `--promote` 오타를 기본 staging 실행으로 떨어뜨려 검토된 candidate를
// 새 candidate로 덮어쓴다(리뷰 실증). 순수 함수로 두고 CLI는 가장 먼저 이걸 부른다.
export const CLI_USAGE = 'usage: node scripts/s4-gen.mjs   (승격 인자는 없다 — 공식 sink는 s4-promote-capture 하나다)';
// **s4-gen에는 승격 모드가 없다.** 독립 sink가 있으면 committed를 바꾸는 경로가 둘이 되고,
// 그때 어느 쪽이 정본인지가 사라진다. 인자를 받으면 그대로 거부한다.
export function parseCliArgs(argv) {
  if (!Array.isArray(argv)) return { error: 'ARGV_REQUIRED' };
  if (argv.length !== 0) return { error: `PROMOTE_MODE_REMOVED ${argv.join(' ')} — s4-promote-capture를 쓸 것` };
  return { mode: 'stage' };
}

export const STAGING_NAME = 's4-expected.candidate.json';   // s4-gen 진단 산출물(정본 아님)
// ⚠️ 전역 s4-expected.json은 **정본 경로에서 제거됐다.** committed expected는
// release.expectedSha가 가리키는 content-addressed 불변 파일이다(아래 EXPECTED_DIR).
export const LEGACY_COMMITTED_NAME = 's4-expected.json';
export const EXPECTED_DIR = 'expected';
const LOCK_NAME = '.s4-promote.lock';

// 디렉터리들이 fixturesDir 안에 실제로 있는지(조상 symlink 포함) 확인한다.
// leaf만 보면 `s4-capture`가 밖을 가리키는 symlink일 때 bundle이 외부에 생성된다(실증).
export function containedDirs(fixturesDir, rels) {
  const errors = [];
  let root = null;
  try { root = realpathSync(fixturesDir); } catch (e) { return [`FIXTURES_DIR_UNREADABLE ${fixturesDir}`]; }
  for (const rel of rels) {
    const p = join(fixturesDir, rel);
    // 존재하는 조상까지 거슬러 올라가 실제 경로가 root 아래인지 본다.
    let probe = p;
    while (probe !== dirname(probe) && !existsSync(probe)) probe = dirname(probe);
    let real = null;
    try { real = realpathSync(probe); } catch (e) { errors.push(`PATH_UNRESOLVABLE ${probe}`); continue; }
    if (real !== root && !real.startsWith(root + sep)) errors.push(`PATH_ESCAPES_FIXTURES ${rel} -> ${real}`);
  }
  return errors;
}

// leaf뿐 아니라 **조상 경로**까지 심볼릭 링크가 없는지 본다.
function symlinkCheck(fixturesDir, leaf) {
  const p = join(fixturesDir, leaf);
  try { if (existsSync(p) && lstatSync(p).isSymbolicLink()) return `SYMLINK_REFUSED ${p}`; } catch (e) { /* noop */ }
  // 조상 심볼릭 링크 자체는 정상일 수 있다(macOS /var → /private/var). 문제는 leaf가
  // fixturesDir **밖**을 가리키는 것이므로 containment로 판정한다.
  let root = null;
  try { root = realpathSync(fixturesDir); } catch (e) { return `FIXTURES_DIR_UNREADABLE ${fixturesDir}`; }
  if (existsSync(p)) {
    try { const rp = realpathSync(p);
      if (rp !== join(root, leaf)) return `PATH_ESCAPES_FIXTURES ${rp}`;
    } catch (e) { return `PATH_UNRESOLVABLE ${p}`; }
  }
  return null;
}

// 고유 temp에 배타 생성 → fsync → atomic rename. temp는 목적지 옆에 둔다(같은 파일시스템).
function atomicWrite(dest, bytes) {
  const dir = mkdtempSync(join(dirname(dest), `.s4-${basename(dest)}-`));
  const tmp = join(dir, 'payload');
  try {
    writeFileSync(tmp, bytes, { flag: 'wx' });
    const fd = openSync(tmp, 'r+'); fsyncSync(fd); closeSync(fd);
    renameSync(tmp, dest);
    return null;
  } catch (e) { return `ATOMIC_WRITE_FAILED ${e && e.message}`; }
  finally { try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
}

const readIfExists = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);


// lock: O_EXCL 파일. 잡지 못하면 즉시 실패(다른 승격이 진행 중).
// lock: O_EXCL 파일. **자동 회수는 하지 않는다.**
// 이전 판은 mtime이 오래됐으면 stale로 보고 unlink했는데, 소유자가 살아 있어도(SIGSTOP·긴 sleep·
// 시계 변경) 탈취돼 상호배제가 깨졌다(리뷰 실증: 소유자 fd가 열린 채 promoted:true). 게다가
// 공개 nowMs 인자로 최근 lock도 stale처럼 만들 수 있었다.
// lock이 있으면 항상 실패하고, 잔재 제거는 별도 명시적 복구 절차의 몫이다.
function withLock(fixturesDir, fn) {
  const lock = join(fixturesDir, LOCK_NAME);
  let fd = null;
  try { fd = openSync(lock, 'wx'); } catch (e) { return { errors: ['PROMOTE_LOCK_BUSY'], promoted: false }; }
  try { return fn(); }
  finally { try { closeSync(fd); } catch (e) { /* noop */ } try { unlinkSync(lock); } catch (e) { /* noop */ } }
}



// ── 캡처 산출물 승격 (candidate → 불변 버전 + 단일 원자 포인터) ───────────────
// 이전 판들의 결함(전부 실증):
//  - 호출부가 committed 경로를 지정해 **dark candidate를 light BASE로** 승격했다.
//  - `../../outside`로 fixtures 밖 디렉터리가 삭제됐다.
//  - PNG 디렉터리를 먼저 갈아끼운 뒤 context를 써서 **혼합 버전**이 남았다.
//  - `validateBundle: () => []` 주입으로 모든 계약이 무력화됐다.
//  - 한 phase를 먼저 승격한 뒤 light/dark를 비교해서, mismatch여도 이미 committed였다.
//
// 지금 구조:
//  - 경로는 phase에서 **내부 파생**. 해시는 **내부 계산**. 검증기는 **정적 결속**.
//  - 버전 디렉터리는 **불변**이고 이름이 곧 내용 digest다.
//  - 포인터 파일 **하나**가 두 phase를 함께 가리킨다 → rename 한 번이 pair 전환이다.
// ⚠️ **이 체크포인트에서 승격은 하드 비활성이다.**
// discovery-only 커밋의 목적은 endpoint 관찰뿐이고, 그 사이에 누구도(실수로도) 산출물을
// committed로 만들 수 없어야 한다. 승격 경로를 열려면 이 상수를 바꾸는 **명시적 커밋**이 필요하고,
// 그때 projector 배선·immutable expected artifact·legacy reader 전환이 함께 와야 한다.
// 승격 활성. 두 blocker는 닫혔다:
//  (1) promoteRelease가 진입 직후 snapshotSpec을 한 번 돌려 evidence·bundle·geometry가
//      같은 frozen spec만 소비한다.
//  (2) discovery evidence의 Git blob을 **모듈 안에서** execFileSync argv로 해석한다.
//      caller는 resolver를 주지 못한다.
export const PROMOTION_ENABLED = true;
// 이 플래그는 **모든 승격 경로**를 막는다: promoteRelease, promoteStaged,
// 그리고 이들을 부르는 CLI(s4-gen --promote / s4-promote-capture).

export const CAPTURE_PHASES = ['light', 'dark'];
export const BUNDLE_ROOT = 's4-capture';
export const VERSIONS_DIR = 'versions';
export const RELEASE_NAME = 'release.json';
export const candidateContextName = (phase) => `s4-smoke-context.${phase}.candidate.json`;
export const candidateShotsDir = (fixturesDir, phase) => join(fixturesDir, 's4-shots', `candidate-${phase}`);
const releasePath = (fixturesDir) => join(fixturesDir, BUNDLE_ROOT, RELEASE_NAME);
const versionDir = (fixturesDir, digest) => join(fixturesDir, BUNDLE_ROOT, VERSIONS_DIR, digest);

// bundle 전체를 하나의 값으로 요약 — 버전 이름이자 CAS 값. 이름 순서에 무관하다.
export function bundleDigest(contextRaw, pngByName) {
  const parts = [`ctx:${sha(contextRaw)}`];
  for (const n of Object.keys(pngByName).sort()) parts.push(`${n}:${sha(pngByName[n])}`);
  return sha(parts.join('\n'));
}

// 포인터는 **두 phase를 함께** 가리킨다. phase마다 따로 두면 rename이 두 번이라 pair 원자성이
// 성립하지 않는다(한쪽만 반영된 상태가 존재할 수 있다).
// release manifest는 **캡처 쌍과 expected fixture를 함께** 가리킨다.
// 따로 두면 capture=B / expected=A 같은 조합이 생긴다(stage와 promote 사이 구간이 안 잠긴다).
export function readRelease(fixturesDir) {
  const p = releasePath(fixturesDir);
  if (!existsSync(p)) return null;
  try { const v = JSON.parse(readFileSync(p, 'utf8'));
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; } catch (e) { return null; }
}

// bundle을 읽는 단일 경로. 포인터 → 불변 버전 디렉터리.
export function readCaptureBundle(fixturesDir, phase) {
  if (!CAPTURE_PHASES.includes(phase)) return { errors: [`BUNDLE_PHASE_INVALID ${phase}`], contextRaw: null, pngByName: null };
  const ptr = readRelease(fixturesDir);
  const digest = ptr && ptr[phase];
  if (!digest) return { errors: [`CAPTURE_BUNDLE_MISSING ${phase}`], contextRaw: null, pngByName: null };
  const dir = versionDir(fixturesDir, digest);
  const ctxPath = join(dir, 'context.json'), shots = join(dir, 'shots');
  if (!existsSync(ctxPath) || !existsSync(shots))
    return { errors: [`CAPTURE_VERSION_MISSING ${phase} ${digest}`], contextRaw: null, pngByName: null };
  const pngByName = {};
  for (const n of readdirSync(shots).filter((x) => !x.startsWith('.'))) pngByName[n] = readFileSync(join(shots, n));
  const contextRaw = readFileSync(ctxPath, 'utf8');
  // 버전 디렉터리는 불변이다 — 내용이 digest와 다르면 디스크가 변조된 것이다.
  const actual = bundleDigest(contextRaw, pngByName);
  if (actual !== digest) return { errors: [`CAPTURE_VERSION_TAMPERED ${phase} ${actual} != ${digest}`], contextRaw: null, pngByName: null };
  return { errors: [], contextRaw, pngByName, digest };
}

// candidate는 **단일 bundle 디렉터리**다(context + PNG). 이전 판은 context 파일과 shots
// 디렉터리를 따로 읽었는데, 그 둘이 서로 다른 캡처에서 온 조합일 수 있었다 —
// writeCandidate가 shots를 먼저 교체하고 context write가 실패하면 정확히 그 상태가 됐다(실증).
function readCandidate(fixturesDir, phase) {
  const r = readCandidateBundle(fixturesDir, phase);
  if (r.errors.length) return { errors: r.errors.map((e) => `PROMOTE_${e}`) };
  for (const n of Object.keys(r.pngByName))
    if (n.includes('/') || n.includes('..')) return { errors: [`PROMOTE_BAD_NAME ${n}`] };
  return { errors: [], contextRaw: r.contextRaw, pngByName: r.pngByName, bundleName: r.bundleName };
}

// **캡처 쌍 + expected fixture를 한 트랜잭션으로** 승격한다.
//
// 왜 함께인가: 이전 판은 캡처 쌍만 전환했고 fixture는 별도 경로였다. 그래서
// (1) geometry 승인 전에 committed가 됐고 (2) capture=B / expected=A 조합이 가능했다.
// release manifest 하나를 rename하면 둘 다 원자적으로 바뀐다.
//
// geometry는 **실제 fixture의 allowIdToKey/changed**가 있어야 판정되므로 여기서 본다 —
// bundle 검증(validateCaptureBundle)은 일부러 생략하고, 그 전까지는 candidate로만 존재한다.
// discovery evidence의 Git blob을 **모듈 안에서** 해석한다.
// caller가 resolver를 주면 승격의 Git 진위가 caller 손에 넘어간다 — 승격은 정본을 만드는
// 유일한 지점이므로 그 권한을 밖에 두지 않는다.
// 부르기 전에 ref(40 hex)와 rel(정본 경로 집합 멤버)을 검증하므로 문자열 보간도 없다.
function promoteGitBlob(repoDir, canonPaths, ref, rel) {
  if (!/^[0-9a-f]{40}$/.test(String(ref))) return null;
  if (!canonPaths.has(String(rel))) return null;
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', `${ref}:${rel}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { return null; }
}

// expected는 **content-addressed 불변 파일**이다. release.expectedSha가 그것을 고른다.
export const expectedPath = (fixturesDir, sha256hex) =>
  join(fixturesDir, BUNDLE_ROOT, EXPECTED_DIR, `${sha256hex}.json`);

// release가 가리키는 expected bytes를 읽고 **SHA exact**를 확인한다.
// 이름을 믿지 않는다 — 정확한 이름으로 변조된 파일을 심어두면 그냥 통과한다.
export function readCommittedExpected(fixturesDir) {
  const rel = readRelease(fixturesDir);
  if (!rel || typeof rel.expectedSha !== 'string') return { errors: ['EXPECTED_NO_RELEASE'], bytes: null };
  const p = expectedPath(fixturesDir, rel.expectedSha);
  if (!existsSync(p)) return { errors: [`EXPECTED_ARTIFACT_MISSING ${rel.expectedSha}`], bytes: null };
  let bytes = null;
  try { bytes = readFileSync(p, 'utf8'); } catch (e) { return { errors: [`EXPECTED_UNREADABLE ${rel.expectedSha}`], bytes: null }; }
  const actual = sha(bytes);
  if (actual !== rel.expectedSha)
    return { errors: [`EXPECTED_SHA_MISMATCH ${actual} != ${rel.expectedSha}`], bytes: null };
  return { errors: [], bytes, expectedSha: rel.expectedSha };
}

// candidates는 **CLI가 이미 읽어 고정한 snapshot**이다. promoteRelease는 그것을 다시
// 읽지 않는다 — 다시 읽으면 CLI가 검증한 것과 다른 candidate를 쓸 수 있다(TOCTOU).
// 대신 commit 직전에 pointer/digest CAS로 교체 여부만 확인한다.
export function promoteRelease({ fixturesDir, spec: rawSpec, provenanceRefs, fromRelease, expectedBytes,
  discoveryEvidence, repoDir, candidates, postflight }) {
  // 하드 비활성 — 인자가 무엇이든 아무것도 쓰지 않는다.
  if (!PROMOTION_ENABLED) return { errors: ['PROMOTION_DISABLED'], promoted: false };
  if (!rawSpec || typeof rawSpec !== 'object') return { errors: ['PROMOTE_SPEC_REQUIRED'], promoted: false };
  // **spec은 진입 직후 정확히 한 번 동결한다.** 이후 evidence·bundle·geometry가 전부
  // 이 snapshot만 소비한다. 단계마다 raw를 다시 읽으면 루트 getter가 조회마다 다른 값을
  // 줄 때 evidence와 downstream이 서로 다른 spec을 보게 된다.
  const snapped = snapshotSpec(rawSpec);
  if (snapped.errors.length) return { errors: snapped.errors.slice(0, 40), promoted: false };
  const spec = snapped.spec;
  if (typeof repoDir !== 'string' || !repoDir) return { errors: ['PROMOTE_REPO_DIR_REQUIRED'], promoted: false };
  // **승격도 evidence preflight 없이는 열리지 않는다.**
  if (!discoveryEvidence || typeof discoveryEvidence !== 'object')
    return { errors: ['PROMOTE_EVIDENCE_REQUIRED'], promoted: false };
  {
    const canonPaths = new Set(spec.PROVENANCE_BLOB_PATHS || []);
    let evErrs = null;
    try {
      evErrs = verifyDiscoveryEvidence({ files: discoveryEvidence.files, spec,
        scenario: buildActionContext(spec.SCENARIO_CANON || {}), sha256Hex: sha,
        gitBlob: (ref, rel) => promoteGitBlob(repoDir, canonPaths, ref, rel) });
    } catch (e) { return { errors: [`PROMOTE_EVIDENCE_THREW ${(e && e.message) || e}`], promoted: false }; }
    if (!Array.isArray(evErrs)) return { errors: ['PROMOTE_EVIDENCE_NONARRAY'], promoted: false };
    if (evErrs.length) return { errors: evErrs.map((e) => `EVIDENCE ${e}`).slice(0, 40), promoted: false };
  }
  if (!provenanceRefs || typeof provenanceRefs !== 'object') return { errors: ['PROMOTE_PROVENANCE_REFS_REQUIRED'], promoted: false };
  if (typeof expectedBytes !== 'string') return { errors: ['PROMOTE_EXPECTED_BYTES_REQUIRED'], promoted: false };
  // **fixture를 따로 받지 않는다.** canonical bytes를 파싱한 바로 그 객체로 geometry를 본다 —
  // 둘이 어긋난 입력 자체가 존재할 수 없다.
  let fixture = null;
  try { fixture = JSON.parse(expectedBytes); }
  catch (e) { return { errors: ['PROMOTE_EXPECTED_BYTES_UNPARSEABLE'], promoted: false }; }
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture))
    return { errors: ['PROMOTE_EXPECTED_BYTES_SHAPE'], promoted: false };
  if (typeof postflight !== 'function') return { errors: ['PROMOTE_POSTFLIGHT_REQUIRED'], promoted: false };
  const cErr = containedDirs(fixturesDir, [BUNDLE_ROOT, join(BUNDLE_ROOT, VERSIONS_DIR), 's4-shots',
    ...CAPTURE_PHASES.map((p) => join('s4-shots', CANDIDATE_BUNDLE_DIR(p)))]);
  if (cErr.length) return { errors: cErr, promoted: false };

  // CLI가 읽어 고정한 snapshot만 쓴다. 여기서 다시 읽지 않는다.
  if (!candidates || typeof candidates !== 'object') return { errors: ['PROMOTE_CANDIDATES_REQUIRED'], promoted: false };
  const cands = {};
  for (const phase of CAPTURE_PHASES) {
    const c = candidates[phase];
    if (!c || typeof c.contextRaw !== 'string' || !c.pngByName || typeof c.bundleName !== 'string')
      return { errors: [`PROMOTE_CANDIDATE_SNAPSHOT_INVALID ${phase}`], promoted: false };
    cands[phase] = c;
  }
  const errors = [];
  // 0) dataset 계약 — bundle 검증에도 들어 있지만 **여기서도 명시적으로** 본다.
  // 승격은 정본을 만드는 유일한 지점이다. 계약 검사가 다른 함수 안에만 있으면 그 함수의
  // 호출 순서를 바꾸는 것만으로 계약이 승격 경로에서 조용히 빠질 수 있다.
  // 두 phase의 context를 각각 쓴다 — 한쪽만 계약을 만족하는 쌍을 통과시키지 않는다.
  for (const phase of CAPTURE_PHASES) {
    let c = null;
    try { c = JSON.parse(cands[phase].contextRaw); }
    catch (e) { return { errors: [`[${phase}] PROMOTE_CONTEXT_UNPARSEABLE`], promoted: false }; }
    const flat = buildActionContext(c);
    errors.push(...validateDatasetContract(spec, flat).map((e) => `[${phase}] ${e}`));
    errors.push(...validateScenarioCanon(spec, flat).map((e) => `[${phase}] ${e}`));
    errors.push(...validateScenarioIdentity(flat, c.datasetResponses).map((e) => `[${phase}] ${e}`));
  }
  if (errors.length) return { errors: errors.slice(0, 40), promoted: false };

  // 1) 두 bundle 각각 전체 검증(privacy audit 포함)
  for (const phase of CAPTURE_PHASES)
    errors.push(...validateCaptureBundle({ spec, phase, contextRaw: cands[phase].contextRaw,
      pngByName: cands[phase].pngByName, provenanceRefs }).map((e) => `[${phase}] ${e}`));
  if (errors.length) return { errors: errors.slice(0, 40), promoted: false };

  // 2) dataset 쌍 — 원본 응답에서 재계산해 비교
  const digests = {};
  for (const phase of CAPTURE_PHASES) {
    const ctx = JSON.parse(cands[phase].contextRaw);
    const d = datasetDigest(ctx.datasetResponses, spec, sha);
    if (d.errors.length) return { errors: d.errors.map((e) => `[${phase}] ${e}`), promoted: false };
    digests[phase] = d.digest;
  }
  if (digests.light !== digests.dark)
    return { errors: [`PROMOTE_DATASET_MISMATCH ${digests.light} != ${digests.dark}`], promoted: false };

  // 3) **full mask geometry** — 실제 fixture로 판정한다. 이게 통과하기 전에는 committed가 아니다.
  const lightCtx = JSON.parse(cands.light.contextRaw);
  errors.push(...validateMaskContract(fixture, spec, lightCtx).map((e) => `[geometry] ${e}`));
  if (errors.length) return { errors: errors.slice(0, 40), promoted: false };

  const next = { expectedSha: sha(expectedBytes) };
  for (const phase of CAPTURE_PHASES) next[phase] = bundleDigest(cands[phase].contextRaw, cands[phase].pngByName);

  // ── write 직전 authority postflight ──────────────────────────────────────
  // 긴 projection·검증이 끝난 뒤다. 그 사이에 워킹트리가 더러워졌거나 HEAD가 움직였으면
  // 이 산출물의 출처가 흔들린다. 여기서 실패하면 expected·release 둘 다 write 0이다.
  {
    let pf = null;
    try { pf = postflight(); } catch (e) { return { errors: [`PROMOTE_POSTFLIGHT_THREW ${(e && e.message) || e}`], promoted: false }; }
    if (!pf || pf.ok !== true)
      return { errors: [`PROMOTE_POSTFLIGHT_FAILED ${(pf && pf.errors ? pf.errors.join(' | ') : 'unknown')}`], promoted: false };
  }

  return withLock(fixturesDir, () => {
    // candidate CAS — CLI가 읽은 뒤 누가 candidate를 교체했으면 우리가 검증한 것이 아니다.
    for (const phase of CAPTURE_PHASES) {
      const now = readCandidate(fixturesDir, phase);
      if (now.errors.length) return { errors: now.errors, promoted: false };
      if (now.bundleName !== cands[phase].bundleName)
        return { errors: [`PROMOTE_CANDIDATE_CAS ${phase} ${cands[phase].bundleName} -> ${now.bundleName}`], promoted: false };
      if (bundleDigest(now.contextRaw, now.pngByName) !== next[phase])
        return { errors: [`PROMOTE_CANDIDATE_DIGEST_CAS ${phase}`], promoted: false };
    }
    const cur = readRelease(fixturesDir);
    if (JSON.stringify(cur) !== JSON.stringify(fromRelease ?? null))
      return { errors: [`PROMOTE_CAS ${JSON.stringify(cur)} != ${JSON.stringify(fromRelease ?? null)}`], promoted: false };
    if (cur && cur.light === next.light && cur.dark === next.dark && cur.expectedSha === next.expectedSha)
      return { errors: ['PROMOTE_NOOP'], promoted: false };

    try {
      mkdirSync(join(fixturesDir, BUNDLE_ROOT, VERSIONS_DIR), { recursive: true });
      for (const phase of CAPTURE_PHASES) {
        const dest = versionDir(fixturesDir, next[phase]);
        if (!existsSync(dest)) {
          const tmp = mkdtempSync(join(fixturesDir, BUNDLE_ROOT, VERSIONS_DIR, `.staging-${phase}-`));
          try {
            mkdirSync(join(tmp, 'shots'));
            writeFileSync(join(tmp, 'context.json'), cands[phase].contextRaw);
            for (const [n, b] of Object.entries(cands[phase].pngByName)) writeFileSync(join(tmp, 'shots', n), b);
            renameSync(tmp, dest);
          } catch (e) { try { rmSync(tmp, { recursive: true, force: true }); } catch (e2) { /* noop */ } throw e; }
        }
        // **이름을 믿지 않는다.** 기존 디렉터리든 방금 만든 것이든 다시 읽어 재해시한다 —
        // 정확한 digest 이름으로 변조된 디렉터리를 미리 심어두면 승격이 성공해 버린다(실증).
        const back = readVersion(fixturesDir, next[phase]);
        if (back.errors.length) return { errors: back.errors, promoted: false };
        if (back.digest !== next[phase])
          return { errors: [`PROMOTE_VERSION_TAMPERED ${phase} ${back.digest} != ${next[phase]}`], promoted: false };
      }
      // expected를 **content-addressed 불변 파일로 먼저** 만들고 읽어 확인한다.
      // 여기서 실패하면 release pointer는 손대지 않았으므로 이전 정본이 그대로 유효하다.
      mkdirSync(join(fixturesDir, BUNDLE_ROOT, EXPECTED_DIR), { recursive: true });
      const expPath = expectedPath(fixturesDir, next.expectedSha);
      if (!existsSync(expPath)) {
        const eErr = atomicWrite(expPath, expectedBytes);
        if (eErr) return { errors: [eErr], promoted: false };
      }
      const backExp = readFileSync(expPath, 'utf8');
      if (sha(backExp) !== next.expectedSha)
        return { errors: [`PROMOTE_EXPECTED_TAMPERED ${sha(backExp)} != ${next.expectedSha}`], promoted: false };

      // **마지막에 pointer 하나만** 원자적으로 교체한다. 실패하면 이전 release가 이전
      // expected를 계속 읽는다 — 새 expected는 orphan으로 남을 뿐 활성 정본이 아니다.
      const err = atomicWrite(releasePath(fixturesDir), JSON.stringify(next, null, 1));
      if (err) return { errors: [err], promoted: false };
    } catch (e) {
      return { errors: [`PROMOTE_FAILED ${e && e.message}`], promoted: false };
    }
    return { errors: [], promoted: true, release: next, from: cur, datasetDigest: digests.light };
  });
}

// 버전 디렉터리를 읽어 내용에서 digest를 재계산한다(이름을 믿지 않는다).
function readVersion(fixturesDir, digest) {
  const dir = versionDir(fixturesDir, digest);
  const ctxPath = join(dir, 'context.json'), shots = join(dir, 'shots');
  if (!existsSync(ctxPath) || !existsSync(shots)) return { errors: [`VERSION_INCOMPLETE ${digest}`] };
  const pngByName = {};
  for (const n of readdirSync(shots).filter((x) => !x.startsWith('.'))) pngByName[n] = readFileSync(join(shots, n));
  const contextRaw = readFileSync(ctxPath, 'utf8');
  return { errors: [], contextRaw, pngByName, digest: bundleDigest(contextRaw, pngByName) };
}


// ── 해시 입력 모듈의 HEAD 결속 ────────────────────────────────────────────────
// fingerprint는 "로컬 디스크 상태"만 증명한다. tracked 여부만 보면 워킹카피가 HEAD와 달라도
// 통과한다. **캡처 시작 시점에** 강제해야 한다 — CI에서만 보면 이미 만들어진 산출물의
// 출처를 되돌릴 수 없다.
export function headBlobBinding(repoDir, relPaths, exec, pinnedCommit) {
  const errors = [], blobs = {};
  // 고정 commit을 받으면 그것을 쓴다. `HEAD:path`는 캡처 도중 HEAD가 움직이면 다른 대상을
  // 가리킨다 — 시작 시점에 해석한 commit으로 못박아야 같은 것을 두 번 본다.
  let headCommit = pinnedCommit || null;
  if (!headCommit) {
    try { headCommit = exec(`git -C ${repoDir} rev-parse HEAD`).trim(); }
    catch (e) { return { errors: [`HEAD_UNRESOLVED ${e && e.message}`], blobs: null, headCommit: null }; }
  }
  for (const rel of relPaths) {
    let working = null, head = null;
    try { working = exec(`git -C ${repoDir} hash-object ${rel}`).trim(); }
    catch (e) { errors.push(`HASH_OBJECT_FAILED ${rel}`); continue; }
    try { head = exec(`git -C ${repoDir} rev-parse ${headCommit}:${rel}`).trim(); }
    catch (e) { errors.push(`NOT_TRACKED_AT_HEAD ${rel}`); continue; }
    if (working !== head) errors.push(`WORKING_DIFFERS_FROM_HEAD ${rel} ${working} != ${head}`);
    blobs[rel] = head;
  }
  return { errors, blobs: errors.length ? null : blobs, headCommit };
}


// ── 정적 import closure ───────────────────────────────────────────────────────
// HEAD 결속 목록을 손으로 열거하면 빠진다 — 실증: s4Evaluator가 import하는
// cssColorLiterals.mjs가 목록에 없었다. 진입점에서 로컬 import를 기계적으로 따라가
// 목록을 산출하고, 선언된 목록과 exact 대조한다.
export function staticImportClosure(entryRelPaths, readFile, repoRelBase) {
  const seen = new Set(), out = [];
  const norm = (p) => p.split(sep).join('/');
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel); out.push(rel);
    let src = null;
    try { src = readFile(rel); } catch (e) { return; }
    // 로컬 상대 import만 따라간다(패키지 의존성은 대상이 아니다).
    for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
      const child = norm(join(dirname(rel), m[1]));
      if (child.endsWith('.mjs') || child.endsWith('.js')) visit(child);
    }
    for (const m of src.matchAll(/^\s*import\s+['"](\.[^'"]+)['"]/gm)) {
      const child = norm(join(dirname(rel), m[1]));
      if (child.endsWith('.mjs') || child.endsWith('.js')) visit(child);
    }
  };
  for (const e of entryRelPaths) visit(norm(e));
  void repoRelBase;
  return out.sort();
}
