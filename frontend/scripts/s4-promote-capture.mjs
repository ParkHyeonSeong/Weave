// frontend/scripts/s4-promote-capture.mjs
// **커밋된 승격 명령.** candidate → committed release 로 가는 유일한 실행 경로.
//
// 이 파일이 없으면 promoteRelease는 테스트에서만 불리는 함수이고, 실제 산출물은
// 여전히 수동 복사로 committed가 된다 — 승격 계약이 무의미해진다.
//
//   node scripts/s4-promote-capture.mjs      (light+dark를 한 트랜잭션으로)
//
// 계약:
//  - 검증기도 승인 함수도 주입하지 않는다. 승격 모듈이 내부에서 구체 구현을 부른다.
//  - authority 입력(모듈 목록·startHead·pinned blobs)도 넘기지 않는다 — 승격이 파생한다.
//  - projection은 **s4Projection 공유 모듈**을 쓴다(생성기와 같은 구현, 복제 없음).
//  - expected fixture의 smoke는 **candidate bundle의 실제 바이트**에서 만든다.
//  - Git blob resolver를 넘기지 않는다 — 승격 모듈이 스스로 해석한다.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as RAW_SPEC from '../library/s4Spec.mjs';
import * as EV from '../library/s4Evaluator.mjs';
import * as CANON from '../library/s4Canonicalize.mjs';
import * as PROJ from '../library/s4Projection.mjs';
import { readCandidateBundle } from '../library/s4CaptureRunner.mjs';
import { promoteRelease, approveForPromotion, headBlobBinding, readRelease,
  readPinnedGitFile } from '../library/s4Promote.mjs';
import { HASHED_MODULES, REPO_DIR, worktreeDirtyEntries } from './s4-capture.mjs';

// 인자가 없다. **두 phase를 함께** 승격하는 것이 유일한 동작이다 —
// 한쪽만 승격하면 dataset 쌍 검증이 이미 committed된 산출물을 뒤늦게 보게 된다.
export function parsePromoteArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) return { error: `UNEXPECTED_ARGS ${argv && argv.join(' ')}` };
  return {};
}

