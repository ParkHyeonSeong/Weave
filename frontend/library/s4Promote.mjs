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
// 구체 검증기를 정적으로 결속한다(주입 금지).
import { validateCaptureBundle, datasetDigest, validateMaskContract } from './s4Evaluator.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

// CLI 문법 정본 — 정확히 두 형태만 허용한다. includes/indexOf 방식은 unknown·중복·여분
// 인자를 통과시키고, `--promote` 오타를 기본 staging 실행으로 떨어뜨려 검토된 candidate를
// 새 candidate로 덮어쓴다(리뷰 실증). 순수 함수로 두고 CLI는 가장 먼저 이걸 부른다.
export const CLI_USAGE = 'usage: node scripts/s4-gen.mjs | node scripts/s4-gen.mjs --promote <sha256> --from <sha256|none>';
const HEX64 = /^[0-9a-f]{64}$/;
export function parseCliArgs(argv) {
  if (!Array.isArray(argv)) return { error: 'ARGV_REQUIRED' };
  if (argv.length === 0) return { mode: 'stage' };
  if (argv.length !== 4) return { error: `BAD_ARITY ${argv.length}` };
  if (argv[0] !== '--promote') return { error: `EXPECTED_PROMOTE_FLAG ${argv[0]}` };
  if (argv[2] !== '--from') return { error: `EXPECTED_FROM_FLAG ${argv[2]}` };
  if (!HEX64.test(argv[1])) return { error: `BAD_CANDIDATE_SHA ${argv[1]}` };
  if (!(argv[3] === 'none' || HEX64.test(argv[3]))) return { error: `BAD_FROM_SHA ${argv[3]}` };
  return { mode: 'promote', candidateSha: argv[1], fromSha: argv[3] === 'none' ? null : argv[3] };
}

export const STAGING_NAME = 's4-expected.candidate.json';
export const COMMITTED_NAME = 's4-expected.json';
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

export function stageBytes({ fixturesDir, bytes }) {
  if (typeof bytes !== 'string') return { errors: ['STAGE_BYTES_MUST_BE_STRING'], candidateSha: null, baseCommittedSha: null, path: null };
  const sErr = symlinkCheck(fixturesDir, STAGING_NAME);
  if (sErr) return { errors: [sErr], candidateSha: null, baseCommittedSha: null, path: null };
  const dest = join(fixturesDir, STAGING_NAME);
  const committed = readIfExists(join(fixturesDir, COMMITTED_NAME));
  const err = atomicWrite(dest, bytes);
  if (err) return { errors: [err], candidateSha: null, baseCommittedSha: null, path: dest };
  return { errors: [], candidateSha: sha(bytes), baseCommittedSha: committed === null ? null : sha(committed), path: dest };
}

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

