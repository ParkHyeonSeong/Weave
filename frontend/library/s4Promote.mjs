// frontend/library/s4Promote.mjs
// candidate 생성(staging)과 committed 승격을 **분리된 두 함수**로 둔다.
//
// 이전 판은 `--promote`도 approveAndWrite로 staging을 새로 덮어쓴 뒤 곧바로 승격해서,
// "기본 실행에서 검토한 candidate를 승격한다"가 성립하지 않았다. 또 staging/tmp 경로가 고정이라
// (a) 심볼릭 링크를 따라가 다른 파일을 덮어쓸 수 있고 (b) 동시 실행끼리 tmp를 밟았다.
//
// 계약
//  - stageBytes: 고유 exclusive temp → write → fsync → atomic rename → { path, sha256 }
//  - promoteStaged: staging을 **재생성하지 않고 읽는다**. expectedSha와 exact 일치해야 하고,
//    committed digest CAS(prevSha)로 그 사이 committed가 바뀌지 않았음을 확인한 뒤 atomic rename.
//  - 두 함수 모두 대상 경로가 심볼릭 링크면 거부한다(FOLLOWED_SYMLINK 방지).
import { mkdtempSync, writeFileSync, readFileSync, renameSync, rmSync, openSync, fsyncSync, closeSync, lstatSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');

function assertNotSymlink(p) {
  try { if (lstatSync(p).isSymbolicLink()) return `SYMLINK_REFUSED ${p}`; } catch (e) { /* 없으면 통과 */ }
  return null;
}

// 고유 temp에 쓰고 fsync한 뒤 목적지로 atomic rename. 같은 파일시스템을 쓰기 위해
// temp 디렉터리를 목적지 옆에 만든다(os.tmpdir는 다른 볼륨일 수 있어 rename이 깨진다).
function atomicWrite(dest, bytes) {
  const err = assertNotSymlink(dest);
  if (err) return { error: err };
  const dir = mkdtempSync(join(dirname(dest), `.s4-${basename(dest)}-`));
  const tmp = join(dir, 'payload');
  try {
    writeFileSync(tmp, bytes, { flag: 'wx' });      // 배타 생성
    const fd = openSync(tmp, 'r+'); fsyncSync(fd); closeSync(fd);
    renameSync(tmp, dest);
    return { error: null };
  } catch (e) {
    return { error: `ATOMIC_WRITE_FAILED ${e && e.message}` };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

export const STAGING_NAME = 's4-expected.candidate.json';
export const COMMITTED_NAME = 's4-expected.json';

// 승인된 bytes를 staging에 기록한다. 반환한 sha256이 이후 승격의 신원(identity)이다.
export function stageBytes({ fixturesDir, bytes }) {
  if (typeof bytes !== 'string' && !(bytes instanceof Uint8Array)) return { errors: ['STAGE_BYTES_REQUIRED'], sha256: null, path: null };
  const dest = join(fixturesDir, STAGING_NAME);
  const { error } = atomicWrite(dest, bytes);
  if (error) return { errors: [error], sha256: null, path: dest };
  return { errors: [], sha256: sha(bytes), path: dest };
}

// staging을 읽어 승격한다. **생성하지 않는다.**
//  - expectedSha: 기본 실행이 출력한 staging SHA. 불일치면 거부(검토한 것과 다른 것을 승격 방지).
//  - validate: (stagedRaw) => errors[]  — committed 계약 재검증(주입이 아니라 호출부가 준 정본 검사기).
//  - prevSha: CAS. 현재 committed의 SHA와 다르면 거부(그 사이 누가 바꿈).
export function promoteStaged({ fixturesDir, expectedSha, validate, prevSha }) {
  const stagingPath = join(fixturesDir, STAGING_NAME);
  const committedPath = join(fixturesDir, COMMITTED_NAME);
  if (!existsSync(stagingPath)) return { errors: ['PROMOTE_NO_STAGING'], promoted: false };
  const sErr = assertNotSymlink(stagingPath); if (sErr) return { errors: [sErr], promoted: false };
  const cErr = assertNotSymlink(committedPath); if (cErr) return { errors: [cErr], promoted: false };

  const staged = readFileSync(stagingPath, 'utf8');
  const stagedSha = sha(staged);
  if (typeof expectedSha !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha))
    return { errors: ['PROMOTE_EXPECTED_SHA_REQUIRED'], promoted: false, stagedSha };
  if (stagedSha !== expectedSha)
    return { errors: [`PROMOTE_STAGING_SHA_MISMATCH ${stagedSha} != ${expectedSha}`], promoted: false, stagedSha };

  // CAS — 승격 직전 committed 상태가 호출자가 본 것과 같은지
  const currentSha = existsSync(committedPath) ? sha(readFileSync(committedPath, 'utf8')) : null;
  if (prevSha !== undefined && prevSha !== currentSha)
    return { errors: [`PROMOTE_CAS_CONFLICT ${currentSha} != ${prevSha}`], promoted: false, stagedSha };

  if (typeof validate !== 'function') return { errors: ['PROMOTE_VALIDATE_REQUIRED'], promoted: false, stagedSha };
  const errors = validate(staged);
  if (!Array.isArray(errors)) return { errors: ['PROMOTE_VALIDATOR_NONARRAY'], promoted: false, stagedSha };
  if (errors.length) return { errors, promoted: false, stagedSha };

  const { error } = atomicWrite(committedPath, staged);
  if (error) return { errors: [error], promoted: false, stagedSha };
  return { errors: [], promoted: true, stagedSha };
}
