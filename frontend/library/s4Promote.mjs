// frontend/library/s4Promote.mjs
// **승격 정본 모듈.** candidate → committed release 로 가는 유일한 경로이고,
// git/worktree authority도 여기가 소유한다.
//
// 이 모듈이 막는 것(전부 리뷰에서 실증된 경로):
//  - validator를 주입할 수 있어 `validate: () => []`로 `NOT JSON`도 승격됨
//  - 승인 함수·모듈 목록·startHead를 caller가 넘겨, 승격이 자기 검사 범위를 밖에 위임함
//  - CAS 확인과 rename 사이에 lock이 없어, 검증 도중 committed가 바뀌어도 그대로 덮어씀
//  - 고정 temp 경로 → 동시 실행 충돌 / 심볼릭 링크 추적
//  - **자기 산출물로 스스로 dirty가 되어 첫 승격이 late authority에서 죽음**
//    (production topology 실증: LATE WORKTREE_DIRTY 5건, 재시도는 START에서 같은 5건)
//
// 계약
//  - 경로·해시·검증기·승인 구현·authority 입력은 전부 **내부에서 정한다.**
//  - 버전 디렉터리와 expected는 content-addressed 불변이고, commit point는
//    release pointer rename 한 번이다.
//  - late authority는 **이번 트랜잭션이 만들기로 한 파일만** 허용하고 내용 해시까지 본다.
import { mkdtempSync, writeFileSync, readFileSync, renameSync, rmSync, openSync, fsyncSync, closeSync,
  lstatSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { join, dirname, basename, sep, relative } from 'node:path';
import { readdirSync, mkdirSync, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
// 구체 검증기를 정적으로 결속한다(주입 금지).
import { readCandidateBundle, CANDIDATE_BUNDLE_DIR, acquireCandidateLock } from './s4CaptureRunner.mjs';
import { verifyDiscoveryEvidence } from './s4Evaluator.mjs';
import { snapshotSpec, approveAndWrite as EVALUATOR_APPROVE } from './s4Evaluator.mjs';
import { validateCaptureBundle, datasetDigest, validateMaskContract,
  validateDatasetContract, validateScenarioIdentity, validateScenarioCanon,
  buildActionContext } from './s4Evaluator.mjs';
// 정본 spec을 **정적으로** 잡는다. caller가 넘긴 spec에서 authority 목록을 읽으면
// 축소한 목록으로 HEAD 결속을 우회할 수 있다.
import * as CANON_SPEC from './s4Spec.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

// ── authority 모듈 목록의 정본 ───────────────────────────────────────────────
// 이전 판은 caller(`scripts/s4-capture.mjs`)가 목록을 넘겼다. 축소한 배열을 주면
// 그만큼 HEAD 결속이 좁아지므로 승격·audit이 caller에게 자기 검사 범위를 위임한 셈이었다.
// 여기 한 곳에 두고 capture/audit/promotion이 같은 값을 쓴다.
export const DISCOVERY_ENTRY = 'frontend/scripts/s4-capture.mjs';
export const DISCOVERY_HASHED_MODULES = Object.freeze([...CANON_SPEC.PROVENANCE_BLOB_PATHS]);
// 캡처·승격은 산출물을 만든다 — 승격까지의 전 경로가 clean이어야 한다.
export const HASHED_MODULES = Object.freeze([
  ...DISCOVERY_HASHED_MODULES,
  'frontend/library/s4Projection.mjs',
  // privacy audit 부착 도구도 authority에 든다 — 캡처는 이 도구가 커밋된
  // 이후의 clean HEAD에서만 돈다.
  'frontend/scripts/s4-audit-candidate.mjs',
  'frontend/scripts/s4-promote-capture.mjs',
]);
// **generator authority는 discovery provenance와 다른 것이다.**
// discovery 9파일은 "그때 관찰한 코드"이고, 이 목록은 "지금 fixture를 만드는 코드"다.
export const GENERATOR_ENTRY = 'frontend/scripts/s4-gen.mjs';
export const GENERATOR_HASHED_MODULES = Object.freeze([
  GENERATOR_ENTRY,
  'frontend/library/cssColorLiterals.mjs',
  'frontend/library/s4Projection.mjs',
  'frontend/library/s4Canonicalize.mjs',
  'frontend/library/s4CaptureRunner.mjs',
  'frontend/library/s4DomProbe.mjs',
  'frontend/library/s4Evaluator.mjs',
  'frontend/library/s4Promote.mjs',
  'frontend/library/s4Spec.mjs',
  'frontend/scripts/s4-capture.mjs',
]);

// git status 원문을 **구조화해서** 돌려준다. 문자열 한 줄로 뭉치면 "이 항목이 untracked인가"를
// 뒤에서 정규식으로 되풀이해야 하고, 그 파싱이 authority 판정의 약한 고리가 된다.
// porcelain -z 원문 → 구조화 entry. **순수 함수다** — 파싱 계약은 여기서 검증한다.
export function parsePorcelainZ(out) {
  const parts = String(out).split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    if (!p) continue;
    const xy = p.slice(0, 2);
    const path = p.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') { const from = parts[i + 1]; i += 1; entries.push({ xy, path, from }); }
    else entries.push({ xy, path });
  }
  return entries;
}

// **exec를 받지 않는다.** 콜백을 받으면 그 콜백이 상속한 GIT_* 환경으로 index·repo가
// 통째로 바뀌치기된다(실증: production이 넘기던 execSync 콜백에 `GIT_INDEX_FILE=<clean 사본>`을
// 걸자 staged EVIL이 dirty=0으로 보였고 capture start gate가 ok=true였다).
export function worktreeStatusEntries(repoDir) {
  let out = '';
  try { out = gitAuthority(repoDir, 'status', '--porcelain', '-z', '--untracked-files=all'); }
  catch (e) { return { errors: [`WORKTREE_STATUS_FAILED ${(e && e.message) || e}`], entries: [] }; }
  return { errors: [], entries: parsePorcelainZ(out) };
}

const entryText = (e) => (e.from ? `${e.xy} ${e.from} -> ${e.path}` : `${e.xy} ${e.path}`);

// 워킹트리 전체가 clean한지. **git/worktree authority는 이 모듈이 소유한다** —
// 승격이 자기 검사를 caller에게 맡기면 그 검사를 갈아끼울 수 있다.
export function worktreeDirtyEntries(repoDir) {
  const r = worktreeStatusEntries(repoDir);
  if (r.errors.length) return r.errors;
  return r.entries.map(entryText);
}

// ── authority Git 실행기(단일) ───────────────────────────────────────────────
// **argv 배열 하나로 통일한다.** 문자열 명령은 셸을 타고, 환경은 repo·index를 통째로
// 바꿔치기할 수 있다(실증: default index에 EVIL을 stage해 둔 채 `GIT_INDEX_FILE`로 깨끗한
// index 사본을 가리키자 provenanceLineage가 ok:true가 됐다).
// 그래서 authority 호출은 **GIT_* 환경을 전부 제거한 환경**에서만 돈다. GIT_DIR·GIT_WORK_TREE·
// GIT_COMMON_DIR·GIT_OBJECT_DIRECTORY 같은 나머지 선택자도 같은 규칙 하나로 덮인다.
// caller가 러너를 주입할 파라미터는 없다.
function authorityEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return env;
}
function gitArgv(argv, encoding = 'utf8') {
  return execFileSync('git', argv, { encoding, stdio: ['ignore', 'pipe', 'ignore'], env: authorityEnv() });
}
const gitAuthority = (repoDir, ...args) => gitArgv(['-C', repoDir, ...args]);

