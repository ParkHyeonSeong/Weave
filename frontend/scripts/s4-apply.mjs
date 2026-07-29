import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as SPEC from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Spec.mjs';
import * as EV from '/Users/hyeonseongpark/Documents/GitHub/Weave/frontend/library/s4Evaluator.mjs';
const REPO = '/Users/hyeonseongpark/Documents/GitHub/Weave';
const stage = Number(process.argv[2]);
if (![3, 4, 5].includes(stage)) { console.error('usage: node s4-apply.mjs <3|4|5>'); process.exit(1); }
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
  writeFileSync(`${REPO}/frontend/${rel}`, projected);
  console.log(`${rel}: conversions=${conv.length} annotations=${anns.filter((a) => a.f === k).length} override=${ovr ? 'yes' : 'no'}`);
}
