import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as SPEC from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Spec.mjs';
import * as EV from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Evaluator.mjs';
import * as CANON from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Canonicalize.mjs';
const REPO = '/Users/hyeonseongpark/Documents/GitHub/Weave';
const FRONT = `${REPO}/frontend`;
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
const declsOf = (src, rel) => EV.collectDeclarations(postcss.parse(compileScss(src, rel)), rel);
const die = (msg, arr) => {   // 총수를 함께 찍는다 — 잘린 20건을 총수로 오독한 전례가 있다
  const n = Array.isArray(arr) ? arr.length : 0;
  console.error(`${msg} — total=${n} shown=${Math.min(n, 20)}`, arr && arr.slice(0, 20));
  process.exit(1); };

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

const fingerprint = EV.specFingerprint(SPEC, sha);
// 6b) smoke trust chain — context 원문과 destination PNG **24개**의 실제 바이트로 계산
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
// 단일 승인 경로 — 개별 validator를 여기서 따로 부르지 않는다(배선 누락·부분 배선 차단).
// 승인·직렬화·쓰기는 단일 orchestration만 쓴다. validator는 주입하지 않는다 — 데이터와 순수 IO만
// 넘기고 순서(candidate → conformance → artifacts → serialize → write)는 함수 안에서 고정된다.
const pngOf = (name) => { const b = readFileSync(`${FIXDIR}/s4-shots/base/${name}`);
  return { bytes: b, width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
const approve = EV.approveAndWrite({
  fixture, spec: SPEC, contrastResults: pr.contrast.results,
  actualDecls: pr.projDecls, actualRaw: pr.projSrc, preAnnSources: pr.preAnnSrc,
  actualAllowIdToKey: pr.attribution.allowIdToKey, baseDecls: pr.baseDecls,
  contextRaw: ctxRaw.toString('utf8'), sha256: sha, readPng: pngOf,
  serialize: EV.serializeFixture,
  write: (bytes) => { mkdirSync(FIXDIR, { recursive: true });
    writeFileSync(`${FIXDIR}/s4-expected.json`, bytes); },
});
if (approve.errors.length) die('APPROVE', approve.errors);
const json = approve.bytes;
console.log(`conversions=${SPEC.CONVERSIONS.length} changed=${fixture.counts.changed} new=${fixture.counts.new}/${fixture.counts.newRules}rules ` +
  `residual=${fixture.counts.residual} raw=${fixture.counts.raw} processed=${fixture.counts.processed} allowBearing=${fixture.counts.allowBearing} errors=0`);
console.log('contrast=' + fixture.contrast.map((c) => `${c.ratio}`).join('/'));
console.log('fingerprint=' + fingerprint);
console.log('sha256=' + sha(json));