// 현재 HEAD가 필요한 곳을 위한 **비주입 operation helper**. 러너 자체는 export하지 않는다 —
// 내보내면 호출부가 임의 argv를 그대로 실행할 수 있고, 그게 다시 주입 지점이 된다.
export function currentHeadCommit(repoDir) {
  try { return gitAuthority(repoDir, 'rev-parse', 'HEAD').trim(); } catch (e) { return null; }
}

// projector가 BASE 소스를 읽는 **유일한 경로**. s4-gen과 s4-promote-capture가 같이 쓴다.
// 이전 판은 각자 셸 `git -C <repo> show <ref>:frontend/<rel>`을 돌렸고 환경을 그대로 상속했다
// (실증: `GIT_DIR`/`GIT_WORK_TREE`를 alt repo로 걸자 `81ad606` 브랜치의 변조본을 읽어
//  track.scss가 0.04 → 0.041이 되고 소스 SHA가 달라졌다).
//
// 계약: 환경이 제거된 내부 argv 러너로만 읽고, `rev-parse ref:frontend/rel`의 OID가
// **SPEC.FILES의 blob과 exact**일 때만 bytes를 돌려준다. 아니면 fail-closed.
export function readPinnedGitFile(repoDir, ref, rel, expectedBlob) {
  const fail = (e) => ({ errors: [e], bytes: null, oid: null });
  // BASE는 축약 ref일 수 있다(정본 SPEC.BASE가 7자리다). 그래도 hex 형태는 강제한다.
  if (!/^[0-9a-f]{7,40}$/.test(String(ref))) return fail(`PINNED_REF_FORMAT ${String(ref)}`);
  if (!/^[0-9a-f]{40}$/.test(String(expectedBlob))) return fail(`PINNED_BLOB_FORMAT ${String(expectedBlob)}`);
  const r = String(rel);
  if (!r || r.startsWith('/') || r.includes('\\')
    || r.split('/').some((seg) => !seg || seg === '.' || seg === '..'))
    return fail(`PINNED_REL_NONCANONICAL ${r}`);
  // 기대 blob도 **정본 spec에서 다시 확인한다** — caller가 기대값을 낮춰 잡을 수 없다.
  const canon = Object.values(CANON_SPEC.FILES || {}).find((f) => f && f.rel === r);
  if (!canon) return fail(`PINNED_REL_NOT_IN_SPEC ${r}`);
  if (canon.blob !== expectedBlob) return fail(`PINNED_BLOB_NOT_CANON ${r} ${expectedBlob} != ${canon.blob}`);
  const path = `frontend/${r}`;
  let oid = null;
  try { oid = gitAuthority(repoDir, 'rev-parse', `${ref}:${path}`).trim(); }
  catch (e) { return fail(`PINNED_UNRESOLVED ${ref}:${path}`); }
  if (oid !== expectedBlob) return fail(`PINNED_BLOB_MISMATCH ${path} ${oid} != ${expectedBlob}`);
  // ⚠️ **검증한 oid로 읽는다 — ref로 다시 읽지 않는다.**
  // 이전 판은 `rev-parse <ref>:<path>`로 OID를 확인한 뒤 별도 프로세스에서 `show <ref>:<path>`를
  // 돌렸다. 두 호출 사이에 가변 ref가 움직이면 검증한 것과 다른 내용을 돌려준다
  // (실증: refs/heads/81ad606을 canonical→bad로 옮기자 errors=[]·oid=dd2b8810…인데
  //  실제 bytes의 blob은 6b77cd69…이고 내용은 "/* BAD */"로 시작했다).
  // OID는 불변이므로 object를 직접 읽으면 그 창이 없다.
  let raw = null;
  try { raw = gitArgv(['-C', repoDir, 'cat-file', 'blob', oid], 'buffer'); }
  catch (e) { return fail(`PINNED_CATFILE_FAILED ${oid}`); }
  if (!Buffer.isBuffer(raw)) return fail(`PINNED_BYTES_NOT_BUFFER ${oid}`);
  // 돌려받은 바이트의 Git blob 해시를 **다시 계산해** oid·expectedBlob과 대조한다.
  const got = createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${raw.length}\0`, 'utf8'), raw])).digest('hex');
  if (got !== oid) return fail(`PINNED_BYTES_HASH ${got} != ${oid}`);
  if (got !== expectedBlob) return fail(`PINNED_BYTES_BLOB ${got} != ${expectedBlob}`);
  return { errors: [], bytes: raw.toString('utf8'), oid };
}

// ── 트랜잭션 허용 집합 ───────────────────────────────────────────────────────
// production topology에서는 fixturesDir가 repoDir **안**에 있고, 승격 산출물(version
// 디렉터리·expected 파일)은 커밋 대상이라 gitignore되지 않는다. 그래서 승격이 자기가 만든
// 파일 때문에 스스로 dirty가 되어 late authority에서 죽었다(실증: 첫 승격이
// `PROMOTE_AUTHORITY_FAILED_LATE WORKTREE_DIRTY 5`, 재시도는 START에서 같은 5건).
//
// 고치는 방향은 "dirty를 봐준다"가 아니라 **"이번 트랜잭션이 만들기로 한 그 파일들만"**
// 허용하는 것이다. 허용 목록은 caller 입력이 아니라 next(light/dark/expectedSha)와
// candidate 바이트에서 **내부 파생**하고, 허용된 경로도 일반 파일·정확한 내용 해시를 확인한다.
function transactionAllowance({ fixturesDir, repoDir, next, cands, requirePresent = false }) {
  // entries는 **절대 경로 + 기대 내용 해시**다. topology와 무관하게 언제나 만들어진다 —
  // gitPaths(=git status 대조용 repo 상대 경로)만 fixturesDir ⊂ repoDir일 때 채워진다.
  // 이전 판은 repo 밖 topology에서 allowed가 비어, 산출물 존재·내용 검증 자체가 사라졌다.
  const entries = [];
  const gitPaths = new Map();
  const add = (segs, want) => entries.push({ segs, abs: join(fixturesDir, ...segs), want });
  for (const phase of CAPTURE_PHASES) {
    const d = next[phase];
    add([BUNDLE_ROOT, VERSIONS_DIR, d, 'context.json'], sha(cands[phase].contextRaw));
    for (const [n, b] of Object.entries(cands[phase].pngByName))
      add([BUNDLE_ROOT, VERSIONS_DIR, d, 'shots', n], sha(b));
  }
  add([BUNDLE_ROOT, EXPECTED_DIR, `${next.expectedSha}.json`], next.expectedSha);

  let rootReal = null, fxReal = null;
  try { rootReal = realpathSync(repoDir); } catch (e) { return { errors: [`ALLOWANCE_REPO_UNREADABLE ${repoDir}`], entries, gitPaths }; }
  try { fxReal = realpathSync(fixturesDir); } catch (e) { return { errors: [`ALLOWANCE_FIXTURES_UNREADABLE ${fixturesDir}`], entries, gitPaths }; }
  const inside = fxReal === rootReal || fxReal.startsWith(rootReal + sep);
  if (inside) {
    const base = relative(rootReal, fxReal).split(sep).join('/');
    for (const e of entries) gitPaths.set([base, ...e.segs].filter(Boolean).join('/'), e.want);
  }
  return { errors: [], entries, gitPaths, inside, requirePresent };
}

const lateAllowance = (a) => ({ ...a, requirePresent: true });

// 허용된 경로가 **실제로도** 우리가 쓰기로 한 그것인지. 이름만 맞고 내용이 다른 파일을
// 미리 심어두면 authority가 그것을 "우리 산출물"로 봐주게 된다.
// requirePresent(=release pointer 직전)에서는 **부재 자체가 결함**이다 — readback 뒤에
// 누가 지우면 이전 판은 그대로 통과했고, 깨진 release가 committed로 남았다(실증:
// promoted=true인데 readCaptureBundle이 CAPTURE_VERSION_FILE_SET로 실패).
function verifyAllowedNodes(allowance) {
  const errors = [];
  for (const { abs, segs, want } of allowance.entries) {
    const label = segs.join('/');
    let st = null;
    try { st = lstatSync(abs); }
    catch (e) { if (allowance.requirePresent) errors.push(`ALLOWED_MISSING ${label}`); continue; }
    if (st.isSymbolicLink()) { errors.push(`ALLOWED_SYMLINK ${label}`); continue; }
    if (!st.isFile()) { errors.push(`ALLOWED_NOT_FILE ${label}`); continue; }
    let got = null;
    try { got = sha(readFileSync(abs)); } catch (e) { errors.push(`ALLOWED_UNREADABLE ${label}`); continue; }
    if (got !== want) errors.push(`ALLOWED_CONTENT ${label} ${got} != ${want}`);
  }
  return errors;
}

// 승격 authority: **이번 트랜잭션 산출물 외에는 어떤 변화도 없음** + HEAD 동일 + pinned blob exact.
// **내부 검사다** — 콜백으로 받지 않고, 모듈 목록도 caller가 정하지 않는다.
export function promotionAuthority(repoDir, startHead, pinnedBlobs, allowance) {
  const errors = [];
  const st = worktreeStatusEntries(repoDir);
  if (st.errors.length) errors.push(...st.errors);
  else {
    const allowed = (allowance && allowance.gitPaths) || new Map();
    // 허용은 **untracked(`??`) 신규 파일에만** 적용된다. tracked 수정·staged·삭제·rename은
    // 그 경로가 허용 목록에 있더라도 이번 트랜잭션의 출력이 아니다.
    const unexpected = st.entries.filter((e) => !(e.xy === '??' && allowed.has(e.path)));
    if (unexpected.length)
      errors.push(`WORKTREE_DIRTY ${unexpected.length}: ${unexpected.slice(0, 5).map(entryText).join(' | ')}`);
  }
  // 노드 검증은 **topology와 무관하게** 항상 돈다.
  if (allowance && allowance.entries) errors.push(...verifyAllowedNodes(allowance));
  let now = null;
  try { now = gitAuthority(repoDir, 'rev-parse', 'HEAD').trim(); } catch (e) { errors.push('HEAD_UNREADABLE'); }
  if (now && startHead && now !== startHead) errors.push(`HEAD_MOVED ${startHead} -> ${now}`);
  const h = headBlobBinding(repoDir, HASHED_MODULES, startHead || undefined);
  if (h.errors.length) errors.push(...h.errors);
  else if (pinnedBlobs) {
    // **실제 pinned blobs와 대조한다.** 이전 판은 `h.blobs !== (startHead && h.blobs)`라는
    // 자기비교라 어떤 입력에도 참이 될 수 없었다 — 검사처럼 보이는 빈 자리였다.
    for (const rel of HASHED_MODULES)
      if (h.blobs[rel] !== pinnedBlobs[rel]) errors.push(`BLOBS_DIFFER ${rel} ${h.blobs[rel]} != ${pinnedBlobs[rel]}`);
    for (const rel of Object.keys(pinnedBlobs))
      if (!(rel in h.blobs)) errors.push(`BLOBS_EXTRA_PINNED ${rel}`);
  }
  return { ok: errors.length === 0, errors };
}

// **비주입 승인 entrypoint.** 승인 구현도 discovery evidence의 Git resolver도 모듈이 정한다.
// caller는 bytes와 repoDir만 준다 — 승인 함수를 갈아끼울 파라미터가 없다.
export function approveForPromotion({ spec, repoDir, evidenceFiles, ...rest }) {
  if (typeof repoDir !== 'string' || !repoDir) return { errors: ['APPROVE_REPO_DIR_REQUIRED'], wrote: false, bytes: null };
  if (!evidenceFiles || typeof evidenceFiles !== 'object')
    return { errors: ['APPROVE_EVIDENCE_FILES_REQUIRED'], wrote: false, bytes: null };
  const canonPaths = new Set((spec && spec.PROVENANCE_BLOB_PATHS) || []);
  return EVALUATOR_APPROVE({ ...rest, spec,
    discoveryEvidence: { files: evidenceFiles, gitBlob: (ref, rel) => promoteGitBlob(repoDir, canonPaths, ref, rel) } });
}

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
// ⚠️ 전역 s4-expected.json은 **정본 경로에서 제거됐다.** 상수 자체도 남기지 않는다 —
// 이름이 남아 있으면 나중에 다시 그 경로를 읽는 코드가 생긴다. committed expected는
// release.expectedSha가 가리키는 content-addressed 불변 파일이다(아래 EXPECTED_DIR).
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
// **소유권은 이름이 아니라 dev/ino다.** 이전 판은 finally에서 pathname을 무조건 unlink했다.
// 누가 우리 lock을 지우고 자기 것을 만들어 두면, 우리는 남의 lock을 지우면서 상호배제를
// 두 번 깬다(우리도, 그 뒤 writer도). 열어 둔 fd의 dev/ino를 기억하고
//  (1) pointer commit 직전 (2) finally 해제 직전
// 두 번 pathname을 다시 stat해서 같은 파일인지 본다. 다르면 pointer를 쓰지 않고, 남의 lock도
// 지우지 않는다. **자동 stale 회수는 없다** — 살아 있는 소유자를 탈취하기 때문이다.
function withLock(fixturesDir, fn) {
  const lock = join(fixturesDir, LOCK_NAME);
  let fd = null;
  try { fd = openSync(lock, 'wx'); } catch (e) { return { errors: ['PROMOTE_LOCK_BUSY'], promoted: false }; }
  let lockId = null;
  try { const st = fstatSync(fd); lockId = `${st.dev}:${st.ino}`; }
  catch (e) {
    try { closeSync(fd); } catch (e2) { /* noop */ }
    return { errors: [`PROMOTE_LOCK_STAT_FAILED ${(e && e.message) || e}`], promoted: false };
  }
  const stillOurs = () => {
    try { const st = lstatSync(lock); return `${st.dev}:${st.ino}` === lockId; } catch (e) { return false; }
  };
  try { return fn(stillOurs); }
  finally {
    const ours = stillOurs();
    try { closeSync(fd); } catch (e) { /* noop */ }
    // 우리 것일 때만 반납한다. foreign/replaced lock은 건드리지 않는다.
    if (ours) try { unlinkSync(lock); } catch (e) { /* noop */ }
  }
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
// **checked reader가 정본이다.** release.json 자체가 fixtures 안의 일반 파일인지, 스키마가
// exact인지를 **읽는 모든 경로에서 먼저** 강제한다. 이전 판은 `readRelease`가 JSON 객체이기만
// 하면 통과시켰고, 스키마 검사는 `readCommittedExpected`에만 있었다 — 그래서 capture bundle
// 경로와 CAS는 형태가 깨진 release도 그대로 소비했다.
export function readReleaseChecked(fixturesDir) {
  const p = releasePath(fixturesDir);
  const leafErr = safeLeaf(fixturesDir, p, 'file');
  if (leafErr) return { errors: [`RELEASE_${leafErr}`], release: null, absent: false };
  if (!existsSync(p)) return { errors: [], release: null, absent: true };
  let v = null;
  try { v = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { return { errors: ['RELEASE_UNPARSEABLE'], release: null, absent: false }; }
  const shape = validateReleaseShape(v);
  if (shape.length) return { errors: shape, release: null, absent: false };
  return { errors: [], release: v, absent: false };
}

// 편의 reader. **형태가 깨진 release는 null이 아니라 오류다** — 승격 CAS처럼 "없음"과
// "깨짐"을 구별해야 하는 곳은 반드시 readReleaseChecked를 쓴다.
export function readRelease(fixturesDir) { return readReleaseChecked(fixturesDir).release; }

// **committed gate의 상태 판정 정본.** 이전 판은 게이트가 `!!readRelease(dir)`만 봐서
// "없음"과 "깨짐"이 똑같이 skip이 됐다 — malformed JSON도, schema drift도, symlink도
// 조용히 검사를 건너뛰었다(실증: 두 경우 모두 HAS_RELEASE=false).
//  - absent  → skip  (최초 승격 전. 이때만 건너뛴다)
//  - errors  → fail  (RED. 절대 skip이 아니다)
//  - ok      → run
export function releaseGateState(checked) {
  if (!checked || typeof checked !== 'object') return { mode: 'fail', errors: ['RELEASE_STATE_SHAPE'] };
  if (Array.isArray(checked.errors) && checked.errors.length) return { mode: 'fail', errors: [...checked.errors] };
  if (checked.absent) return { mode: 'skip', errors: [] };
  if (!checked.release) return { mode: 'fail', errors: ['RELEASE_STATE_INCONSISTENT'] };
  return { mode: 'run', errors: [] };
}

// ── 승격 sink의 고정 루트 ────────────────────────────────────────────────────
// **쓰는 곳은 repoDir 안의 정해진 한 경로뿐이다.** 이전 판은 fixturesDir를 caller가 자유롭게
// 줄 수 있어, clean한 clone을 repoDir로 주고 전혀 다른 디렉터리를 fixturesDir로 주면
// version 2개·expected 1개·release 1개가 그대로 그쪽에 만들어졌다(실증: promoted=true).
export const FIXTURES_REL = 'frontend/library/__fixtures__';

// ⚠️ `realpath(canonical) === realpath(fixturesDir)`만 보면 **canonical 경로 자체가
// 밖을 가리키는 symlink일 때 통과한다**(실증: `frontend/library/__fixtures__`를 outside
// 디렉터리 symlink로 커밋하자 fixturesRootError가 null이었다). 그래서 lexical 경로를
// 기준으로 삼고 **구성요소를 하나씩 lstat**해 symlink를 거부한다.
// repoDir 자신의 상위 symlink 해소(예: macOS /var → /private/var)는 정상이므로 먼저 realpath로
// 접고, 그 아래에서 밖으로 나가는 링크만 막는다.
export function fixturesRootError(repoDir, fixturesDir) {
  let repoReal = null, fxReal = null;
  try { repoReal = realpathSync(repoDir); } catch (e) { return `PROMOTE_REPO_UNREADABLE ${repoDir}`; }
  try { fxReal = realpathSync(fixturesDir); } catch (e) { return `PROMOTE_FIXTURES_UNREADABLE ${fixturesDir}`; }
  const segs = FIXTURES_REL.split('/');
  const canonical = join(repoReal, ...segs);
  let cur = repoReal;
  for (const seg of segs) {
    cur = join(cur, seg);
    let st = null;
    try { st = lstatSync(cur); } catch (e) { return `PROMOTE_FIXTURES_ROOT_ABSENT ${cur}`; }
    if (st.isSymbolicLink()) return `PROMOTE_FIXTURES_ROOT_SYMLINK ${cur}`;
    if (!st.isDirectory()) return `PROMOTE_FIXTURES_ROOT_NOT_DIR ${cur}`;
  }
  // 구성요소가 전부 실제 디렉터리이므로 여기서 realpath는 lexical 경로와 같아야 한다.
  let canonReal = null;
  try { canonReal = realpathSync(canonical); } catch (e) { return `PROMOTE_FIXTURES_ROOT_ABSENT ${canonical}`; }
  if (canonReal !== canonical) return `PROMOTE_FIXTURES_ROOT_NOT_CANONICAL ${canonReal} != ${canonical}`;
  if (canonical !== repoReal && !canonical.startsWith(repoReal + sep))
    return `PROMOTE_FIXTURES_ROOT_ESCAPES ${canonical}`;
  if (fxReal !== canonical) return `PROMOTE_FIXTURES_ROOT ${fxReal} != ${canonical}`;
  return null;
}

// ── provenance 계보 ─────────────────────────────────────────────────────────
// 캡처는 HEAD A에서 일어나고, 그 산출물을 커밋하면 HEAD는 B가 된다. 정상 흐름이다.
// 그런데 게이트가 "기록된 headCommit === 지금 HEAD"만 보면 그 정상 흐름 직후부터 영구 RED가
// 된다(실증: artifact-only commit 뒤 `EVIDENCE_PROVENANCE_HEAD A != B`).
//
// exact equality를 지우는 대신 **네 가지를 확인한다**:
//  a) 기록된 capture commit이 실제 Git commit인가
//  b) 그것이 현재 HEAD의 ancestor인가 (앞선 시점이지 다른 갈래가 아니다)
//  c) 기록된 blob이 capture commit에서의 blob과 일치하는가
//  d) **현재** contract module blob도 그와 동일한가 (캡처 이후 계약 코드가 바뀌지 않았다)
// Git index / tree entry 읽기. **모듈 내부 비주입 실행기**이고 argv 배열이라 보간이 없다 —
// 경로는 정본 목록(HASHED_MODULES) 멤버, commit은 40-hex로 이미 검증된 값만 들어온다.
function indexEntries(repoDir, rels) {
  let out = '';
  try {
    out = gitAuthority(repoDir, 'ls-files', '--stage', '-z', '--', ...rels);
  } catch (e) { return { errors: [`UNREADABLE ${(e && e.message) || e}`], byPath: new Map() }; }
  const byPath = new Map(); const errors = [];
  for (const rec of String(out).split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const head = tab < 0 ? [] : rec.slice(0, tab).split(' ');
    if (tab < 0 || head.length < 3) { errors.push(`RECORD_MALFORMED ${rec}`); continue; }
    const path = rec.slice(tab + 1);
    // 같은 경로가 여러 번 나오면 unmerged(conflict) 상태다 — 통과시키지 않는다.
    if (byPath.has(path)) { errors.push(`DUPLICATE ${path}`); continue; }
    byPath.set(path, { mode: head[0], oid: head[1], stage: Number(head[2]) });
  }
  return { errors, byPath };
}

function treeEntries(repoDir, commit, rels) {
  let out = '';
  try {
    out = gitAuthority(repoDir, 'ls-tree', '-z', commit, '--', ...rels);
  } catch (e) { return { errors: [`TREE_UNREADABLE ${commit}`], byPath: new Map() }; }
  const byPath = new Map(); const errors = [];
  for (const rec of String(out).split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const head = tab < 0 ? [] : rec.slice(0, tab).split(' ');
    if (tab < 0 || head.length < 3) { errors.push(`TREE_RECORD_MALFORMED ${rec}`); continue; }
    byPath.set(rec.slice(tab + 1), { mode: head[0], type: head[1], oid: head[2] });
  }
  return { errors, byPath };
}

export function provenanceLineage({ repoDir, captureCommit, recordedBlobs }) {
  const errors = [];
  if (typeof captureCommit !== 'string' || !/^[0-9a-f]{40}$/.test(captureCommit))
    return { ok: false, errors: [`LINEAGE_COMMIT_FORMAT ${String(captureCommit)}`] };
  // a) 실제 commit 객체인가
  let type = null;
  try { type = gitAuthority(repoDir, 'cat-file', '-t', captureCommit).trim(); }
  catch (e) { return { ok: false, errors: [`LINEAGE_COMMIT_UNKNOWN ${captureCommit}`] }; }
  if (type !== 'commit') return { ok: false, errors: [`LINEAGE_NOT_COMMIT ${captureCommit} ${type}`] };
  // b) 현재 HEAD의 ancestor인가
  let head = null;
  try { head = gitAuthority(repoDir, 'rev-parse', 'HEAD').trim(); }
  catch (e) { return { ok: false, errors: ['LINEAGE_HEAD_UNREADABLE'] }; }
  try { gitAuthority(repoDir, 'merge-base', '--is-ancestor', captureCommit, head); }
  catch (e) { errors.push(`LINEAGE_NOT_ANCESTOR ${captureCommit} -> ${head}`); }
  // c)/d) 기록된 blob = capture commit의 blob = 현재 HEAD의 blob
  if (!recordedBlobs || typeof recordedBlobs !== 'object' || Array.isArray(recordedBlobs))
    return { ok: false, errors: [...errors, 'LINEAGE_BLOBS_SHAPE'] };
  const got = Object.keys(recordedBlobs).sort();
  const want = [...HASHED_MODULES].sort();
  if (JSON.stringify(got) !== JSON.stringify(want))
    errors.push(`LINEAGE_BLOB_KEYSET [${got.length}] != [${want.length}]`);
  for (const rel of HASHED_MODULES) {
    const rec = recordedBlobs[rel];
    const at = promoteGitBlob(repoDir, new Set(HASHED_MODULES), captureCommit, rel);
    if (!at) { errors.push(`LINEAGE_BLOB_UNRESOLVED ${rel} @capture`); continue; }
    if (at !== rec) errors.push(`LINEAGE_CAPTURE_BLOB ${rel} ${rec} != ${at}`);
    const now = promoteGitBlob(repoDir, new Set(HASHED_MODULES), head, rel);
    if (!now) { errors.push(`LINEAGE_BLOB_UNRESOLVED ${rel} @HEAD`); continue; }
    if (now !== rec) errors.push(`LINEAGE_CURRENT_BLOB ${rel} ${rec} != ${now}`);
  }
  // e) **워킹 파일도 현재 HEAD blob과 같아야 한다.** tree만 비교하면 hashed module이 dirty여도
  // ok:true였다(실증: unstaged·staged 수정 모두 통과). 전체 worktree clean은 요구하지 않는다 —
  // release artifact 파일이 untracked로 존재할 수 있으므로 HASHED_MODULES만 본다.
  {
    const wb = headBlobBinding(repoDir, HASHED_MODULES, head);
    for (const e of wb.errors) errors.push(`LINEAGE_WORKING_BLOB ${e}`);
  }
  // f) **Git index도 결속한다.** tree와 working만 보면 index에만 남은 변조가 통과한다
  // (실증: EVIL을 add한 뒤 working만 HEAD 바이트로 되돌리면 working===HEAD·index!==HEAD인데
  //  ok:true였다. staged deletion과 mode 변경(100644→100755)도 통과했다).
  // blob OID뿐 아니라 stage=0·mode·경로 존재 여부까지 HEAD·capture 양쪽 entry와 대조한다.
  // 대상은 HASHED_MODULES뿐이므로 그 밖의 artifact/무관 파일 staged 상태는 범위 밖이다.
  {
    const rels = [...HASHED_MODULES];
    const idx = indexEntries(repoDir, rels);
    const headTree = treeEntries(repoDir, head, rels);
    const capTree = treeEntries(repoDir, captureCommit, rels);
    for (const e of idx.errors) errors.push(`LINEAGE_INDEX_${e}`);
    for (const e of headTree.errors) errors.push(`LINEAGE_HEAD_${e}`);
    for (const e of capTree.errors) errors.push(`LINEAGE_CAPTURE_${e}`);
    for (const rel of rels) {
      const i = idx.byPath.get(rel), h = headTree.byPath.get(rel), c = capTree.byPath.get(rel);
      if (!h) { errors.push(`LINEAGE_HEAD_ENTRY_MISSING ${rel}`); continue; }
      if (h.type !== 'blob') { errors.push(`LINEAGE_HEAD_ENTRY_TYPE ${rel} ${h.type}`); continue; }
      if (!c) { errors.push(`LINEAGE_CAPTURE_ENTRY_MISSING ${rel}`); continue; }
      if (c.type !== 'blob') { errors.push(`LINEAGE_CAPTURE_ENTRY_TYPE ${rel} ${c.type}`); continue; }
      if (!i) { errors.push(`LINEAGE_INDEX_MISSING ${rel}`); continue; }        // staged deletion
      if (i.stage !== 0) { errors.push(`LINEAGE_INDEX_STAGE ${rel} ${i.stage}`); continue; }
      if (i.oid !== h.oid) errors.push(`LINEAGE_INDEX_BLOB ${rel} ${i.oid} != ${h.oid}`);
      if (i.mode !== h.mode) errors.push(`LINEAGE_INDEX_MODE ${rel} ${i.mode} != ${h.mode}`);
      if (i.oid !== c.oid) errors.push(`LINEAGE_INDEX_CAPTURE_BLOB ${rel} ${i.oid} != ${c.oid}`);
      if (i.mode !== c.mode) errors.push(`LINEAGE_INDEX_CAPTURE_MODE ${rel} ${i.mode} != ${c.mode}`);
    }
  }
  return { ok: errors.length === 0, errors, headCommit: head };
}

// ── generator authority ─────────────────────────────────────────────────────
// s4-gen은 승격하지 않지만 **산출물을 만든다.** 이전 판은 write 직전에 워킹트리 clean만
// 봤고, 실행 중 다른 clean commit으로 checkout해도 그대로 통과했다(실증: A→B checkout 뒤
// worktreeDirtyEntries가 []). 시작 commit에 못박아 HEAD 이동과 blob 드리프트를 함께 본다.
export function generatorAuthority(repoDir, startCommit) {
  const errors = [];
  const dirty = worktreeDirtyEntries(repoDir);
  if (dirty.length) errors.push(`WORKTREE_DIRTY ${dirty.length}: ${dirty.slice(0, 5).join(' | ')}`);
  if (typeof startCommit !== 'string' || !/^[0-9a-f]{40}$/.test(startCommit))
    return { ok: false, errors: [...errors, `START_COMMIT_REQUIRED ${String(startCommit)}`] };
  let now = null;
  try { now = gitAuthority(repoDir, 'rev-parse', 'HEAD').trim(); } catch (e) { errors.push('HEAD_UNREADABLE'); }
  if (now && now !== startCommit) errors.push(`HEAD_MOVED ${startCommit} -> ${now}`);
  for (const [label, list] of [['GENERATOR', GENERATOR_HASHED_MODULES], ['AUTHORITY', HASHED_MODULES]]) {
    const g = headBlobBinding(repoDir, list, startCommit);
    if (g.errors.length) errors.push(...g.errors.map((e) => `${label}_${e}`));
  }
  return { ok: errors.length === 0, errors };
}

// 버전 디렉터리를 읽는 **단일 checked 구현**. capture bundle 읽기와 승격 readback이 같은
// 것을 쓴다. 이전 판은 두 구현이 갈라져 있었고, readback 쪽만 dotfile을 건너뛰거나
// symlink를 보지 않는 식의 차이가 생길 자리였다.
export function readVersionChecked(fixturesDir, digest) {
  const fail = (e) => ({ errors: [e], contextRaw: null, pngByName: null, digest: null });
  const dir = versionDir(fixturesDir, digest);
  const dErr = safeLeaf(fixturesDir, dir, 'dir');
  if (dErr) return fail(`VERSION_${dErr}`);
  if (!existsSync(dir)) return fail(`VERSION_MISSING ${digest}`);
  let top = null;
  try { top = readdirSync(dir).sort(); } catch (e) { return fail(`VERSION_UNREADABLE ${digest}`); }
  if (JSON.stringify(top) !== JSON.stringify(['context.json', 'shots']))
    return fail(`VERSION_FILE_SET ${digest} got=[${top}]`);
  const ctxPath = join(dir, 'context.json'), shots = join(dir, 'shots');
  const cErr = safeLeaf(fixturesDir, ctxPath, 'file');
  if (cErr) return fail(`VERSION_${cErr}`);
  const sErr = safeLeaf(fixturesDir, shots, 'dir');
  if (sErr) return fail(`VERSION_${sErr}`);
  let names = null;
  try { names = readdirSync(shots); } catch (e) { return fail(`VERSION_SHOTS_UNREADABLE ${digest}`); }
  // dotfile을 조용히 건너뛰지 않는다 — 있으면 그 자체가 오류다(건너뛰면 digest 밖의
  // 파일이 버전 디렉터리 안에 숨는다).
  const dots = names.filter((n) => n.startsWith('.'));
  if (dots.length) return fail(`VERSION_DOTFILE ${digest} [${dots}]`);
  for (const n of names) {
    const e = safeLeaf(fixturesDir, join(shots, n), 'file');
    if (e) return fail(`VERSION_${e}`);
  }
  const pngByName = {};
  let contextRaw = null;
  try {
    contextRaw = readFileSync(ctxPath, 'utf8');
    for (const n of names) pngByName[n] = readFileSync(join(shots, n));
  } catch (e) { return fail(`VERSION_READ_FAILED ${(e && e.message) || e}`); }
  // 버전 디렉터리는 불변이다 — 내용이 digest와 다르면 디스크가 변조된 것이다.
  const actual = bundleDigest(contextRaw, pngByName);
  if (actual !== digest) return fail(`VERSION_TAMPERED ${actual} != ${digest}`);
  return { errors: [], contextRaw, pngByName, digest };
}

// bundle을 읽는 단일 경로. 포인터 → 불변 버전 디렉터리.
export function readCaptureBundle(fixturesDir, phase) {
  if (!CAPTURE_PHASES.includes(phase)) return { errors: [`BUNDLE_PHASE_INVALID ${phase}`], contextRaw: null, pngByName: null };
  const r = readReleaseChecked(fixturesDir);
  if (r.errors.length) return { errors: r.errors, contextRaw: null, pngByName: null };
  const digest = r.release && r.release[phase];
  if (!digest) return { errors: [`CAPTURE_BUNDLE_MISSING ${phase}`], contextRaw: null, pngByName: null };
  const v = readVersionChecked(fixturesDir, digest);
  if (v.errors.length) return { errors: v.errors.map((e) => `CAPTURE_${e}`), contextRaw: null, pngByName: null };
  return { errors: [], contextRaw: v.contextRaw, pngByName: v.pngByName, digest };
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
    return gitAuthority(repoDir, 'rev-parse', `${ref}:${rel}`).trim();
  } catch (e) { return null; }
}

// expected는 **content-addressed 불변 파일**이다. release.expectedSha가 그것을 고른다.
export const expectedPath = (fixturesDir, sha256hex) =>
  join(fixturesDir, BUNDLE_ROOT, EXPECTED_DIR, `${sha256hex}.json`);

// release가 가리키는 expected bytes를 읽고 **SHA exact**를 확인한다.
// 이름을 믿지 않는다 — 정확한 이름으로 변조된 파일을 심어두면 그냥 통과한다.
const HEX64 = /^[0-9a-f]{64}$/;
// release manifest 스키마 — 키 exact, 값은 64자리 lowercase hex.
export function validateReleaseShape(rel) {
  if (!rel || typeof rel !== 'object' || Array.isArray(rel)) return ['RELEASE_SHAPE'];
  const got = Object.keys(rel).sort();
  const want = ['dark', 'expectedSha', 'light'];
  const errors = [];
  if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`RELEASE_KEYS [${got}] != [${want}]`);
  for (const k of want) if (typeof rel[k] !== 'string' || !HEX64.test(rel[k])) errors.push(`RELEASE_VALUE ${k} ${String(rel[k])}`);
  return errors;
}

// 경로가 **일반 파일/디렉터리**이고 fixturesDir 안인지. symlink는 거부한다.
function safeLeaf(fixturesDir, p, kind) {
  let rootReal = null;
  try { rootReal = realpathSync(fixturesDir); } catch (e) { return `NODE_ROOT_UNREADABLE`; }
  let st = null;
  try { st = lstatSync(p); } catch (e) { return null; }
  if (st.isSymbolicLink()) return `NODE_SYMLINK ${p}`;
  if (kind === 'dir' && !st.isDirectory()) return `NODE_NOT_DIR ${p}`;
  if (kind === 'file' && !st.isFile()) return `NODE_NOT_FILE ${p}`;
  let real = null;
  try { real = realpathSync(p); } catch (e) { return `NODE_UNRESOLVABLE ${p}`; }
  if (real !== rootReal && !real.startsWith(rootReal + sep)) return `NODE_ESCAPES ${p} -> ${real}`;
  return null;
}

export function readCommittedExpected(fixturesDir) {
  const r = readReleaseChecked(fixturesDir);
  if (r.errors.length) return { errors: r.errors, bytes: null };
  const rel = r.release;
  if (!rel) return { errors: ['EXPECTED_NO_RELEASE'], bytes: null };
  const dirErr = safeLeaf(fixturesDir, join(fixturesDir, BUNDLE_ROOT, EXPECTED_DIR), 'dir');
  if (dirErr) return { errors: [`EXPECTED_${dirErr}`], bytes: null };
  const p = expectedPath(fixturesDir, rel.expectedSha);
  const leafErr = safeLeaf(fixturesDir, p, 'file');
  if (leafErr) return { errors: [`EXPECTED_${leafErr}`], bytes: null };
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
  discoveryEvidence, repoDir, candidates }) {
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
  const cErr = containedDirs(fixturesDir, [BUNDLE_ROOT, join(BUNDLE_ROOT, VERSIONS_DIR),
    join(BUNDLE_ROOT, EXPECTED_DIR), 's4-shots',
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

  // **쓰는 루트를 고정한다** — repoDir 안의 정해진 한 경로가 아니면 아무것도 만들지 않는다.
  // (모든 write는 아래 lock 안에서 일어나므로 이 지점이면 write 0이 보장된다.)
  {
    const rootErr = fixturesRootError(repoDir, fixturesDir);
    if (rootErr) return { errors: [rootErr], promoted: false };
  }

  // ── authority 입력은 **여기서 파생한다** ────────────────────────────────────
  // 이전 판은 hashedModules와 startHead를 caller가 넘겼다. 축소한 목록이나 임의의 commit을
  // 주면 그만큼 결속이 헐거워지므로, 승격이 자기 검사 범위를 caller에게 위임한 셈이었다.
  const start = headBlobBinding(repoDir, HASHED_MODULES);
  if (start.errors.length)
    return { errors: start.errors.map((e) => `PROMOTE_START_${e}`).slice(0, 40), promoted: false };
  const startHead = start.headCommit;
  const pinnedBlobs = start.blobs;
  // caller가 신고한 provenance는 **정본과 exact**여야 한다. 다르면 승인에 쓰인 근거와
  // 승격이 보는 repo 상태가 다른 것이다.
  if (provenanceRefs.headCommit !== startHead)
    return { errors: [`PROMOTE_PROVENANCE_HEAD ${provenanceRefs.headCommit} != ${startHead}`], promoted: false };
  {
    const hb = provenanceRefs.headBlobs;
    if (!hb || typeof hb !== 'object' || Array.isArray(hb))
      return { errors: ['PROMOTE_PROVENANCE_BLOBS_SHAPE'], promoted: false };
    const diff = [];
    for (const rel of HASHED_MODULES) if (hb[rel] !== pinnedBlobs[rel]) diff.push(rel);
    for (const rel of Object.keys(hb)) if (!(rel in pinnedBlobs)) diff.push(rel);
    if (diff.length) return { errors: [`PROMOTE_PROVENANCE_BLOBS [${diff.slice(0, 5)}]`], promoted: false };
  }

  const next = { expectedSha: sha(expectedBytes) };
  for (const phase of CAPTURE_PHASES) next[phase] = bundleDigest(cands[phase].contextRaw, cands[phase].pngByName);

  // 이번 트랜잭션이 만들 파일 집합. **next와 candidate 바이트에서 내부 파생한다** —
  // caller가 "이건 봐줘라"를 넣을 자리가 없다.
  const allowance = transactionAllowance({ fixturesDir, repoDir, next, cands });
  if (allowance.errors.length) return { errors: allowance.errors, promoted: false };

  // ── write 직전 authority ─────────────────────────────────────────────────
  // 긴 projection·검증이 끝난 뒤다. **모듈 내부 검사다** — 콜백으로 받지 않는다.
  // 시작 시점에도 같은 allowance를 쓴다: 앞선 시도가 SIGKILL로 남긴 **동일 digest** orphan은
  // 내용까지 대조해 재사용하고, 그 외의 어떤 변화도 여기서 막힌다.
  {
    const a = promotionAuthority(repoDir, startHead, pinnedBlobs, allowance);
    if (!a.ok) return { errors: [`PROMOTE_AUTHORITY_FAILED ${a.errors.join(' | ')}`], promoted: false };
  }

  // 이번 실행이 **직접 만든** 노드만 담는다. 실패하면 정확히 이것들만 지운다 —
  // 이미 있던(=이전 성공 승격이 남긴 유효한) 버전 디렉터리는 건드리지 않는다.
  const created = [];
  const rollbackCreated = () => {
    for (const p of created.slice().reverse()) try { rmSync(p, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  };

  return withLock(fixturesDir, (lockStillOurs) => {
    // ── candidate lock을 **고정 순서로 함께** 잡는다 (light → dark) ─────────────
    // CAS부터 release pointer rename까지 계속 보유한다. 이전 판은 CAS를 한 번 확인만 해서
    // 재확인과 rename 사이에 A→B 교체 창이 남았고, 실제로 hijack writeCandidate가 성공한 채
    // stale A가 승격됐다(실증). 순서를 고정해 writeCandidate와의 교착도 만들지 않는다.
    const held = [];
    const releaseHeld = () => { for (const h of [...held].reverse()) h.release(); held.length = 0; };
    const candidateLocksOurs = () => held.length === CAPTURE_PHASES.length && held.every((h) => h.stillOurs());
    for (const phase of CAPTURE_PHASES) {
      const l = acquireCandidateLock(fixturesDir, phase);
      if (!l.ok) { releaseHeld(); return { errors: [`PROMOTE_CANDIDATE_LOCK_BUSY ${phase} ${l.errors.join(' ')}`], promoted: false }; }
      held.push(l);
    }
    try { return promoteLocked(); } finally { releaseHeld(); }

    function promoteLocked() {
    // candidate CAS — CLI가 읽은 뒤 누가 candidate를 교체했으면 우리가 검증한 것이 아니다.
    for (const phase of CAPTURE_PHASES) {
      const now = readCandidate(fixturesDir, phase);
      if (now.errors.length) return { errors: now.errors, promoted: false };
      if (now.bundleName !== cands[phase].bundleName)
        return { errors: [`PROMOTE_CANDIDATE_CAS ${phase} ${cands[phase].bundleName} -> ${now.bundleName}`], promoted: false };
      if (bundleDigest(now.contextRaw, now.pngByName) !== next[phase])
        return { errors: [`PROMOTE_CANDIDATE_DIGEST_CAS ${phase}`], promoted: false };
    }
    // release는 **checked reader**로 읽는다 — "없음"과 "형태가 깨짐"을 구별해야 한다.
    const curChecked = readReleaseChecked(fixturesDir);
    if (curChecked.errors.length) return { errors: curChecked.errors.map((e) => `PROMOTE_${e}`), promoted: false };
    const cur = curChecked.release;
    if (JSON.stringify(cur) !== JSON.stringify(fromRelease ?? null))
      return { errors: [`PROMOTE_CAS ${JSON.stringify(cur)} != ${JSON.stringify(fromRelease ?? null)}`], promoted: false };
    if (cur && cur.light === next.light && cur.dark === next.dark && cur.expectedSha === next.expectedSha)
      return { errors: ['PROMOTE_NOOP'], promoted: false };

    // 실패하면 **이번 실행이 만든 것만** 되돌린다. 그래야 다음 재시도가 시작 authority에서
    // 막히지 않는다(실증: 이전 판은 orphan 5건이 남아 재시도가 START에서 죽었다).
    //
    // ⚠️ **lock을 잃었으면 아무것도 지우지 않는다.** 인계받은 writer가 같은 digest로 이미
    // 승격했을 수 있고, 그러면 우리가 만든 바로 그 파일이 그쪽 release의 본체다
    // (실증: A의 rollback이 B의 release를 CAPTURE_VERSION_MISSING + EXPECTED_ARTIFACT_MISSING로
    //  깨뜨렸다). 이 경우 orphan 정리는 사람 몫이다 — LOCK_RECOVERY 절차와 같은 규칙이다.
    const bail = (errors) => {
      if (lockStillOurs() && candidateLocksOurs()) rollbackCreated();
      return { errors, promoted: false };
    };
    try {
      mkdirSync(join(fixturesDir, BUNDLE_ROOT, VERSIONS_DIR), { recursive: true });
      for (const phase of CAPTURE_PHASES) {
        const dest = versionDir(fixturesDir, next[phase]);
        const vErr = safeLeaf(fixturesDir, dest, 'dir');
        if (vErr) return bail([`PROMOTE_VERSION_${vErr}`]);
        if (!existsSync(dest)) {
          const tmp = mkdtempSync(join(fixturesDir, BUNDLE_ROOT, VERSIONS_DIR, `.staging-${phase}-`));
          try {
            mkdirSync(join(tmp, 'shots'));
            writeFileSync(join(tmp, 'context.json'), cands[phase].contextRaw);
            for (const [n, b] of Object.entries(cands[phase].pngByName)) writeFileSync(join(tmp, 'shots', n), b);
            renameSync(tmp, dest);
            created.push(dest);
          } catch (e) { try { rmSync(tmp, { recursive: true, force: true }); } catch (e2) { /* noop */ } throw e; }
        }
        // **이름을 믿지 않는다.** 기존 디렉터리든 방금 만든 것이든 같은 checked reader로
        // 다시 읽어 재해시한다 — 정확한 digest 이름으로 변조된 디렉터리를 미리 심어두면
        // 승격이 성공해 버린다(실증).
        const back = readVersionChecked(fixturesDir, next[phase]);
        if (back.errors.length) return bail(back.errors.map((e) => `PROMOTE_${e}`));
      }
      // expected를 **content-addressed 불변 파일로 먼저** 만들고 읽어 확인한다.
      // 여기서 실패하면 release pointer는 손대지 않았으므로 이전 정본이 그대로 유효하다.
      mkdirSync(join(fixturesDir, BUNDLE_ROOT, EXPECTED_DIR), { recursive: true });
      const eDirErr = safeLeaf(fixturesDir, join(fixturesDir, BUNDLE_ROOT, EXPECTED_DIR), 'dir');
      if (eDirErr) return bail([`PROMOTE_EXPECTED_${eDirErr}`]);
      const expPath = expectedPath(fixturesDir, next.expectedSha);
      const eLeafErr = safeLeaf(fixturesDir, expPath, 'file');
      if (eLeafErr) return bail([`PROMOTE_EXPECTED_${eLeafErr}`]);
      if (!existsSync(expPath)) {
        const eErr = atomicWrite(expPath, expectedBytes);
        if (eErr) return bail([eErr]);
        created.push(expPath);
      }
      const backExp = readFileSync(expPath, 'utf8');
      if (sha(backExp) !== next.expectedSha)
        return bail([`PROMOTE_EXPECTED_TAMPERED ${sha(backExp)} != ${next.expectedSha}`]);

      // pointer를 쓰기 **직전에 한 번 더** 본다. lock을 잡고 버전 디렉터리를 만드는 동안에도
      // 워킹트리·HEAD는 움직일 수 있다. 방금 만든 산출물은 allowance가 **내용까지 대조해**
      // 허용하고, 그 외의 tracked/staged/untracked 변화는 전부 여기서 막힌다.
      // requirePresent: 이 시점에는 allowance의 context/PNG/expected가 **전부 존재하는
      // 일반 파일이고 SHA가 정확**해야 한다. 부재는 결함이다.
      const a2 = promotionAuthority(repoDir, startHead, pinnedBlobs, lateAllowance(allowance));
      if (!a2.ok) return bail([`PROMOTE_AUTHORITY_FAILED_LATE ${a2.errors.join(' | ')}`]);
      // **shape까지 다시 본다.** allowance는 "우리가 쓰기로 한 파일들"만 알기 때문에 그 옆에
      // 생긴 여분 노드를 못 본다. 특히 빈 디렉터리는 git이 추적하지 않아 status에도 안 잡힌다
      // (실증: late authority 시점에 `shots/EXTRA_EMPTY_DIR/`를 만들자 promoted=true였고
      //  그 release는 CAPTURE_VERSION_NODE_NOT_FILE로 읽히지 않았다).
      for (const phase of CAPTURE_PHASES) {
        const late = readVersionChecked(fixturesDir, next[phase]);
        if (late.errors.length) return bail(late.errors.map((e) => `PROMOTE_LATE_${e}`));
      }
      // lock 소유권도 마지막에 다시 본다 — 누가 우리 lock을 교체했으면 상호배제가 이미
      // 깨진 것이므로 pointer를 쓰지 않는다. candidate lock도 함께 본다(CAS 구간 보유).
      if (!lockStillOurs()) return bail(['PROMOTE_LOCK_OWNERSHIP_LOST']);
      if (!candidateLocksOurs()) return bail(['PROMOTE_CANDIDATE_LOCK_OWNERSHIP_LOST']);
      // **마지막에 pointer 하나만** 원자적으로 교체한다. 실패하면 이전 release가 이전
      // expected를 계속 읽는다 — 새 expected는 롤백으로 사라진다.
      const err = atomicWrite(releasePath(fixturesDir), JSON.stringify(next, null, 1));
      if (err) return bail([err]);
    } catch (e) {
      return bail([`PROMOTE_FAILED ${e && e.message}`]);
    }
    return { errors: [], promoted: true, release: next, from: cur, datasetDigest: digests.light };
    }
  });
}


// ── 해시 입력 모듈의 HEAD 결속 ────────────────────────────────────────────────
// fingerprint는 "로컬 디스크 상태"만 증명한다. tracked 여부만 보면 워킹카피가 HEAD와 달라도
// 통과한다. **캡처 시작 시점에** 강제해야 한다 — CI에서만 보면 이미 만들어진 산출물의
// 출처를 되돌릴 수 없다.
export function headBlobBinding(repoDir, relPaths, pinnedCommit) {
  const errors = [], blobs = {};
  const run = (args) => gitAuthority(repoDir, ...args);
  // 고정 commit을 받으면 그것을 쓴다. `HEAD:path`는 캡처 도중 HEAD가 움직이면 다른 대상을
  // 가리킨다 — 시작 시점에 해석한 commit으로 못박아야 같은 것을 두 번 본다.
  let headCommit = pinnedCommit || null;
  if (!headCommit) {
    try { headCommit = run(['rev-parse', 'HEAD']).trim(); }
    catch (e) { return { errors: [`HEAD_UNRESOLVED ${e && e.message}`], blobs: null, headCommit: null }; }
  }
  for (const rel of relPaths) {
    let working = null, head = null;
    try { working = run(['hash-object', rel]).trim(); }
    catch (e) { errors.push(`HASH_OBJECT_FAILED ${rel}`); continue; }
    try { head = run(['rev-parse', `${headCommit}:${rel}`]).trim(); }
    catch (e) { errors.push(`NOT_TRACKED_AT_HEAD ${rel}`); continue; }
    if (working !== head) errors.push(`WORKING_DIFFERS_FROM_HEAD ${rel} ${working} != ${head}`);
    blobs[rel] = head;
  }
  return { errors, blobs: errors.length ? null : blobs, headCommit };
}


// **sink 직전 authority.** 이전 판은 approveAndWrite를 부르기 *전에* 한 번 봤다. 그런데
// serialize와 validator가 그 뒤에 돌기 때문에, 그 사이 clean A→B checkout이 일어나면
// writer는 아무 검사 없이 파일을 만들었다(mkdir/write에 게이트가 없었다).
// 실제 write 콜백을 이 함수로 감싸면 검사가 mkdir/write보다 반드시 앞에 온다.
export function sinkWriter({ repoDir, startCommit, write }) {
  if (typeof write !== 'function') throw new Error('SINK_WRITE_REQUIRED');
  return (bytes) => {
    const a = generatorAuthority(repoDir, startCommit);
    if (!a.ok) throw new Error(`GENERATOR_AUTHORITY_AT_SINK ${a.errors.join(' | ')}`);
    return write(bytes);
  };
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