export async function main(argv, { log = console.log, err = console.error } = {}) {
  const cli = parsePromoteArgs(argv);
  if (cli.error) { err(`usage: node scripts/s4-promote-capture.mjs\n  ${cli.error}`); return 2; }

  const snap = EV.snapshotSpec(RAW_SPEC);
  if (snap.errors.length) {
    err(`SPEC_NOT_PLAIN — total=${snap.errors.length}`);
    for (const e of snap.errors.slice(0, 10)) err(`  ${e}`);
    return 1;
  }
  const SPEC = snap.spec;
  const sha256 = (v) => createHash('sha256').update(v).digest('hex');

  // 승격은 정본을 만든다 — 워킹트리 전체가 clean일 때만 시작한다.
  const dirty = worktreeDirtyEntries(REPO_DIR);
  if (dirty.length) {
    err(`REPO_DIRTY — total=${dirty.length}`);
    for (const e of dirty.slice(0, 20)) err(`  ${e}`);
    return 1;
  }
  const head = headBlobBinding(REPO_DIR, HASHED_MODULES);
  if (head.errors.length) {
    err(`HEAD_BINDING_FAILED — total=${head.errors.length}`);
    for (const e of head.errors) err(`  ${e}`);
    return 1;
  }

  const fixturesDir = fileURLToPath(new URL('../library/__fixtures__/', import.meta.url));
  const FRONT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
  const REPO = fileURLToPath(new URL('../../', import.meta.url));

  // candidate 두 phase를 먼저 읽는다. 없으면 승격할 것이 없다.
  const cands = {};
  for (const phase of ['light', 'dark']) {
    const c = readCandidateBundle(fixturesDir, phase);
    if (c.errors.length) {
      err(`CANDIDATE_UNREADABLE ${phase}`);
      for (const e of c.errors) err(`  ${e}`);
      return 1;
    }
    cands[phase] = c;
  }

  // ── projector 경로(생성기와 동일 구현) ────────────────────────────────────
  const require = createRequire(`${FRONT}/package.json`);
  const sass = require('sass'); const postcss = require('postcss');
  // BASE 소스는 s4-gen과 **같은 pinned reader**로 읽는다 — 환경 상속도, 구현 분기도 없다.
  const BLOB_BY_REL = new Map(Object.values(SPEC.FILES).map((f) => [f.rel, f.blob]));
  let pinnedError = null;
  const gitShow = (ref, rel) => {
    const r = readPinnedGitFile(REPO_DIR, ref, rel, BLOB_BY_REL.get(rel));
    if (r.errors.length) { pinnedError = `PINNED_SOURCE ${rel}: ${r.errors.join(' | ')}`; throw new Error(pinnedError); }
    return r.bytes;
  };
  const compileScss = (src, rel) => sass.compileString(src,
    { loadPaths: [`${FRONT}/styles`, FRONT], url: new URL(`file://${FRONT}/${rel}`) }).css;
  const { pr } = PROJ.buildProjection({ spec: SPEC, gitShow, compileScss, frontDir: FRONT, sass, postcss });
  if (pr.errors.length) {
    err(`PROJECTION_FAILED — total=${pr.errors.length}`);
    for (const e of pr.errors.slice(0, 20)) err(`  ${e}`);
    return 1;
  }

  // smoke는 **candidate bundle의 실제 바이트**에서 만든다 — committed 산출물이 아니라
  // 지금 승격하려는 것이 근거여야 한다. privacy audit도 그 context에서 나온다.
  const lightRaw = cands.light.contextRaw;
  const captures = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => ({
    captureName: x.captureName,
    sha256: sha256(cands.light.pngByName[x.captureName] || Buffer.alloc(0)) }));
  let lightCtx = null;
  try { lightCtx = JSON.parse(lightRaw); } catch (e) { err('CANDIDATE_CONTEXT_UNPARSEABLE light'); return 1; }
  const { privacyAudit, ...ctxSubject } = lightCtx;
  const auditErrors = EV.validatePrivacyAudit(privacyAudit,
    { captures, contextSubjectSha256: sha256(JSON.stringify(CANON.canonicalize(ctxSubject))) });
  if (auditErrors.length) {
    err(`PRIVACY_AUDIT — total=${auditErrors.length}`);
    for (const e of auditErrors.slice(0, 20)) err(`  ${e}`);
    return 1;
  }
  const smoke = { contextSha256: sha256(lightRaw), captures };

  const fingerprint = EV.specFingerprint(SPEC, sha256);
  const { fixture, errors: fxErrors } = PROJ.buildProjectedFixture({ spec: SPEC, pr, fingerprint, smoke });
  if (fxErrors.length) {
    err(`BUILD_FIXTURE — total=${fxErrors.length}`);
    for (const e of fxErrors.slice(0, 20)) err(`  ${e}`);
    return 1;
  }

  // discovery evidence는 **바이트만** 넘긴다. resolver는 승격 모듈이 스스로 만든다.
  const evidenceDir = fileURLToPath(new URL('../library/__fixtures__/s4-discovery-evidence/', import.meta.url));
  const files = {};
  for (const n of EV.DISCOVERY_EVIDENCE_FILES) {
    try { files[n] = readFileSync(`${evidenceDir}${n}`, 'utf8'); }
    catch (e) { err(`DISCOVERY_EVIDENCE_UNREADABLE ${n}`); return 1; }
  }

  // **기존 공용 승인 경로**를 그대로 돈다 — candidate→conformance→artifacts→evidence를
  // 전부 통과한 bytes만 canonical expectedBytes가 된다. writer는 메모리에만 남긴다.
  let expectedBytes = null;
  const approve = approveForPromotion({
    repoDir: REPO_DIR, evidenceFiles: files,
    fixture, spec: SPEC, contrastResults: pr.contrast.results,
    actualDecls: pr.projDecls, actualRaw: pr.projSrc, preAnnSources: pr.preAnnSrc,
    actualAllowIdToKey: pr.attribution.allowIdToKey, baseDecls: pr.baseDecls,
    contextRaw: lightRaw, sha256, readPng: (n) => {
      const b = cands.light.pngByName[n];
      return b ? { bytes: b, width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : { bytes: Buffer.alloc(0) };
    },
    provenanceRefs: { headCommit: head.headCommit, headBlobs: head.blobs, specFingerprintNow: fingerprint },
    serialize: EV.serializeFixture, write: (bytes) => { expectedBytes = bytes; },
  });
  if (approve.errors.length) {
    err(`APPROVAL FAILED — total=${approve.errors.length}`);
    for (const e of approve.errors.slice(0, 20)) err(`  ${e}`);
    return 1;
  }
  if (typeof expectedBytes !== 'string') { err('APPROVAL_NO_BYTES'); return 1; }

  // CAS 기준: **검증 전에** 읽은 포인터. 검증 도중 누가 승격했으면 lock 안에서 어긋난다.
  const fromRelease = readRelease(fixturesDir);
  // authority postflight는 **승격 모듈 내부**에 있다 — 콜백을 넘기지 않는다.
  const r = promoteRelease({
    fixturesDir, spec: SPEC,                    // 최초 snapshot만 넘긴다(RAW_SPEC 재전달 0)
    provenanceRefs: { headCommit: head.headCommit, headBlobs: head.blobs, specFingerprintNow: fingerprint },
    fromRelease, expectedBytes,                 // fixture를 따로 넘기지 않는다 — bytes가 정본이다
    candidates: cands,                          // CLI가 읽어 고정한 snapshot
    discoveryEvidence: { files }, repoDir: REPO_DIR,
    // hashedModules·startHead는 넘기지 않는다 — 승격이 자기 authority 입력을 스스로 파생한다.
  });
  if (r.errors.length) {
    err(`PROMOTE FAILED — total=${r.errors.length}`);
    for (const e of r.errors.slice(0, 20)) err(`  ${e}`);
    return 1;                                       // 어느 phase도 committed가 되지 않는다
  }
  log(`promoted pair light=${String(r.release.light).slice(0, 12)} dark=${String(r.release.dark).slice(0, 12)}`);
  log(`expected=${String(r.release.expectedSha).slice(0, 16)} dataset=${String(r.datasetDigest).slice(0, 16)}`);
  return 0;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then((code) => process.exit(code));
