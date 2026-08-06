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
// 계약 — **검토한 바이트에 결속한다**:
//  - review는 자기가 무엇을 봤는지 스스로 말한다: phase, bundleName, contextSubjectSha256,
//    그리고 캡처별 sha256. 이 넷이 전부 **지금 candidate의 실제 바이트**와 exact여야 한다.
//    (이전 판은 captureName/pass/findings만 받았다 — light review를 dark에 붙여도 통과했고,
//     검토 뒤 candidate가 교체돼도 그대로 붙었다.)
//  - candidate context의 phase도 CLI phase와 같아야 한다.
//  - 기존 bundle을 in-place로 고치지 않는다 — writeCandidate로 **새 bundle을 발행**한다.
//    (bundle은 content-addressed 불변이다. 고치면 이름과 내용이 어긋난다.)
//  - 발행은 pointer CAS로 잠근다: 검토한 bundleName이 **여전히** 현재 pointer일 때만 쓴다.
//    lock 안에서 대조하므로 외부 사전 check가 아니다.
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as RAW_SPEC from '../library/s4Spec.mjs';
import * as EV from '../library/s4Evaluator.mjs';
import * as CANON from '../library/s4Canonicalize.mjs';
import { readCandidateBundle, writeCandidate } from '../library/s4CaptureRunner.mjs';
import { promotionAuthority, headBlobBinding, worktreeDirtyEntries,
  HASHED_MODULES } from '../library/s4Promote.mjs';
import { REPO_DIR } from './s4-capture.mjs';

export const AUDIT_SCOPE = 'dedicated-synthetic-account-workspace';
// 운영 진입점이 쓰는 정본 경로. main의 기본값이며, CLI 호출부는 argv 말고 아무것도 넘기지 않는다.
export const FIXTURES_DIR = fileURLToPath(new URL('../library/__fixtures__/', import.meta.url));

export function parseAuditArgs(argv) {
  if (!Array.isArray(argv)) return { error: 'ARGV_REQUIRED' };
  if (argv.length !== 4) return { error: `BAD_ARITY ${argv.length}` };
  if (argv[0] !== '--phase') return { error: `EXPECTED_PHASE_FLAG ${argv[0]}` };
  if (!['light', 'dark'].includes(argv[1])) return { error: `BAD_PHASE ${argv[1]}` };
  if (argv[2] !== '--review') return { error: `EXPECTED_REVIEW_FLAG ${argv[2]}` };
  if (typeof argv[3] !== 'string' || !argv[3]) return { error: 'BAD_REVIEW_PATH' };
  return { phase: argv[1], reviewPath: argv[3] };
}

const REVIEW_KEYS = ['bundleName', 'captures', 'contextSubjectSha256', 'phase', 'scope'];
const CAPTURE_KEYS = ['captureName', 'findings', 'pass', 'sha256'];

// 사람 검토 결과가 **지금 candidate 바이트**를 가리키는지. 형태·집합·해시를 전부 본다.
// bound = { phase, bundleName, contextSubjectSha256, shaByName }
export function validateReview(review, expectedNames, bound) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['REVIEW_SHAPE'];
  const keys = Object.keys(review).sort();
  if (JSON.stringify(keys) !== JSON.stringify(REVIEW_KEYS))
    errors.push(`REVIEW_KEYS [${keys}] != [${REVIEW_KEYS}]`);
  if (review.scope !== AUDIT_SCOPE) errors.push(`REVIEW_SCOPE ${String(review.scope)}`);
  // ── 검토 대상 결속 ─────────────────────────────────────────────────────────
  if (review.phase !== bound.phase) errors.push(`REVIEW_PHASE ${String(review.phase)} != ${bound.phase}`);
  if (review.bundleName !== bound.bundleName)
    errors.push(`REVIEW_BUNDLE ${String(review.bundleName)} != ${bound.bundleName}`);
  if (review.contextSubjectSha256 !== bound.contextSubjectSha256)
    errors.push(`REVIEW_CONTEXT_SUBJECT ${String(review.contextSubjectSha256)} != ${bound.contextSubjectSha256}`);
  if (!Array.isArray(review.captures)) return [...errors, 'REVIEW_CAPTURES_SHAPE'];
  const got = review.captures.map((c) => c && c.captureName).filter((x) => typeof x === 'string').sort();
  const want = [...expectedNames].sort();
  if (JSON.stringify(got) !== JSON.stringify(want))
    errors.push(`REVIEW_CAPTURE_SET missing=[${want.filter((n) => !got.includes(n))}] extra=[${got.filter((n) => !want.includes(n))}]`);
  if (new Set(got).size !== got.length) errors.push('REVIEW_CAPTURE_DUPLICATE');
  for (const c of review.captures) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push('REVIEW_ENTRY_SHAPE'); continue; }
    const at = String(c.captureName);
    const ck = Object.keys(c).sort();
    if (JSON.stringify(ck) !== JSON.stringify(CAPTURE_KEYS)) errors.push(`REVIEW_ENTRY_KEYS ${at} [${ck}]`);
    if (typeof c.pass !== 'boolean') errors.push(`REVIEW_PASS_SHAPE ${at}`);
    if (!Array.isArray(c.findings)) errors.push(`REVIEW_FINDINGS_SHAPE ${at}`);
    // pass:true인데 findings가 남아 있으면 모순이다 — 검수 I1과 같은 규칙.
    if (c.pass === true && Array.isArray(c.findings) && c.findings.length)
      errors.push(`REVIEW_PASS_WITH_FINDINGS ${at}`);
    if (c.pass === false) errors.push(`REVIEW_NOT_PASSED ${at}`);
    // **검토자가 본 PNG가 지금 그 PNG인지.** 이름만 맞고 바이트가 다르면 다른 화면을 승인한 것이다.
    const wantSha = bound.shaByName[at];
    if (wantSha === undefined) continue;                    // 집합 오류는 위에서 이미 보고했다
    if (c.sha256 !== wantSha) errors.push(`REVIEW_CAPTURE_SHA ${at} ${String(c.sha256)} != ${wantSha}`);
  }
  return errors;
}

