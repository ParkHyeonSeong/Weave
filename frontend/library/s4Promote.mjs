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
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');

export const STAGING_NAME = 's4-expected.candidate.json';
export const COMMITTED_NAME = 's4-expected.json';
const LOCK_NAME = '.s4-promote.lock';

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
function withLock(fixturesDir, fn) {
  const lock = join(fixturesDir, LOCK_NAME);
  let fd = null;
  try { fd = openSync(lock, 'wx'); } catch (e) { return { errors: ['PROMOTE_LOCK_BUSY'], promoted: false }; }
  try { return fn(); }
  finally { try { closeSync(fd); } catch (e) { /* noop */ } try { unlinkSync(lock); } catch (e) { /* noop */ } }
}

export function promoteStaged({ fixturesDir, expectedSha, fromSha, canonicalBytes }) {
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
