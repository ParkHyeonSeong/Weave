// frontend/scripts/s4-audit-candidate.mjs
// **커밋된 privacy audit 부착 명령.** 캡처된 candidate에 사람이 검토한 audit을 붙인다.
//
//   node scripts/s4-audit-candidate.mjs --phase light --review <reviewed.json>
//   node scripts/s4-audit-candidate.mjs --phase dark  --review <reviewed-dark.json>
//
// **운영 절차: light와 dark 양쪽을 각각 audit한다.** 한쪽만 붙이면 승격의 dataset 쌍
// 검증이 audit 없는 phase를 뒤늦게 만난다.
// review JSON은 **repo 밖 경로**에 둔다 — repo 안에 두면 worktree가 더러워져 게이트에 걸린다.
//
// 왜 별도 명령인가: 캡처 러너는 화면을 찍을 뿐 "이 픽셀에 개인정보가 없다"를 판단할 수 없다.
// 그건 사람이 23장을 보고 내리는 결론이고, 그 결론이 산출물에 결속돼야 승격이 성립한다.
//
// 계약:
//  - PNG SHA는 **candidate의 실제 바이트**에서 직접 계산한다(입력 파일의 주장을 믿지 않는다).
//  - contextSubjectSha256도 privacyAudit을 제외한 **실제 context**에서 계산한다.
//  - 입력은 사람이 검토한 결과(captureName, pass, findings)뿐이고 exact 23개여야 한다.
//  - 기존 bundle을 in-place로 고치지 않는다 — writeCandidate로 **새 bundle을 발행**한다.
//    (bundle은 content-addressed 불변이다. 고치면 이름과 내용이 어긋난다.)
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as RAW_SPEC from '../library/s4Spec.mjs';
import * as EV from '../library/s4Evaluator.mjs';
import * as CANON from '../library/s4Canonicalize.mjs';
import { readCandidateBundle, writeCandidate } from '../library/s4CaptureRunner.mjs';
import { promotionAuthority, headBlobBinding, worktreeDirtyEntries } from '../library/s4Promote.mjs';
import { HASHED_MODULES, REPO_DIR } from './s4-capture.mjs';
import { execSync } from 'node:child_process';

export const AUDIT_SCOPE = 'dedicated-synthetic-account-workspace';

export function parseAuditArgs(argv) {
  if (!Array.isArray(argv)) return { error: 'ARGV_REQUIRED' };
  if (argv.length !== 4) return { error: `BAD_ARITY ${argv.length}` };
  if (argv[0] !== '--phase') return { error: `EXPECTED_PHASE_FLAG ${argv[0]}` };
  if (!['light', 'dark'].includes(argv[1])) return { error: `BAD_PHASE ${argv[1]}` };
  if (argv[2] !== '--review') return { error: `EXPECTED_REVIEW_FLAG ${argv[2]}` };
  if (typeof argv[3] !== 'string' || !argv[3]) return { error: 'BAD_REVIEW_PATH' };
  return { phase: argv[1], reviewPath: argv[3] };
}

// 사람 검토 결과의 형태 검사. **exact 23개**이고 spec의 capture 이름 집합과 정확히 같아야 한다.
export function validateReview(review, expectedNames) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['REVIEW_SHAPE'];
  if (review.scope !== AUDIT_SCOPE) errors.push(`REVIEW_SCOPE ${String(review.scope)}`);
  if (!Array.isArray(review.captures)) return [...errors, 'REVIEW_CAPTURES_SHAPE'];
  const got = review.captures.map((c) => c && c.captureName).filter((x) => typeof x === 'string').sort();
  const want = [...expectedNames].sort();
  if (JSON.stringify(got) !== JSON.stringify(want))
    errors.push(`REVIEW_CAPTURE_SET missing=[${want.filter((n) => !got.includes(n))}] extra=[${got.filter((n) => !want.includes(n))}]`);
  if (new Set(got).size !== got.length) errors.push('REVIEW_CAPTURE_DUPLICATE');
  for (const c of review.captures) {
    if (!c || typeof c !== 'object') { errors.push('REVIEW_ENTRY_SHAPE'); continue; }
    const at = String(c.captureName);
    if (typeof c.pass !== 'boolean') errors.push(`REVIEW_PASS_SHAPE ${at}`);
    if (!Array.isArray(c.findings)) errors.push(`REVIEW_FINDINGS_SHAPE ${at}`);
    // pass:true인데 findings가 남아 있으면 모순이다 — 검수 I1과 같은 규칙.
    if (c.pass === true && Array.isArray(c.findings) && c.findings.length)
      errors.push(`REVIEW_PASS_WITH_FINDINGS ${at}`);
    if (c.pass === false) errors.push(`REVIEW_NOT_PASSED ${at}`);
  }
  return errors;
}