// ── 순수 판정 코어 ───────────────────────────────────────────────────────────
// **파일을 쓰지 않고 읽지도 않는다.** main이 IO로 모은 사실(dirty 목록·HEAD 결속·candidate
// 바이트·review)을 받아 오류와 부착할 audit만 돌려준다. 이전 판은 테스트를 위해 main에
// repoDir/fixturesDir override를 열어 뒀는데, 그것이 곧 authority 루트 주입 지점이었다
// (실증: fake clean repoDir + 운영 FIXTURES_DIR 조합이 dirty 게이트를 그대로 통과했다).
export function auditDecision({ phase, dirtyEntries, head, fingerprintNow,
  candidate, review, captureNames, sha256 }) {
  const fail = (e) => ({ errors: Array.isArray(e) ? e : [e], privacyAudit: null, nextContextRaw: null });
  if (!['light', 'dark'].includes(phase)) return fail(`AUDIT_PHASE_INVALID ${String(phase)}`);
  if (typeof sha256 !== 'function') return fail('AUDIT_SHA_REQUIRED');
  if (!Array.isArray(dirtyEntries)) return fail('AUDIT_DIRTY_REQUIRED');
  if (dirtyEntries.length)
    return fail([`REPO_DIRTY ${dirtyEntries.length}`, ...dirtyEntries.slice(0, 20)]);
  if (!head || typeof head !== 'object') return fail('AUDIT_HEAD_REQUIRED');
  if (Array.isArray(head.errors) && head.errors.length)
    return fail(['HEAD_BINDING_FAILED', ...head.errors]);
  if (!candidate || typeof candidate.contextRaw !== 'string' || !candidate.pngByName
    || typeof candidate.bundleName !== 'string') return fail('CANDIDATE_SNAPSHOT_INVALID');

  let ctx = null;
  try { ctx = JSON.parse(candidate.contextRaw); } catch (e) { return fail('CANDIDATE_CONTEXT_UNPARSEABLE'); }
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return fail('CANDIDATE_CONTEXT_SHAPE');
  // context가 스스로 신고하는 phase와 CLI phase가 같아야 한다 — 다르면 dark 산출물에
  // light 절차를 돌리는 것이다.
  if (ctx.phase !== phase) return fail(`CANDIDATE_PHASE_MISMATCH ${String(ctx.phase)} != ${phase}`);
  // candidate의 provenance가 **지금** 값과 같은지 — 다른 HEAD에서 찍은 candidate에
  // audit을 붙이면 그 산출물의 출처가 섞인다.
  {
    const pv = ctx.provenance || {};
    const errs = [];
    if (pv.headCommit !== head.headCommit) errs.push(`PROVENANCE_HEAD ${pv.headCommit} != ${head.headCommit}`);
    if (JSON.stringify(pv.blobs || {}) !== JSON.stringify(head.blobs)) errs.push('PROVENANCE_BLOBS');
    if (pv.specFingerprint !== fingerprintNow) errs.push(`PROVENANCE_FINGERPRINT ${pv.specFingerprint} != ${fingerprintNow}`);
    if (errs.length) return fail(['CANDIDATE_PROVENANCE_MISMATCH', ...errs]);
  }

  // SHA는 **실제 바이트**에서 계산한다. review가 주장하는 값은 대조 대상일 뿐 근거가 아니다.
  const shaByName = {};
  for (const n of captureNames) {
    const bytes = candidate.pngByName[n];
    if (!bytes) return fail(`CANDIDATE_PNG_MISSING ${n}`);
    shaByName[n] = sha256(bytes);
  }
  const { privacyAudit: _old, ...subject } = ctx;
  const contextSubjectSha256 = sha256(JSON.stringify(CANON.canonicalize(subject)));

  const rErrors = validateReview(review, captureNames,
    { phase, bundleName: candidate.bundleName, contextSubjectSha256, shaByName });
  if (rErrors.length) return fail(['REVIEW_INVALID', ...rErrors]);

  const byName = new Map(review.captures.map((c) => [c.captureName, c]));
  const captures = [...captureNames].sort().map((n) => {
    const r = byName.get(n);
    return { captureName: n, sha256: shaByName[n], pass: r.pass, findings: r.findings };
  });
  const privacyAudit = { scope: AUDIT_SCOPE, contextPass: true, contextSubjectSha256, captures };
  // 공용 helper로 자기검사 — 부착 직후의 audit이 승격에서 통과할 형태인지 여기서 본다.
  const selfCheck = EV.validatePrivacyAudit(privacyAudit,
    { captures: captures.map((c) => ({ captureName: c.captureName, sha256: c.sha256 })), contextSubjectSha256 });
  if (selfCheck.length) return fail(['AUDIT_SELF_CHECK', ...selfCheck]);

  return { errors: [], privacyAudit,
    nextContextRaw: JSON.stringify({ ...subject, privacyAudit }, null, 1),
    expectedCurrentBundleName: candidate.bundleName };
}

