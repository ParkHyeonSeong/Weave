import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as SPEC from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Spec.mjs';
import * as EV from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Evaluator.mjs';
const REPO = '/Users/hyeonseongpark/Documents/GitHub/Weave';
// 인자는 정확히 두 형태만 허용한다. 알 수 없는 옵션·여분 positional을 무시하면
// `--chek 4` 같은 오타가 조용히 **쓰기 모드**로 떨어진다(검사하려다 파일을 덮어씀).
const args = process.argv.slice(2);
const USAGE = 'usage: node s4-apply.mjs [--check] <3|4|5>';
let check = false, stageArg = null;
if (args.length === 1) stageArg = args[0];
else if (args.length === 2 && args[0] === '--check') { check = true; stageArg = args[1]; }
else { console.error(USAGE, '| got:', JSON.stringify(args)); process.exit(2); }
if (!['3', '4', '5'].includes(stageArg)) { console.error(USAGE, '| bad stage:', stageArg); process.exit(2); }
const stage = Number(stageArg);

// 3파일을 모두 투영·검증한 뒤에야 write phase로 넘어간다. 파일별로 즉시 쓰면 두 번째 파일에서
// 실패했을 때 첫 파일만 적용된 부분 상태가 남는다. 쓰기 중 실패하면 원본으로 되돌린다.
const plan = [];
for (const k of Object.keys(SPEC.FILES)) {
  const { rel, blob } = SPEC.FILES[k];
  const h = execSync(`git -C ${REPO} rev-parse ${SPEC.BASE}:frontend/${rel}`, { encoding: 'utf8' }).trim();
  if (h !== blob) { console.error(`BLOB_MISMATCH ${rel}`); process.exit(1); }
  const baseSrc = execSync(`git -C ${REPO} show ${SPEC.BASE}:frontend/${rel}`, { encoding: 'utf8' });
  const conv = SPEC.CONVERSIONS.filter((c) => c.f === k && c.stage <= stage);
  const anns = stage >= 4 ? SPEC.ANNOTATIONS : [];
  const ovr = stage === 5 ? (SPEC.OVERRIDES[k] || '') : '';
  const { projected, errors } = EV.projectSource(baseSrc, conv, anns, ovr, k);
  if (errors.length) { console.error('PROJECT_ERRORS', rel, errors); process.exit(1); }
  plan.push({ k, rel, projected, nConv: conv.length, nAnn: anns.filter((a) => a.f === k).length, ovr });
}

if (check) {
  let drift = 0;
  for (const p of plan) {
    const actual = readFileSync(`${REPO}/frontend/${p.rel}`, 'utf8');
    if (actual !== p.projected) {
      const a = actual.split('\n'), b = p.projected.split('\n');
      const bad = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) bad.push(i + 1);
      console.error(`STAGE_DRIFT ${p.rel} stage=${stage} lines=${bad.slice(0, 10).join(',')}${bad.length > 10 ? '…' : ''} (총 ${bad.length}줄)`);
      drift++;
    } else console.log(`${p.rel}: EXACT (stage ${stage})`);
  }
  process.exit(drift ? 1 : 0);
}
// write phase — 전 파일 원본을 먼저 읽어두고, 실패 시 되돌린다.
const backup = plan.map((p) => ({ rel: p.rel, prev: readFileSync(`${REPO}/frontend/${p.rel}`, 'utf8') }));
try {
  for (const p of plan) writeFileSync(`${REPO}/frontend/${p.rel}`, p.projected);
} catch (e) {
  const failed = [];
  for (const b of backup) { try { writeFileSync(`${REPO}/frontend/${b.rel}`, b.prev); } catch (_) { failed.push(b.rel); } }
  console.error('WRITE_FAILED:', e && e.message);
  if (failed.length) console.error(`ROLLBACK_FAILED — 원본 복원 실패(수동 확인 필요): ${failed.join(', ')}`);
  else console.error('ROLLBACK_OK — 3파일 모두 원본 복원됨');
  process.exit(1);
}
// 모든 write가 끝난 뒤에만 성공 로그를 낸다(부분 성공을 성공처럼 보이지 않게).
for (const p of plan) console.log(`${p.rel}: conversions=${p.nConv} annotations=${p.nAnn} override=${p.ovr ? 'yes' : 'no'}`);
