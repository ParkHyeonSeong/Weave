// ── 검수 §3: 다크 selector exact
export const DARK_PREFIX = 'html[data-theme=dark]';
export function isDarkSelector(sel) {   // comma branch 전부가 정확히 dark prefix여야 true
  const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => p === DARK_PREFIX || p.startsWith(DARK_PREFIX + ' '));
}
export function hasDataTheme(sel) { return /\[data-theme/.test(String(sel)); }
export function validateDarkStructure(decls, filesRel, darkCounts) {
  const e = [];
  for (const rel of filesRel) {
    const f = decls.filter((d) => d.file === rel);
    const dark = f.filter((d) => isDarkSelector(d.selector));
    const themed = f.filter((d) => hasDataTheme(d.selector));
    if (themed.length !== dark.length) e.push(`DARK_FOREIGN_SELECTOR ${rel}`);      // darkish/light/부분 prefix 차단
    if (dark.length !== darkCounts[rel]) e.push(`DARK_COUNT ${rel} ${dark.length}!=${darkCounts[rel]}`); // 0개·누락도 RED
    if (!dark.length) continue;
    if (dark.some((d) => d.atRules.length)) e.push(`DARK_ATRULE ${rel}`);
    if (dark.some((d) => d.important)) e.push(`DARK_IMPORTANT ${rel}`);
    const idx = dark.map((d) => f.indexOf(d));
    if (idx[idx.length - 1] !== f.length - 1 || idx.some((v, i) => i && v !== idx[i - 1] + 1)) e.push(`DARK_NOT_SUFFIX ${rel}`);
  }
  return e;
}
export function extractResidual(decls) {   // 동일 helper 사용 — light/darkish는 residual에 포함(누락 차단)
  const out = [];
  for (const d of decls) { if (isDarkSelector(d.selector)) continue;
    extractColorLiterals(d.value).forEach((literal, literalIndex) => out.push({ file: d.file, atRules: d.atRules,
      selector: d.selector, property: d.property, declarationOccurrence: d.declarationOccurrence,
      literalIndex, literal, important: d.important, sourceOrder: d.sourceOrder })); }
  return out;
}
// ── 주석은 컴파일에서 소멸 → 최종 raw SCSS에서 marker + anchor occurrence까지 고정(검수 §6)
export function validateAnnotations(rawByFileKey, preAnnByFileKey, annotations, files) {
  // preAnnByFileKey = conversion 적용 후·annotation 삽입 전 소스(검수 §1: BASE 기준이면 T1830 변환 때문에 false-RED)
  const errors = [];
  const markers = annotations.map((a) => a.marker);
  if (new Set(markers).size !== markers.length) errors.push('ANN_MARKER_DUP');
  for (const a of annotations) {
    for (const k of Object.keys(files)) {
      const src = rawByFileKey[k];
      if (src === undefined) { errors.push(`ANN_SRC_MISSING ${k}`); continue; }
      const hits = src.split(a.marker).length - 1;
      if (k !== a.f) { if (hits > 0) errors.push(`ANN_FOREIGN ${a.marker} in ${k}`); continue; }
      if (hits !== 1) { errors.push(`ANN_COUNT ${a.marker} n=${hits}`); continue; }
      const lines = src.split('\n');
      const i = lines.findIndex((L2) => L2.includes(a.marker));
      if (lines[i] !== a.text) { errors.push(`ANN_TEXT ${a.marker}`); continue; }
      const nextIdx = lines.findIndex((L2, j) => j > i && L2.trim() !== '');
      const pre = (preAnnByFileKey[a.f] || '').split('\n');
      const anchorLine = pre[a.l - 1];
      if (nextIdx < 0 || anchorLine === undefined || lines[nextIdx] !== anchorLine) { errors.push(`ANN_ANCHOR ${a.marker}`); continue; }
      // occurrence identity: 동일 anchor 줄이 여러 개일 때 몇 번째인지까지 고정(주석 줄은 anchor와 같지 않아 카운트에 영향 없음)
      const expectedOcc = pre.slice(0, a.l - 1).filter((L2) => L2 === anchorLine).length;
      const actualOcc = lines.slice(0, nextIdx).filter((L2) => L2 === anchorLine).length;
      if (expectedOcc !== actualOcc) errors.push(`ANN_OCCURRENCE ${a.marker} pre#${expectedOcc}!=actual#${actualOcc}`);
    }
  }
  return errors;
}
export { extractColorLiterals };   // 검수 §4: mutation·테스트가 EV 경유로 쓰도록 명시 re-export
// ── 검수 §2: 컴파일된 BASE selector에서 class atom 集合(중첩 &-- 포함) — raw includes 금지
export function atomsFromSelectors(decls) {
  const set = new Set();
  for (const d of decls) for (const m of String(d.selector).match(/\.[A-Za-z0-9_-]+/g) || []) set.add(m.slice(1));
  return set;
}
// ── 검수 §3: generator·테스트 공유 경로
export function evaluateProjection(spec, baseSources, io) {
  // io: { compileDecls(src, rel), lightVals, darkVals }
  const errors = []; const projSrc = {}; const preAnnSrc = {}; const baseDecls = []; const projDecls = [];
  for (const k of Object.keys(spec.FILES)) {
    const { rel } = spec.FILES[k];
    const conv = spec.CONVERSIONS.filter((c) => c.f === k);
    preAnnSrc[k] = projectSource(baseSources[k], conv, [], '', k).projected;   // annotation 삽입 전(검수 §1)
    const r = projectSource(baseSources[k], conv, spec.ANNOTATIONS, spec.OVERRIDES[k] || '', k);
    errors.push(...r.errors); projSrc[k] = r.projected;
    baseDecls.push(...io.compileDecls(baseSources[k], rel)); projDecls.push(...io.compileDecls(r.projected, rel));
  }
  const soloDiffs = new Map();
  for (const c of spec.CONVERSIONS) {
    const rel = spec.FILES[c.f].rel;
    const r = projectSource(baseSources[c.f], [c], [], '', c.f);
    if (r.errors.length) { errors.push(...r.errors); continue; }
    soloDiffs.set(c.id, diffInventories(io.compileDecls(baseSources[c.f], rel), io.compileDecls(r.projected, rel)).changed);
  }
  const attribution = attributeConversions(spec.CONVERSIONS, soloDiffs);
  errors.push(...attribution.errors, ...checkIdentity(spec.CONVERSIONS, io.lightVals),
    ...validateAnnotations(projSrc, preAnnSrc, spec.ANNOTATIONS, spec.FILES));
  const filesRel = Object.values(spec.FILES).map((f) => f.rel);
  const darkCounts = Object.fromEntries(Object.keys(spec.FILES).map((k) => [spec.FILES[k].rel, spec.DARK_DECL_COUNTS[k]]));
  errors.push(...validateDarkStructure(projDecls, filesRel, darkCounts));
  const atoms = atomsFromSelectors(baseDecls);
  const newSelectors = [...new Set(projDecls.filter((d) => isDarkSelector(d.selector)).map((d) => d.selector))];
  errors.push(...validateSelectors({ conversions: spec.CONVERSIONS, byConversion: attribution.byConversion,
    baseKeys: new Set(baseDecls.map((d) => d.key)), newSelectors, atomExists: (a) => atoms.has(a) }));
  const contrast = evaluateContrastCases(spec.CONTRAST_CASES, io.darkVals);
  errors.push(...contrast.errors);
  return { projSrc, preAnnSrc, baseDecls, projDecls, attribution, contrast, errors };
}
export function evaluateConformance(actualDecls, actualRaw, preAnnSources, spec, fixture, actualAllowIdToKey) {
  const errors = [];
  if (JSON.stringify(toExpectedAfter(actualDecls)) !== JSON.stringify(fixture.expectedAfter)) errors.push('EXPECTED_AFTER_MISMATCH');
  const filesRel = Object.values(spec.FILES).map((f) => f.rel);
  const darkCounts = Object.fromEntries(Object.keys(spec.FILES).map((k) => [spec.FILES[k].rel, spec.DARK_DECL_COUNTS[k]]));
  errors.push(...validateDarkStructure(actualDecls, filesRel, darkCounts));
  errors.push(...validateAnnotations(actualRaw, preAnnSources, spec.ANNOTATIONS, spec.FILES));
  if (JSON.stringify(extractResidual(actualDecls)) !== JSON.stringify(fixture.residual)) errors.push('RESIDUAL_MISMATCH');
  errors.push(...validateCounts(fixture, spec.COUNTS));                       // 검수 §4: counts 포함
  errors.push(...validateSmokeCoverage(fixture, spec.REQUIRED_SMOKE_SURFACES)); // coverage 포함
  // smoke 체인: captureName 집합이 surface manifest와 exact 일치해야 한다(context+PNG 동시 교체 방어)
  if (!fixture.smoke) errors.push('SMOKE_MANIFEST_MISSING');   // fail-closed — 부재는 정상이 아니다
  else {
    const want = spec.REQUIRED_SMOKE_SURFACES.map((x) => x.captureName).sort();
    const got = (fixture.smoke.captures || []).map((c) => c.captureName).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) errors.push('SMOKE_CAPTURE_SET_MISMATCH');
    if (!/^[0-9a-f]{64}$/.test(String(fixture.smoke.contextSha256 || ''))) errors.push('SMOKE_CONTEXT_SHA_INVALID');
    for (const c of fixture.smoke.captures || [])
      if (!/^[0-9a-f]{64}$/.test(String(c.sha256 || ''))) errors.push(`SMOKE_CAPTURE_SHA_INVALID ${c.captureName}`);
  }
  // changed evidence/allowIds를 spec에서 재계산해 대조(메타데이터 drift 검출)
  // allow #7·#8은 두 conversion이 같은 선언에 귀속되므로 unique set으로 비교
  const allowFromSpec = [...new Set(spec.CONVERSIONS.filter((c) => c.ident.t === 'allow').map((c) => c.ident.id))].sort((a, b) => a - b);
  const allowFromFixture = [...new Set(fixture.changed.flatMap((c) => c.allowIds))].sort((a, b) => a - b);
  if (JSON.stringify(allowFromSpec) !== JSON.stringify(allowFromFixture)) errors.push('EVIDENCE_ALLOW_DRIFT');
  // allow ID → declaration key: fixture에 동결된 맵을 **actual attribution 재계산 결과**와 exact 비교
  // (fixture.changed에서 owner를 되찾는 방식은 fixture를 정답으로 쓰는 self-oracle이라 폐기)
  // (a) fixture 내부 일관성: changed[*].allowIds에서 파생한 맵이 동결 맵과 같아야 한다(owner swap 검출)
  const derived = {};
  for (const c of fixture.changed) for (const id of c.allowIds) {
    if (derived[id] !== undefined && derived[id] !== c.key) errors.push(`EVIDENCE_ALLOW_DERIVED_SPLIT ${id}`);
    derived[id] = c.key;
  }
  if (JSON.stringify(derived) !== JSON.stringify(fixture.allowIdToKey || {})) errors.push('EVIDENCE_ALLOW_MAP_INTERNAL');
  // (b) actual attribution 재계산 맵과 동결 맵 비교 — 인자 누락은 fail-open이 아니라 결함이다
  if (!actualAllowIdToKey) errors.push('EVIDENCE_ALLOW_MAP_MISSING');
  else {
    const frozen = JSON.stringify(fixture.allowIdToKey || {});
    const recomputed = JSON.stringify(Object.fromEntries([...actualAllowIdToKey].sort((a, b) => a[0] - b[0])));
    if (frozen !== recomputed) errors.push('EVIDENCE_ALLOW_MAP_DRIFT');
  }
  return errors;
}