// **루트는 모듈 상수 하나뿐이다.** 인자로 바꿀 수 없다 — 그 지점이 곧 authority 우회로였다.
export async function main(argv, { log = console.log, err = console.error } = {}) {
  const repoDir = REPO_DIR;
  const fixturesDir = FIXTURES_DIR;
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

  // ── IO: 사실 수집 ────────────────────────────────────────────────────────
  const dirty0 = worktreeDirtyEntries(repoDir);
  const head = headBlobBinding(repoDir, HASHED_MODULES);
  const b = readCandidateBundle(fixturesDir, cli.phase);
  if (dirty0.length) {
    err(`REPO_DIRTY — total=${dirty0.length}`);
    for (const e of dirty0.slice(0, 20)) err(`  ${e}`);
    return 1;
  }
  if (b.errors.length) {
    err(`CANDIDATE_UNREADABLE ${cli.phase}`);
    for (const e of b.errors) err(`  ${e}`);
    return 1;
  }
  let review = null;
  try { review = JSON.parse(readFileSync(cli.reviewPath, 'utf8')); }
  catch (e) { err(`REVIEW_UNREADABLE ${cli.reviewPath}`); return 1; }

  // ── 순수 판정 ────────────────────────────────────────────────────────────
  const d = auditDecision({ phase: cli.phase, dirtyEntries: dirty0, head,
    fingerprintNow: EV.specFingerprint(SPEC, sha256), candidate: b, review,
    captureNames: SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.captureName), sha256 });
  if (d.errors.length) {
    err(`AUDIT_REJECTED — total=${d.errors.length}`);
    for (const e of d.errors.slice(0, 20)) err(`  ${e}`);
    return 1;                                       // write 0
  }

  // ── write 직전 authority 재확인 ───────────────────────────────────────────
  {
    const a = promotionAuthority(repoDir, head.headCommit, head.blobs, null);
    if (!a.ok) {
      err(`AUTHORITY_FAILED — ${a.errors.join(' | ')}`);
      return 1;                                   // write 0
    }
  }
  // **새 bundle을 발행한다.** 기존 것은 불변이므로 in-place로 고치지 않는다.
  // pointer CAS: 검토한 그 bundle이 여전히 현재 pointer일 때만 교체된다.
  const wErrors = writeCandidate({ fixturesDir, phase: cli.phase, contextRaw: d.nextContextRaw,
    pngByCaptureName: b.pngByName, expectedCaptureNames: Object.keys(b.pngByName),
    expectedCurrentBundleName: d.expectedCurrentBundleName });
  if (wErrors.length) {
    err(`WRITE FAILED — total=${wErrors.length}`);
    for (const e of wErrors) err(`  ${e}`);
    return 1;
  }
  const after = readCandidateBundle(fixturesDir, cli.phase);
  if (after.errors.length) { err('READBACK_FAILED'); for (const e of after.errors) err(`  ${e}`); return 1; }
  log(`audit attached → ${cli.phase} bundle=${after.bundleName}`);
  log(`captures=${d.privacyAudit.captures.length} contextSubject=${d.privacyAudit.contextSubjectSha256.slice(0, 16)}`);
  return 0;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then((code) => process.exit(code));
