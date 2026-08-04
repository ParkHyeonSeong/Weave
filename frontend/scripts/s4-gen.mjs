import { createRequire } from 'node:module';
import { execSync, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import * as PROMOTE_IO from '../library/s4Promote.mjs';
import { HASHED_MODULES, GENERATOR_HASHED_MODULES, REPO_DIR, worktreeDirtyEntries } from './s4-capture.mjs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as RAW_SPEC from '../library/s4Spec.mjs';
import * as EV from '../library/s4Evaluator.mjs';
import * as CANON from '../library/s4Canonicalize.mjs';
import * as PROJ from '../library/s4Projection.mjs';
// 무거운 작업(Sass 컴파일·fixture 읽기) **전에** 인자 문법을 강제한다.
const CLI = PROMOTE_IO.parseCliArgs(process.argv.slice(2));
if (CLI.error) { console.error(`${PROMOTE_IO.CLI_USAGE}\n  ${CLI.error}`); process.exit(2); }
// 승격 하드 비활성은 **CLI 파싱 직후** 본다. 뒤에 두면 bundle 부재 같은 다른 오류가 먼저 나와
// "CLI에서 즉시 막힌다"는 말이 사실이 아니게 된다(실증: CAPTURE_BUNDLE_MISSING이 먼저 났다).

// spec은 **여기서 한 번** 스냅샷하고, 이후 raw 네임스페이스에는 접근하지 않는다.
// 단계마다 다시 읽으면 조회할 때마다 값이 달라지는 루트에서 해시된 것과 소비되는 것이 갈린다.
const __snap = EV.snapshotSpec(RAW_SPEC);
if (__snap.errors.length) {
  console.error(`SPEC_NOT_PLAIN — total=${__snap.errors.length}`, __snap.errors.slice(0, 20));
  process.exit(1);
}
const SPEC = __snap.spec;

// 절대경로 고정은 다른 checkout/CI에서 **다른 레포**를 읽게 한다. 파일 위치에서 파생한다.
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const FRONT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${FRONT}/package.json`);
const sass = require('sass'); const postcss = require('postcss');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const gitShow = (ref, rel) => execSync(`git -C ${REPO} show ${ref}:frontend/${rel}`, { encoding: 'utf8' });
// 임시 파일을 쓰지 않는다 — 예측 가능한 /tmp 경로에 O_EXCL 없이 write하면 미리 심어둔
// 심볼릭 링크로 임의 파일이 덮어써진다(리뷰 실증). compileString + loadPaths로 충분하다.
// 실제 파일 URL을 주면 상대 @use가 그대로 해석되어 import 문자열 정규식이 필요 없고,
// 오류 위치도 실제 파일 기준으로 보존된다.
const compileScss = (src, rel) => sass.compileString(src,
  { syntax: 'scss', url: pathToFileURL(`${FRONT}/${rel}`), loadPaths: [`${FRONT}/styles`] }).css;
const die = (msg, arr) => {   // 총수를 함께 찍는다 — 잘린 20건을 총수로 오독한 전례가 있다
  const n = Array.isArray(arr) ? arr.length : 0;
  console.error(`${msg} — total=${n} shown=${Math.min(n, 20)}`, arr && arr.slice(0, 20));
  process.exit(1); };

// 1) blob 검증
for (const k of Object.keys(SPEC.FILES)) { const { rel, blob } = SPEC.FILES[k];
  const h = execSync(`git -C ${REPO} rev-parse ${SPEC.BASE}:frontend/${rel}`, { encoding: 'utf8' }).trim();
  if (h !== blob) die(`BLOB_MISMATCH ${rel} ${h}`); }
// 2) 테마 값 맵(라이트/다크) — **공유 projector 모듈**이 만든다(승격 경로와 같은 구현).
// 3) 단일 evaluator 경로(검수 §4) — projection·solo attribution·identity·annotation·dark·selector·contrast 일괄
// ── generator authority ────────────────────────────────────────────────────
// **discovery provenance 9파일과 다른 것이다.** 저기는 "그때 관찰한 코드", 여기는
// "지금 fixture를 만드는 코드"다. s4-gen.mjs 자신을 포함한 정적 import closure를 잠근다.
const gitExecPlain = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const requireCleanRepo = (where) => {
  const dirty = worktreeDirtyEntries(REPO, gitExecPlain);
  if (dirty.length) die(`REPO_DIRTY_${where} — total=${dirty.length}`, dirty.slice(0, 20));
};
requireCleanRepo('AT_START');
{
  const g = PROMOTE_IO.headBlobBinding(REPO_DIR, GENERATOR_HASHED_MODULES, gitExecPlain);
  if (g.errors.length) die('GENERATOR_HEAD_BINDING_FAILED', g.errors);
}

// ── discovery 증거 preflight ────────────────────────────────────────────────
// **projection보다 먼저.** 커밋된 Run A/B 원문이 현재 manifest와 맞지 않으면 아무것도 만들지
// 않는다. approveAndWrite에도 같은 게이트가 있어 write 0회가 행동으로 강제된다 —
// 여기 것은 "일찍 죽어 낭비를 줄이는" 이중 확인이다.
const EVIDENCE_DIR = fileURLToPath(new URL('../library/__fixtures__/s4-discovery-evidence/', import.meta.url));
// **문자열 보간 금지.** 이전 판은 `git ... ${ref}:${rel}`를 shell에 넘겼다 — rel에
// metacharacter가 섞이면 그대로 실행된다. argv 배열로 넘기고, 부르기 전에 두 인자를 검증한다.
//   ref: 40 lowercase hex   rel: PROVENANCE_BLOB_PATHS 멤버
const GIT_REF_RX = /^[0-9a-f]{40}$/;
const CANON_PATHS = new Set(SPEC.PROVENANCE_BLOB_PATHS || []);
const gitBlobOid = (ref, rel) => {
  if (!GIT_REF_RX.test(String(ref))) return null;
  if (!CANON_PATHS.has(String(rel))) return null;
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', `${ref}:${rel}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { return null; }
};
const DISCOVERY_EVIDENCE = (() => {
  const files = {};
  for (const n of EV.DISCOVERY_EVIDENCE_FILES) {
    try { files[n] = readFileSync(`${EVIDENCE_DIR}${n}`, 'utf8'); }
    catch (e) { die('DISCOVERY_EVIDENCE_UNREADABLE', [`${n}: ${e && e.message}`]); }
  }
  return { files, gitBlob: gitBlobOid };
})();
{
  const errs = EV.verifyDiscoveryEvidence({ files: DISCOVERY_EVIDENCE.files, spec: SPEC,
    scenario: EV.buildActionContext(SPEC.SCENARIO_CANON || {}), sha256Hex: sha, gitBlob: gitBlobOid });
  if (errs.length) die('DISCOVERY_EVIDENCE_FAILED', errs);
}

