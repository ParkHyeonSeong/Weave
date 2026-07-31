// frontend/scripts/s4-promote-capture.mjs
// **커밋된 승격 명령.** candidate → committed bundle 로 가는 유일한 실행 경로.
//
// 이 파일이 없으면 promoteCapture는 테스트에서만 불리는 함수이고, 실제 산출물은
// 여전히 수동 복사로 committed가 된다 — 승격 계약이 무의미해진다.
//
//   node scripts/s4-promote-capture.mjs      (light+dark를 한 트랜잭션으로)
//
// 계약:
//  - 검증기를 주입하지 않는다. promoteCapture가 내부에서 구체 검증기를 부른다.
//  - 산출물 경로는 phase에서 내부 파생된다.
//  - HEAD 결속·spec fingerprint·dataset digest를 **지금 값으로** 재계산해 provenance와 대조한다.
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import * as RAW_SPEC from '../library/s4Spec.mjs';
import { snapshotSpec, specFingerprint } from '../library/s4Evaluator.mjs';
import { promoteRelease, headBlobBinding, readRelease } from '../library/s4Promote.mjs';
import { HASHED_MODULES, REPO_DIR } from './s4-capture.mjs';

// 인자가 없다. **두 phase를 함께** 승격하는 것이 유일한 동작이다 —
// 한쪽만 승격하면 dataset 쌍 검증이 이미 committed된 산출물을 뒤늦게 보게 된다.
export function parsePromoteArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) return { error: `UNEXPECTED_ARGS ${argv && argv.join(' ')}` };
  return {};
}

export async function main(argv, { log = console.log, err = console.error } = {}) {
  const cli = parsePromoteArgs(argv);
  if (cli.error) { err(`usage: node scripts/s4-promote-capture.mjs\n  ${cli.error}`); return 2; }
  const snap = snapshotSpec(RAW_SPEC);
  if (snap.errors.length) { err(`SPEC_NOT_PLAIN — total=${snap.errors.length}`); return 1; }
  const SPEC = snap.spec;
  const sha256 = (v) => createHash('sha256').update(v).digest('hex');

  const head = headBlobBinding(REPO_DIR, HASHED_MODULES,
    (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  if (head.errors.length) { err(`HEAD_BINDING_FAILED — total=${head.errors.length}`);
    for (const e of head.errors) err(`  ${e}`); return 1; }

  const fixturesDir = fileURLToPath(new URL('../library/__fixtures__/', import.meta.url));
  // CAS 기준: **검증 전에** 읽은 포인터. 검증 도중 누가 승격했으면 lock 안에서 어긋난다.
  const fromRelease = readRelease(fixturesDir);
  // ⚠️ 최종 release는 **expected fixture까지 함께** 승격한다. 그 fixture는 projector가 만들어야
  // 하고(SCSS 컴파일 → 선언 투영 → attribution), 그 배선은 아직 이 CLI에 없다.
  // 지금은 fail-closed로 멈춘다 — geometry 승인 없는 승격을 허용하느니 실행 불가가 낫다.
  err('PROMOTE_NOT_WIRED — expected fixture(projector) 배선 전에는 승격할 수 없다.');
  err('  필요한 순서: capture(light+dark) → projector fixture → promoteRelease({fixture, expectedBytes})');
  void promoteRelease; void fromRelease; void fixturesDir; void sha256;
  return 1;
  /* eslint-disable no-unreachable */
  const r = { errors: ['unreachable'], release: null, datasetDigest: null };
  if (r.errors.length) {
    err(`PROMOTE FAILED — total=${r.errors.length}`);
    for (const e of r.errors.slice(0, 20)) err(`  ${e}`);
    return 1;                                       // 어느 phase도 committed가 되지 않는다
  }
  log(`promoted pair light=${r.pointer.light.slice(0, 12)} dark=${r.pointer.dark.slice(0, 12)}`);
  log(`dataset=${String(r.datasetDigest).slice(0, 16)} (light == dark 확인됨)`);
  return 0;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then((code) => process.exit(code));