// ── 오버라이드 branch·smoke-light/allow 선언이 surface에 매핑되는지 — exact selector/state(검수 §3)
export function validateSmokeCoverage(fixture, surfaces) {
  const errors = [];
  const names = surfaces.map((x) => x.name);
  if (new Set(names).size !== names.length) errors.push('SURFACE_NAME_DUP');
  const STATE_OPS = { hover: ['hover'], focus: ['click', 'focus'], selected: ['click', 'setStorage'] };
  const ASSERT_OPS = new Set(['expectPresent', 'expectAbsent']);
  // requiredElements는 런타임 전제(변환 대상 아님) — schema 필수이고 coverage와 겹치면 안 된다
  for (const x of surfaces) {
    if (!Array.isArray(x.requiredElements)) { errors.push(`SURFACE_NO_REQUIRED_ELEMENTS ${x.name}`); continue; }
    const cov = new Set(x.coverageSelectors.map((o) => o.selector));
    for (const r of x.requiredElements) if (cov.has(r)) errors.push(`SURFACE_REQUIRED_OVERLAP ${x.name} ${r}`);
  }
  const covered = new Set();
  for (const x of surfaces) for (const o of x.coverageSelectors) {
    covered.add(o.state === 'hover' || o.state === 'focus' ? `${o.selector}:${o.state}` : o.selector);
    if (!o.state) continue;
    const act = x.actions[o.provenBy];
    if (!act) { errors.push(`SURFACE_STATE_UNPROVEN ${x.name} ${o.selector}:${o.state}`); continue; }
    const ops = STATE_OPS[o.state] || [];
    if (!ops.includes(act.op)) errors.push(`SURFACE_STATE_OP ${x.name} ${o.selector}:${o.state} op=${act.op}`);
    const base = o.selector.replace(/:(hover|focus)$/, '').replace(/--(on|active|open|selected)$/, '');
    // trigger와 결과 요소가 다른 UI(MatToggle→MatPill--on 등)가 정상 존재하므로 substring 추론을 강제하지 않는다.
    // produces는 러너가 액션 직후 실제로 검증해야 하는 postcondition 셀렉터다(선언만으로 통과 금지 — A-4 참조).
    // 여기서는 (1) produces가 있으면 해당 surface 액션 배열에 그 요소를 확인하는 expectPresent가 있는지 단정한다.
    // produces는 provenBy 액션 **직후**의 expectPresent여야 한다(배열 아무 데나 있으면 증거가 아님)
    const post = x.actions[o.provenBy + 1];
    if (o.produces && !(post && post.op === 'expectPresent' && post.selector === o.produces))
      errors.push(`SURFACE_PRODUCES_UNASSERTED ${x.name} ${o.produces}`);
    if (!o.produces && act.selector && !act.selector.includes(base.replace(/^\./, '')) && act.op !== 'setStorage')
      errors.push(`SURFACE_STATE_TARGET ${x.name} ${o.selector} vs ${act.selector}`);
  }
  const DEAD = ['ManageBranches', 'TrackHeader__ParticipatingAdd', 'SettingsGeneral__Swatch--active'];
  const isDead = (sel) => DEAD.some((d) => sel.includes(d));
  const unmapped = [];
  for (const n of fixture.new) for (const br of String(n.selector).split(',').map((x) => x.trim())) {
    const tail2 = br.replace(DARK_PREFIX, '').trim();
    if (!tail2 || isDead(tail2)) continue;
    if (!covered.has(tail2)) unmapped.push(`NEW ${tail2}`);
  }
  for (const c of fixture.changed) {
    if (!c.evidence.includes('smoke-light') && !c.evidence.includes('allow')) continue;
    if (isDead(c.selector)) continue;
    for (const br of String(c.selector).split(',').map((x) => x.trim())) if (!covered.has(br)) unmapped.push(`CHANGED ${br}`);
  }
  for (const u of [...new Set(unmapped)]) errors.push(`SMOKE_UNMAPPED ${u}`);
  // 양방향 equality: coverage에만 있고 실제 대상(NEW ∪ smoke/allow CHANGED)에 없는 항목도 결함이다(.Bogus 방지)
  const universe = new Set();
  for (const nn of fixture.new) for (const br of String(nn.selector).split(',').map((x) => x.trim())) {
    const t2 = br.replace(DARK_PREFIX, '').trim(); if (t2 && !isDead(t2)) universe.add(t2); }
  for (const c of fixture.changed) {
    if (!c.evidence.includes('smoke-light') && !c.evidence.includes('allow')) continue;
    if (isDead(c.selector)) continue;
    for (const br of String(c.selector).split(',').map((x) => x.trim())) universe.add(br); }
  for (const c of covered) if (!universe.has(c)) errors.push(`SMOKE_EXTRA ${c}`);
  return errors;
}
// ── 검수 §5: fingerprint에 BASE·FILES 포함
export function specFingerprint(spec, sha256Hex) {   // 검수 §7: surfaces·marker·override target 포함
  return sha256Hex(JSON.stringify({ base: spec.BASE, files: spec.FILES, counts: spec.COUNTS,
    darkCounts: spec.DARK_DECL_COUNTS, groupStage: spec.GROUP_STAGE,
    surfaces: spec.REQUIRED_SMOKE_SURFACES.map((x) => [x.name, x.captureName,
      JSON.stringify(x.coverageSelectors), JSON.stringify(x.darkReviewSelectors),
      JSON.stringify(x.requiredElements || []), JSON.stringify(x.actions)]),
    lightDiffMasks: spec.LIGHT_DIFF_MASKS,
    overrideTargets: Object.entries(spec.OVERRIDES).map(([k, v]) =>
      [k, (v.match(/^\s{2}\.[^{]+\{/gm) || []).map((t) => t.trim())]),
    conversions: spec.CONVERSIONS.map((c) => [c.id, c.f, c.l, c.k, c.from, c.to, c.group, c.stage, JSON.stringify(c.ident)]),
    annotations: spec.ANNOTATIONS.map((a) => [a.f, a.l, a.marker, a.anchor, a.text]),
    overrides: spec.OVERRIDES, contrast: spec.CONTRAST_CASES }));
}
// ── 검수 Minor: 3/4/6/8자리만
export function parseColorLiteral(str) {
  const s = String(str).trim();
  let m = s.match(/^#([0-9a-fA-F]+)$/);
  if (m) { const h = m[1]; if (![3, 4, 6, 8].includes(h.length)) return null;
    let x = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    const n = parseInt(x.slice(0, 6), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1 }; }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const p = m[1].split(',').map((v) => parseFloat(v.trim()));
    if (p.length < 3 || p.some((v) => Number.isNaN(v))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  return null;
}

import { extractColorLiterals } from './cssColorLiterals.mjs';
export function normColor(s) { let v = String(s).toLowerCase().replace(/\s+/g, '');
  const m = v.match(/^#([0-9a-f]{3,4})$/); if (m) v = '#' + [...m[1]].map((c) => c + c).join(''); return v; }
export function resolveLight(token, vals, d = 0) { const v = vals[token]; if (v === undefined || d > 8) return v;
  const m = String(v).trim().match(/^var\((--[A-Za-z0-9-]+)\)$/); return m ? resolveLight(m[1], vals, d + 1) : v; }
export function projectSource(src, conversions, annotations = [], overrideText = '', fileKey = null) {
  const errors = []; const lines = src.split('\n'); const used = new Set();
  for (const c of conversions) {
    if (fileKey && c.f !== fileKey) { errors.push(`CONV_FILE ${c.id}`); continue; }
    if (used.has(c.l)) errors.push(`DUP_LINE ${c.id}`); used.add(c.l);
    const i = c.l - 1; const line = lines[i];
    if (line === undefined) { errors.push(`NO_LINE ${c.id}`); continue; }
    if (c.k === 'tint') {
      const re = new RegExp(`rgba\\(\\s*${c.from.split(',').map((s) => s.trim()).join('\\s*,\\s*')}\\s*,\\s*([\\d.]+)\\s*\\)`, 'g');
      const m = [...line.matchAll(re)];
      if (m.length !== 1) { errors.push(`TINT_MATCH ${c.id} n=${m.length}`); continue; }
      lines[i] = line.replace(re, c.to.replace('{P}', String(+(parseFloat(m[0][1]) * 100).toFixed(4))));
    } else if (c.k === 'txt') {
      const n = (s) => s.replace(/\s+/g, ' ');
      if (n(line).split(n(c.from)).length - 1 !== 1) { errors.push(`TXT_MATCH ${c.id}`); continue; }
      lines[i] = line.replace(new RegExp(c.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')), c.to);
    } else {
      if (line.split(c.from).length - 1 !== 1) { errors.push(`LIT_MATCH ${c.id}`); continue; }
      lines[i] = line.replace(c.from, c.to);
    }
  }
  const anns = annotations.filter((a) => !fileKey || a.f === fileKey).sort((x, y) => y.l - x.l);
  for (const a of anns) { const cur = lines[a.l - 1];
    if (cur === undefined || !cur.includes(a.anchor)) { errors.push(`ANN_ANCHOR ${a.f}${a.l}`); continue; }
    lines.splice(a.l - 1, 0, a.text); }
  let out = lines.join('\n');
  if (overrideText) out += '\n' + overrideText + '\n';
  return { projected: out, errors };
}
export function collectDeclarations(root, file) {
  const out = []; const occ = new Map(); let order = 0;
  root.walkDecls((d) => {
    const atRules = []; let p = d.parent;
    while (p && p.type !== 'root') { if (p.type === 'atrule') atRules.unshift(`@${p.name} ${p.params}`); p = p.parent; }
    const selector = d.parent.type === 'rule' ? d.parent.selector : '';
    const k0 = `${file}|${atRules.join('>')}|${selector}|${d.prop}`;
    const declarationOccurrence = occ.get(k0) || 0; occ.set(k0, declarationOccurrence + 1);
    out.push({ key: `${k0}|${declarationOccurrence}`, file, atRules, selector, property: d.prop,
      declarationOccurrence, important: !!d.important, sourceOrder: order++, value: d.value });
  });
  return out;
}
export function toExpectedAfter(decls) { return decls.map((d) => ({ key: d.key, value: d.value, important: d.important })); }
export function countLiterals(decls) { return decls.reduce((n, d) => n + extractColorLiterals(d.value).length, 0); }
export function diffInventories(before, after) {
  const b = new Map(before.map((d) => [d.key, d])), a = new Map(after.map((d) => [d.key, d]));
  const changed = [], added = [], missing = [];
  for (const [k, bd] of b) { const ad = a.get(k);
    if (!ad) { missing.push(k); continue; }
    if (ad.value !== bd.value || ad.important !== bd.important) changed.push({ key: k, file: bd.file, selector: bd.selector,
      property: bd.property, declarationOccurrence: bd.declarationOccurrence, before: bd.value, after: ad.value,
      beforeImportant: bd.important, afterImportant: ad.important }); }
  for (const [k, ad] of a) if (!b.has(k)) added.push(ad);
  return { changed, added, missing };
}
export function attributeConversions(conversions, soloDiffs) {
  const errors = []; const byConversion = new Map(); const byKey = new Map(); const allowIdToKey = new Map();
  for (const c of conversions) { const d = soloDiffs.get(c.id);
    if (!d || d.length !== 1) { errors.push(`ATTR ${c.id} n=${d ? d.length : 'none'}`); continue; }
    const key = d[0].key; byConversion.set(c.id, key);
    const e = byKey.get(key) || { evidence: new Set(), allowIds: new Set() };
    e.evidence.add(c.ident.t === 'allow' ? 'allow' : c.ident.t === 'smoke' ? 'smoke-light' : 'token-identity');
    if (c.ident.t === 'allow') {
      e.allowIds.add(c.ident.id);
      const prev = allowIdToKey.get(c.ident.id);
      if (prev !== undefined && prev !== key) errors.push(`ALLOW_ID_SPLIT ${c.ident.id} ${prev} vs ${key}`);
      allowIdToKey.set(c.ident.id, key);   // spec attribution에서 독립 도출(자기 자신을 정답으로 쓰지 않음)
    }
    byKey.set(key, e); }
  return { byConversion, byKey, allowIdToKey, errors };
}
export function checkIdentity(conversions, lightVals) {
  const errors = [];
  for (const c of conversions) { const id = c.ident;
    if (id.t === 'smoke' || id.t === 'allow') continue;
    const target = resolveLight(id.token, lightVals);
    if (target === undefined) { errors.push(`IDENT_TOKEN_MISSING ${id.token} @${c.id}`); continue; }
    if (id.t === 'lit') { if (normColor(id.literal) !== normColor(target)) errors.push(`IDENT_LIT ${c.id}: ${id.literal} vs ${target}`); }
    else if (id.t === 'alias') { const from = resolveLight(id.from, lightVals);
      if (from === undefined) { errors.push(`IDENT_ALIAS_MISSING ${id.from} @${c.id}`); continue; }
      if (normColor(from) !== normColor(target)) errors.push(`IDENT_ALIAS ${c.id}: ${from} vs ${target}`); }
    else errors.push(`IDENT_KIND ${c.id}`); }
  return errors;
}
export function compositeOver(fg, bg) { const a = fg.a;
  return { r: a * fg.r + (1 - a) * bg.r, g: a * fg.g + (1 - a) * bg.g, b: a * fg.b + (1 - a) * bg.b, a: 1 }; }
export function relativeLuminance({ r, g, b }) { const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
export function contrastRatio(c1, c2) { const l1 = relativeLuminance(c1), l2 = relativeLuminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
export function evaluateContrastCases(cases, vals) {
  const errors = []; const results = [];
  const tok = (t) => { const v = resolveLight(t, vals); const c = v === undefined ? null : parseColorLiteral(v);
    if (!c) errors.push(`CONTRAST_TOKEN ${t}`); return c; };
  for (const cs of cases) {
    const fg = tok(cs.text); if (!fg) continue;
    const first = cs.stack[0];
    let bases = first.gradient ? first.gradient.map(tok) : [first.token ? tok(first.token) : parseColorLiteral(first.raw)];
    if (bases.some((b) => !b)) { errors.push(`CONTRAST_BASE ${cs.name}`); continue; }
    for (const layer of cs.stack.slice(1)) {
      let over = null;
      if (layer.token) over = tok(layer.token);
      else if (layer.raw) over = parseColorLiteral(layer.raw);
      else if (layer.mix) { const m = tok(layer.mix); if (m) over = { ...m, a: layer.pct / 100 }; }
      if (!over) { errors.push(`CONTRAST_LAYER ${cs.name}`); bases = null; break; }
      bases = bases.map((b) => compositeOver(over, b));
    }
    if (!bases) continue;
    const ratio = Math.min(...bases.map((b) => contrastRatio(fg, b)));
    results.push({ name: cs.name, ratio: +ratio.toFixed(3), min: cs.min, dead: !!cs.dead, pass: cs.dead || ratio >= cs.min });
    if (!cs.dead && ratio < cs.min) errors.push(`CONTRAST_FAIL ${cs.name} ${ratio.toFixed(3)} < ${cs.min}`);
  }
  return { results, errors };
}
export function validateSelectors({ conversions, byConversion, baseKeys, newSelectors, atomExists }) {
  const e = [];
  for (const c of conversions) { const k = byConversion.get(c.id); if (!k || !baseKeys.has(k)) e.push(`SEL_BASE_MISSING ${c.id}`); }
  for (const sel of newSelectors) for (const atom of sel.match(/[.#][A-Za-z0-9_-]+/g) || [])
    if (!atomExists(atom.slice(1))) e.push(`SEL_ATOM_MISSING ${atom} in ${sel}`);
  return e;
}
export function buildFixture({ base, blobs, baseDecls, projectedDecls, conversions, attribution, contrast, fingerprint, smoke }) {
  const errors = [];
  const { changed, added, missing } = diffInventories(baseDecls, projectedDecls);
  if (missing.length) errors.push(`MISSING_DECL ${missing.length}`);
  const raw = countLiterals(baseDecls);
  const residual = extractResidual(projectedDecls);
  const processed = conversions.filter((c) => c.k === 'tint' || extractColorLiterals(c.from).length > 0).length;
  if (raw - residual.length !== processed) errors.push(`PROCESSED_MISMATCH raw${raw}-res${residual.length}!=${processed}`);
  const changedKeys = new Set(changed.map((c) => c.key)); const attrKeys = new Set(attribution.byKey.keys());
  if (changedKeys.size !== attrKeys.size || [...changedKeys].some((k) => !attrKeys.has(k))) errors.push('ATTR_COVERAGE');
  const withEv = changed.map((c) => { const e = attribution.byKey.get(c.key) || { evidence: new Set(), allowIds: new Set() };
    return { ...c, evidence: [...e.evidence].sort(), allowIds: [...e.allowIds].sort((a, b) => a - b) }; });
  const allowBearing = withEv.filter((c) => c.allowIds.length).length;
  const allowIdToKey = Object.fromEntries([...(attribution.allowIdToKey || new Map())].sort((a, b) => a[0] - b[0]));
  // smoke = { contextSha256, captures: [{captureName, sha256}, ...] } — fixture SHA가 이 체인 전체를 보호한다
  return { fixture: { base, blobs, fingerprint, allowIdToKey, smoke: smoke || null,
    counts: { conversions: conversions.length, changed: changed.length, new: added.length,
      newRules: new Set(added.map((d) => `${d.file}|${d.selector}`)).size, residual: residual.length, raw, processed, allowBearing },
    expectedAfter: toExpectedAfter(projectedDecls), changed: withEv, new: added, residual, contrast: contrast.results }, errors };
}
// privacy audit 검증 — generator와 상설 테스트가 **같은 helper**를 쓴다.
// pass:true 인데 findings가 남아 있는 모순도 결함이다(검수 I1).
export function validatePrivacyAudit(audit, expected) {
  // expected = { captures: [{captureName, sha256}], contextSubjectSha256 }
  //   audit이 "무엇을 보고 PASS했는지"를 바이트 해시로 못박는다 — 감사 후 같은 이름으로 PNG를 바꿔치기하거나
  //   context 필드를 고치면 stale PASS가 되던 구멍을 닫는다(검수 Important).
  const errors = [];
  if (!audit || typeof audit !== 'object') { errors.push('PRIVACY_AUDIT_MISSING'); return errors; }
  if (audit.scope !== 'dedicated-synthetic-account-workspace') errors.push(`PRIVACY_AUDIT_SCOPE ${audit.scope}`);
  if (audit.contextPass !== true) errors.push('PRIVACY_AUDIT_CONTEXT_FAIL');
  if (audit.contextSubjectSha256 !== expected.contextSubjectSha256)
    errors.push(`PRIVACY_AUDIT_CONTEXT_SUBJECT_DRIFT ${audit.contextSubjectSha256} != ${expected.contextSubjectSha256}`);
  const caps = Array.isArray(audit.captures) ? audit.captures : null;
  if (!caps) { errors.push('PRIVACY_AUDIT_CAPTURES_TYPE'); return errors; }
  const expMap = new Map(expected.captures.map((c) => [c.captureName, c.sha256]));
  const names = caps.map((c) => (c && c.captureName));
  if (names.length !== expected.captures.length) errors.push(`PRIVACY_AUDIT_CAPTURE_COUNT ${names.length}`);
  if (new Set(names).size !== names.length) errors.push('PRIVACY_AUDIT_CAPTURE_DUP');
  if (JSON.stringify([...names].sort()) !== JSON.stringify([...expMap.keys()].sort())) errors.push('PRIVACY_AUDIT_CAPTURE_SET');
  for (const c of caps) {
    if (!c || c.pass !== true) { errors.push(`PRIVACY_AUDIT_FAIL ${c && c.captureName}`); continue; }
    if (!Array.isArray(c.findings)) { errors.push(`PRIVACY_AUDIT_FINDINGS_TYPE ${c.captureName}`); continue; }
    if (c.findings.some((f) => typeof f !== 'string')) errors.push(`PRIVACY_AUDIT_FINDINGS_ITEM ${c.captureName}`);
    if (c.findings.length !== 0) errors.push(`PRIVACY_AUDIT_FINDINGS_NONEMPTY ${c.captureName}`);
    const want = expMap.get(c.captureName);
    if (want === undefined) { errors.push(`PRIVACY_AUDIT_CAPTURE_UNKNOWN ${c.captureName}`); continue; }
    if (c.sha256 !== want) errors.push(`PRIVACY_AUDIT_SUBJECT_DRIFT ${c.captureName}`);   // 감사한 바이트 != 동결될 바이트
  }
  return errors;
}

// fixture 직렬화 정본 — 해시·비교가 모두 이 함수를 쓴다(compact/pretty 불일치로 인한 vacuous mutation 방지)
export function serializeFixture(fx) { return JSON.stringify(fx, null, 2) + '\n'; }

// context는 중첩 구조({trackId, settingsPreset:{...}})이고 manifest는 평면 {id}/{inactivePresetValue}를 쓴다.
// 러너는 반드시 이 함수로 평탄화한 뒤 resolveActions에 넘긴다(검수 I1).
export function buildActionContext(ctx) {
  return { ...ctx, id: ctx.trackId, ...(ctx.settingsPreset || {}) };
}
const PLACEHOLDER_FIELDS = ['url', 'selector', 'hasText', 'key', 'value', 'nth'];
export function resolvePlaceholders(value, ctx) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (ctx[k] !== undefined ? String(ctx[k]) : m));
}
export function resolveActions(actions, ctx) {
  const errors = [];
  const resolved = actions.map((a) => {
    const r = { ...a };
    for (const f of PLACEHOLDER_FIELDS) if (r[f] !== undefined) r[f] = resolvePlaceholders(r[f], ctx);
    // nth도 미해결 검사 대상이다(이전엔 빠져 있어 '{...}' 문자열이 errors 없이 통과했다)
    for (const f of PLACEHOLDER_FIELDS) {
      if (typeof r[f] === 'string' && /\{[A-Za-z0-9_]+\}/.test(r[f])) errors.push(`UNRESOLVED_PLACEHOLDER ${r.op} ${f} ${r[f]}`);
    }
    if (r.nth !== undefined) {
      if (typeof r.nth === 'string' && /^-?\d+(\.\d+)?$/.test(r.nth)) r.nth = Number(r.nth);
      if (!Number.isInteger(r.nth) || r.nth < 0) errors.push(`INVALID_NTH ${r.op} ${String(r.nth)}`);
    }
    return r;
  });
  return { resolved, errors };
}

export function validateCounts(fx, COUNTS) {
  const e = []; const c = fx.counts;
  const chk = (k, v, exp) => { if (v !== exp) e.push(`${k} ${v}!=${exp}`); };
  chk('conversions', c.conversions, COUNTS.conversions); chk('changed', c.changed, COUNTS.changedDecls);
  chk('new', c.new, COUNTS.newDecls); chk('newRules', c.newRules, COUNTS.newRules);
  chk('residual', c.residual, COUNTS.residual); chk('raw', c.raw, COUNTS.rawLiterals);
  chk('processed', c.processed, COUNTS.processedLiterals); chk('allowBearing', c.allowBearing, COUNTS.allowIds);
  const ids = fx.changed.flatMap((x) => x.allowIds);
  if (ids.length !== COUNTS.allowIds || new Set(ids).size !== COUNTS.allowIds) e.push('allowIds dup/미달');
  else for (let i = 1; i <= COUNTS.allowIds; i++) if (!ids.includes(i)) e.push(`allowId ${i} 누락`);
  if (new Set(fx.changed.map((x) => x.key)).size !== fx.changed.length) e.push('changed key dup');
  return e;
}