export async function main(argv, { log = console.log, err = console.error } = {}) {
  const cli = parseAuditArgs(argv);
  if (cli.error) {
    err('usage: node scripts/s4-audit-candidate.mjs --phase <light|dark> --review <reviewed.json>');
    err(`  ${cli.error}`);
    return 2;
  }
  const snap = EV.snapshotSpec(RAW_SPEC);
  if (snap.errors.length) { err(`SPEC_NOT_PLAIN — total=${snap.errors.length}`); return 1; }
  const SPEC = snap.spec;
  const sha256 = (v) => createHash('sha256').update(v).digest('hex');
  const fixturesDir = fileURLToPath(new URL('../library/__fixtures__/', import.meta.url));
  const gitExec = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

  // ── 시작 authority ────────────────────────────────────────────────────────
  // audit은 candidate를 새로 발행한다 — 산출물을 만드는 명령이므로 캡처·승격과 같은 게이트를 건다.
  const dirty0 = worktreeDirtyEntries(REPO_DIR, gitExec);
  if (dirty0.length) {
    err(`REPO_DIRTY — total=${dirty0.length}`);
    for (const e of dirty0.slice(0, 20)) err(`  ${e}`);
    return 1;
  }
  const head = headBlobBinding(REPO_DIR, HASHED_MODULES, gitExec);
  if (head.errors.length) {
    err(`HEAD_BINDING_FAILED — total=${head.errors.length}`);
    for (const e of head.errors) err(`  ${e}`);
    return 1;
  }

  const b = readCandidateBundle(fixturesDir, cli.phase);
  if (b.errors.length) {
    err(`CANDIDATE_UNREADABLE ${cli.phase}`);
    for (const e of b.errors) err(`  ${e}`);
    return 1;
  }
  let review = null;
  try { review = JSON.parse(readFileSync(cli.reviewPath, 'utf8')); }
  catch (e) { err(`REVIEW_UNREADABLE ${cli.reviewPath}`); return 1; }

  const names = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.captureName);
  const rErrors = validateReview(review, names);
  if (rErrors.length) {
    err(`REVIEW_INVALID — total=${rErrors.length}`);
    for (const e of rErrors.slice(0, 20)) err(`  ${e}`);
    return 1;
  }

  // SHA는 **실제 바이트**에서 계산한다. 입력 파일이 주장하는 값은 쓰지 않는다.
  const byName = new Map(review.captures.map((c) => [c.captureName, c]));
  const captures = names.slice().sort().map((n) => {
    const bytes = b.pngByName[n];
    if (!bytes) throw new Error(`CANDIDATE_PNG_MISSING ${n}`);
    const r = byName.get(n);
    return { captureName: n, sha256: sha256(bytes), pass: r.pass, findings: r.findings };
  });

  let ctx = null;
  try { ctx = JSON.parse(b.contextRaw); } catch (e) { err('CANDIDATE_CONTEXT_UNPARSEABLE'); return 1; }
  // candidate의 provenance가 **지금** 값과 같은지 — 다른 HEAD에서 찍은 candidate에
  // audit을 붙이면 그 산출물의 출처가 섞인다.
  {
    const pv = ctx.provenance || {};
    const fpNow = EV.specFingerprint(SPEC, sha256);
    const errs = [];
    if (pv.headCommit !== head.headCommit) errs.push(`PROVENANCE_HEAD ${pv.headCommit} != ${head.headCommit}`);
    if (JSON.stringify(pv.blobs || {}) !== JSON.stringify(head.blobs)) errs.push('PROVENANCE_BLOBS');
    if (pv.specFingerprint !== fpNow) errs.push(`PROVENANCE_FINGERPRINT ${pv.specFingerprint} != ${fpNow}`);
    if (errs.length) {
      err(`CANDIDATE_PROVENANCE_MISMATCH — total=${errs.length}`);
      for (const e of errs) err(`  ${e}`);
      return 1;
    }
  }
  const { privacyAudit: _old, ...subject } = ctx;
  const contextSubjectSha256 = sha256(JSON.stringify(CANON.canonicalize(subject)));
  const privacyAudit = { scope: AUDIT_SCOPE, contextPass: true, contextSubjectSha256, captures };

  // 공용 helper로 자기검사 — 부착 직후의 audit이 승격에서 통과할 형태인지 여기서 본다.
  const selfCheck = EV.validatePrivacyAudit(privacyAudit,
    { captures: captures.map((c) => ({ captureName: c.captureName, sha256: c.sha256 })), contextSubjectSha256 });
  if (selfCheck.length) {
    err(`AUDIT_SELF_CHECK — total=${selfCheck.length}`);
    for (const e of selfCheck.slice(0, 20)) err(`  ${e}`);
    return 1;
  }

  // ── write 직전 authority 재확인 ───────────────────────────────────────────
  {
    const a = promotionAuthority(REPO_DIR, HASHED_MODULES, head.headCommit);
    if (!a.ok) {
      err(`AUTHORITY_FAILED — ${a.errors.join(' | ')}`);
      return 1;                                   // write 0
    }
  }
  // **새 bundle을 발행한다.** 기존 것은 불변이므로 in-place로 고치지 않는다.
  const nextRaw = JSON.stringify({ ...subject, privacyAudit }, null, 1);
  const wErrors = writeCandidate({ fixturesDir, phase: cli.phase, contextRaw: nextRaw,
    pngByCaptureName: b.pngByName, expectedCaptureNames: Object.keys(b.pngByName) });
  if (wErrors.length) {
    err(`WRITE FAILED — total=${wErrors.length}`);
    for (const e of wErrors) err(`  ${e}`);
    return 1;
  }
  const after = readCandidateBundle(fixturesDir, cli.phase);
  if (after.errors.length) { err('READBACK_FAILED'); for (const e of after.errors) err(`  ${e}`); return 1; }
  log(`audit attached → ${cli.phase} bundle=${after.bundleName}`);
  log(`captures=${captures.length} contextSubject=${contextSubjectSha256.slice(0, 16)}`);
  return 0;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then((code) => process.exit(code));