export function promoteStaged({ fixturesDir, expectedSha, fromSha, canonicalBytes }) {
  // 하드 비활성 — promoteRelease만 막고 이건 열어 두면 "비활성"이 사실이 아니다.
  // 실증: PROMOTION_ENABLED=false인데 stageBytes → promoteStaged로 s4-expected.json이 기록됐다.
  if (!PROMOTION_ENABLED) return { errors: ['PROMOTION_DISABLED'], promoted: false };
  const HEX = /^[0-9a-f]{64}$/;
  if (typeof expectedSha !== 'string' || !HEX.test(expectedSha))
    return { errors: ['PROMOTE_EXPECTED_SHA_REQUIRED'], promoted: false };
  // fromSha 필수 — 생성 시점의 committed SHA. null이면 "그때 committed가 없었음"을 뜻한다.
  if (!(fromSha === null || (typeof fromSha === 'string' && HEX.test(fromSha))))
    return { errors: ['PROMOTE_FROM_SHA_REQUIRED'], promoted: false };
  if (typeof canonicalBytes !== 'string')
    return { errors: ['PROMOTE_CANONICAL_BYTES_REQUIRED'], promoted: false };
  for (const leaf of [STAGING_NAME, COMMITTED_NAME]) {
    const e = symlinkCheck(fixturesDir, leaf);
    if (e) return { errors: [e], promoted: false };
  }
  const stagingPath = join(fixturesDir, STAGING_NAME);
  const committedPath = join(fixturesDir, COMMITTED_NAME);
  if (!existsSync(stagingPath)) return { errors: ['PROMOTE_NO_STAGING'], promoted: false };

  return withLock(fixturesDir, () => {
    const staged = readFileSync(stagingPath, 'utf8');
    const stagedSha = sha(staged);
    if (stagedSha !== expectedSha)
      return { errors: [`PROMOTE_STAGING_SHA_MISMATCH ${stagedSha} != ${expectedSha}`], promoted: false, stagedSha };
    // 전체 승인 경로가 방금 만들어낸 bytes와 exact 일치해야 한다.
    // (validator를 주입받지 않으므로 "무엇이든 통과시키는 검사기"를 넘길 방법이 없다.)
    if (staged !== canonicalBytes)
      return { errors: ['PROMOTE_CANONICAL_MISMATCH'], promoted: false, stagedSha };
    // CAS — lock 안에서 committed를 읽는다. staging 시점 SHA와 다르면 그 사이 누가 바꾼 것.
    const cur = readIfExists(committedPath);
    const curSha = cur === null ? null : sha(cur);
    if (curSha !== fromSha)
      return { errors: [`PROMOTE_CAS_CONFLICT ${curSha} != ${fromSha}`], promoted: false, stagedSha };
    const err = atomicWrite(committedPath, staged);
    if (err) return { errors: [err], promoted: false, stagedSha };
    return { errors: [], promoted: true, stagedSha };
  });
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
export const PROMOTION_ENABLED = false;
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

function readCandidate(fixturesDir, phase) {
  const ctxPath = join(fixturesDir, candidateContextName(phase));
  const shots = candidateShotsDir(fixturesDir, phase);
  if (!existsSync(ctxPath)) return { errors: [`PROMOTE_NO_CANDIDATE_CONTEXT ${phase}`] };
  if (!existsSync(shots)) return { errors: [`PROMOTE_NO_CANDIDATE_SHOTS ${phase}`] };
  const pngByName = {};
  for (const n of readdirSync(shots).filter((x) => !x.startsWith('.'))) {
    if (n.includes('/') || n.includes('..')) return { errors: [`PROMOTE_BAD_NAME ${n}`] };
    pngByName[n] = readFileSync(join(shots, n));
  }
  return { errors: [], contextRaw: readFileSync(ctxPath, 'utf8'), pngByName };
}

// **캡처 쌍 + expected fixture를 한 트랜잭션으로** 승격한다.
//
// 왜 함께인가: 이전 판은 캡처 쌍만 전환했고 fixture는 별도 경로였다. 그래서
// (1) geometry 승인 전에 committed가 됐고 (2) capture=B / expected=A 조합이 가능했다.
// release manifest 하나를 rename하면 둘 다 원자적으로 바뀐다.
//
// geometry는 **실제 fixture의 allowIdToKey/changed**가 있어야 판정되므로 여기서 본다 —
// bundle 검증(validateCaptureBundle)은 일부러 생략하고, 그 전까지는 candidate로만 존재한다.
export function promoteRelease({ fixturesDir, spec, provenanceRefs, fromRelease, fixture, expectedBytes }) {
  // 하드 비활성 — 인자가 무엇이든 아무것도 쓰지 않는다.
  if (!PROMOTION_ENABLED) return { errors: ['PROMOTION_DISABLED'], promoted: false };
  if (!spec || typeof spec !== 'object') return { errors: ['PROMOTE_SPEC_REQUIRED'], promoted: false };
  if (!provenanceRefs || typeof provenanceRefs !== 'object') return { errors: ['PROMOTE_PROVENANCE_REFS_REQUIRED'], promoted: false };
  if (!fixture || typeof fixture !== 'object') return { errors: ['PROMOTE_FIXTURE_REQUIRED'], promoted: false };
  if (typeof expectedBytes !== 'string') return { errors: ['PROMOTE_EXPECTED_BYTES_REQUIRED'], promoted: false };
  const cErr = containedDirs(fixturesDir, [BUNDLE_ROOT, join(BUNDLE_ROOT, VERSIONS_DIR), 's4-shots',
    ...CAPTURE_PHASES.map((p) => join('s4-shots', `candidate-${p}`))]);
  if (cErr.length) return { errors: cErr, promoted: false };

  const cands = {};
  for (const phase of CAPTURE_PHASES) {
    const c = readCandidate(fixturesDir, phase);
    if (c.errors.length) return { errors: c.errors, promoted: false };
    cands[phase] = c;
  }
  const errors = [];
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

  return withLock(fixturesDir, () => {
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
      // expected fixture도 같은 트랜잭션 안에서 쓴다.
      const eErr = atomicWrite(join(fixturesDir, COMMITTED_NAME), expectedBytes);
      if (eErr) return { errors: [eErr], promoted: false };
      // 마지막으로 release manifest 하나를 원자적으로 교체 — capture 쌍과 expected가 함께 바뀐다.
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