const { pr } = PROJ.buildProjection({ spec: SPEC, gitShow, compileScss, frontDir: FRONT, sass, postcss });
if (pr.errors.length) die('EVALUATE_PROJECTION', pr.errors);
// 4) 참고치 드리프트 게이트

const fingerprint = EV.specFingerprint(SPEC, sha);
// provenance 대조 기준을 **지금** 계산한다. 생략하면 승인이 provenance의 존재만 보게 된다.
const HEAD = PROMOTE_IO.headBlobBinding(REPO_DIR, HASHED_MODULES,
  (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
if (HEAD.errors.length) die('HEAD_BINDING', HEAD.errors);
const PROVENANCE_REFS = { headCommit: HEAD.headCommit, headBlobs: HEAD.blobs, specFingerprintNow: fingerprint };
// 6b) smoke trust chain — context 원문과 destination PNG(legacy committed 24개, 현재 target 23)의 실제 바이트로 계산
const FIXDIR = `${FRONT}/library/__fixtures__`;
// **승격된 bundle이 유일한 입력이다.** legacy 경로(s4-smoke-context.json / s4-shots/base)를
// 읽으면 승격 절차를 우회한 수동 복사본이 그대로 fixture가 된다 — 승격 경로가 무의미해진다.
const BUNDLE = PROMOTE_IO.readCaptureBundle(FIXDIR, 'light');
if (BUNDLE.errors.length) die('CAPTURE_BUNDLE', BUNDLE.errors);
const ctxRaw = Buffer.from(BUNDLE.contextRaw, 'utf8');
const bundlePng = (name) => {
  const b = BUNDLE.pngByName[name];
  if (!b) throw new Error(`BUNDLE_PNG_MISSING ${name}`);
  return b;
};
const captures = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => ({ captureName: x.captureName, sha256: sha(bundlePng(x.captureName)) }));
if (captures.length !== SPEC.REQUIRED_SMOKE_SURFACES.length) die('SMOKE_CAPTURE_COUNT', [String(captures.length)]);
// privacy audit을 **fixture 기록 전에** 강제한다(공용 helper 사용 — 상설 테스트와 동일 경로)
// captures(이름+실제 PNG 바이트 해시)는 위에서 이미 계산됐다 — 그 값을 그대로 audit 대조에 쓴다.
const ctxJson = JSON.parse(ctxRaw);
const { privacyAudit, ...ctxSubject } = ctxJson;                     // audit 자신은 subject에서 제외
const contextSubjectSha256 = sha(JSON.stringify(CANON.canonicalize(ctxSubject)));
const auditErrors = EV.validatePrivacyAudit(privacyAudit, { captures, contextSubjectSha256 });
if (auditErrors.length) die('PRIVACY_AUDIT', auditErrors);
const smoke = { contextSha256: sha(ctxRaw), captures };

// 7) fixture
const { fixture, errors: fxErrors } = PROJ.buildProjectedFixture({ spec: SPEC, pr, fingerprint, smoke });
if (fxErrors.length) die('BUILD_FIXTURE', fxErrors);
// 단일 승인 경로 — 개별 validator를 여기서 따로 부르지 않는다(배선 누락·부분 배선 차단).
// 승인·직렬화·쓰기는 단일 orchestration만 쓴다. validator는 주입하지 않는다 — 데이터와 순수 IO만
// 넘기고 순서(candidate → conformance → artifacts → serialize → write)는 함수 안에서 고정된다.
const pngOf = (name) => { const b = bundlePng(name);
  return { bytes: b, width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
// **s4-gen에는 승격이 없다.** projection 진단과 candidate expected 산출까지만 한다 —
// committed를 바꾸는 유일한 sink는 s4-promote-capture → promoteRelease 하나다.
const contextRawStr = ctxRaw.toString('utf8');

// 승인 경로는 한 번만 정의한다. writer만 바꿔 끼운다 — 승격도 같은 검증을 통과한 bytes만 쓴다.
let canonicalBytes = null;
const runApproval = (write) => {
  // serialize/write **직전**에 다시 본다 — 그 사이에 워킹트리가 바뀌면 산출물의 출처가 흔들린다.
  requireCleanRepo('BEFORE_WRITE');
  return EV.approveAndWrite({
  fixture, spec: SPEC, contrastResults: pr.contrast.results,
  actualDecls: pr.projDecls, actualRaw: pr.projSrc, preAnnSources: pr.preAnnSrc,
  actualAllowIdToKey: pr.attribution.allowIdToKey, baseDecls: pr.baseDecls,
  contextRaw: contextRawStr, sha256: sha, readPng: pngOf,
  provenanceRefs: PROVENANCE_REFS,        // 계산해 놓고 안 넘기면 승인이 provenance를 못 본다
  discoveryEvidence: DISCOVERY_EVIDENCE,  // 없으면 승인 자체가 성립하지 않는다(write 0회)
  serialize: EV.serializeFixture, write,
  });
};


// **committed를 쓰지 않는다.** 승인 bytes를 진단용 candidate 파일로만 남긴다.
let candidatePath = null;
const approve = runApproval((bytes) => {
  mkdirSync(FIXDIR, { recursive: true });
  candidatePath = `${FIXDIR}/${PROMOTE_IO.STAGING_NAME}`;
  writeFileSync(candidatePath, bytes);
});
if (approve.errors.length) die('APPROVE', approve.errors);
const json = approve.bytes;
console.log(`candidate expected → ${candidatePath}`);
console.log('승격: node scripts/s4-promote-capture.mjs  (공식 sink는 이것 하나다)');
console.log(`conversions=${SPEC.CONVERSIONS.length} changed=${fixture.counts.changed} new=${fixture.counts.new}/${fixture.counts.newRules}rules ` +
  `residual=${fixture.counts.residual} raw=${fixture.counts.raw} processed=${fixture.counts.processed} allowBearing=${fixture.counts.allowBearing} errors=0`);
console.log('contrast=' + fixture.contrast.map((c) => `${c.ratio}`).join('/'));
console.log('fingerprint=' + fingerprint);
console.log('sha256=' + sha(json));
