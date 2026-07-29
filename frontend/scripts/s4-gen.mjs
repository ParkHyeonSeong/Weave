import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as SPEC from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Spec.mjs';
import * as EV from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Evaluator.mjs';
import * as CANON from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Canonicalize.mjs';
const REPO = '/Users/hyeonseongpark/Documents/GitHub/Weave';
const FRONT = `${REPO}/frontend`;
const require = createRequire(`${FRONT}/package.json`);
const sass = require('sass'); const postcss = require('postcss');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const gitShow = (ref, rel) => execSync(`git -C ${REPO} show ${ref}:frontend/${rel}`, { encoding: 'utf8' });
const compileScss = (src) => { const tmp = `/tmp/_s4_${sha(src).slice(0, 12)}.scss`;
  writeFileSync(tmp, src.replace(/'\.\.\/\.\.\/variables'/g, "'variables'").replace(/'\.\.\/variables'/g, "'variables'"));
  return sass.compile(tmp, { loadPaths: [`${FRONT}/styles`] }).css; };
const declsOf = (src, rel) => EV.collectDeclarations(postcss.parse(compileScss(src)), rel);
const die = (msg, arr) => { console.error(msg, arr && arr.slice(0, 20)); process.exit(1); };

// 1) blob 검증
for (const k of Object.keys(SPEC.FILES)) { const { rel, blob } = SPEC.FILES[k];
  const h = execSync(`git -C ${REPO} rev-parse ${SPEC.BASE}:frontend/${rel}`, { encoding: 'utf8' }).trim();
  if (h !== blob) die(`BLOB_MISMATCH ${rel} ${h}`); }
// 2) 테마 값 맵(라이트/다크)
const themeRoot = postcss.parse(sass.compile(`${FRONT}/styles/_themes.scss`).css);
const rootVals = {}, darkBlock = {};
themeRoot.walkRules((r) => { if (r.selector === ':root') r.walkDecls(/^--/, (d) => { if (!(d.prop in rootVals)) rootVals[d.prop] = d.value; });
  if (EV.isDarkSelector(r.selector)) r.walkDecls(/^--/, (d) => { darkBlock[d.prop] = d.value; }); });
const lightVals = rootVals; const darkVals = { ...rootVals, ...darkBlock };
// 3) 단일 evaluator 경로(검수 §4) — projection·solo attribution·identity·annotation·dark·selector·contrast 일괄
const baseSources = Object.fromEntries(Object.keys(SPEC.FILES).map((k) => [k, gitShow(SPEC.BASE, SPEC.FILES[k].rel)]));
const io = { compileDecls: (src, rel) => declsOf(src, rel), lightVals, darkVals };
const pr = EV.evaluateProjection(SPEC, baseSources, io);
if (pr.errors.length) die('EVALUATE_PROJECTION', pr.errors);
// 4) 참고치 드리프트 게이트
const REFERENCE = { 'SourcePicker BranchKey normal': 6.184, 'SourcePicker BranchKey hover': 5.513,
  'TrackTree GroupKey normal': 6.607, 'TrackTree GroupKey hover': 6.883,
  'CreateTrack BranchKey normal': 6.031, 'CreateTrack BranchKey hover': 5.810,
  'ManageBranches BranchKey normal': 6.031, 'ManageBranches BranchKey hover': 4.792 };
const drift = pr.contrast.results.filter((r) => REFERENCE[r.name] !== undefined && Math.abs(r.ratio - REFERENCE[r.name]) > 0.3)
  .map((r) => `${r.name} ${r.ratio} vs ${REFERENCE[r.name]}`);
if (drift.length) die('CONTRAST_REFERENCE_DRIFT', drift);
const fingerprint = EV.specFingerprint(SPEC, sha);
// 6b) smoke trust chain — context 원문과 destination PNG 23개의 **실제 바이트**로 계산(검수 §1)
const FIXDIR = `${FRONT}/library/__fixtures__`;
const ctxRaw = readFileSync(`${FIXDIR}/s4-smoke-context.json`);
const captures = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => {
  const buf = readFileSync(`${FIXDIR}/s4-shots/base/${x.captureName}`);   // 없으면 여기서 throw → fail-closed
  return { captureName: x.captureName, sha256: sha(buf) };
});
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
const { fixture, errors: fxErrors } = EV.buildFixture({ base: SPEC.BASE, blobs: SPEC.FILES, baseDecls: pr.baseDecls,
  projectedDecls: pr.projDecls, conversions: SPEC.CONVERSIONS, attribution: pr.attribution, contrast: pr.contrast, fingerprint, smoke });
if (fxErrors.length) die('BUILD_FIXTURE', fxErrors);
const cntErrors = EV.validateCounts(fixture, SPEC.COUNTS);
if (cntErrors.length) die('COUNTS', cntErrors);
// 검수 §3: 실제 fixture로 coverage 재검사(changed:[] 우회 폐기). 미매핑이 있으면 목록을 출력하고 중단 —
// 미매핑이 남으면 플랜 오류다 — 여기서 manifest를 새로 설계하지 말고 중단·보고한다(Task 2 Step 3과 동일 계약).
const covErrors = EV.validateSmokeCoverage(fixture, SPEC.REQUIRED_SMOKE_SURFACES);
if (covErrors.length) die('SMOKE_COVERAGE', covErrors);
// fixture 쓰기 전 clean baseline 강제(검수 §5) — 여기서 비어있지 않으면 결함이 동결된다
const cleanErrors = EV.evaluateConformance(pr.projDecls, pr.projSrc, pr.preAnnSrc, SPEC, fixture, pr.attribution.allowIdToKey);
if (cleanErrors.length) die('CLEAN_CONFORMANCE', cleanErrors);
const json = EV.serializeFixture(fixture);   // 해시·비교 전부 이 직렬화를 쓴다
mkdirSync(`${FRONT}/library/__fixtures__`, { recursive: true });
writeFileSync(`${FRONT}/library/__fixtures__/s4-expected.json`, json);
console.log(`conversions=${SPEC.CONVERSIONS.length} changed=${fixture.counts.changed} new=${fixture.counts.new}/${fixture.counts.newRules}rules ` +
  `residual=${fixture.counts.residual} raw=${fixture.counts.raw} processed=${fixture.counts.processed} allowBearing=${fixture.counts.allowBearing} errors=0`);
console.log('contrast=' + fixture.contrast.map((c) => `${c.ratio}`).join('/'));
console.log('fingerprint=' + fingerprint);
console.log('sha256=' + sha(json));
