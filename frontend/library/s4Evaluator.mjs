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
export function evaluateConformance(actualDecls, actualRaw, preAnnSources, spec, fixture, actualAllowIdToKey, baseDecls) {
  const errors = [];
  if (JSON.stringify(toExpectedAfter(actualDecls)) !== JSON.stringify(fixture.expectedAfter)) errors.push('EXPECTED_AFTER_MISMATCH');
  const filesRel = Object.values(spec.FILES).map((f) => f.rel);
  const darkCounts = Object.fromEntries(Object.keys(spec.FILES).map((k) => [spec.FILES[k].rel, spec.DARK_DECL_COUNTS[k]]));
  errors.push(...validateDarkStructure(actualDecls, filesRel, darkCounts));
  errors.push(...validateAnnotations(actualRaw, preAnnSources, spec.ANNOTATIONS, spec.FILES));
  if (JSON.stringify(extractResidual(actualDecls)) !== JSON.stringify(fixture.residual)) errors.push('RESIDUAL_MISMATCH');
  // fixture가 가리키는 선언 key가 **실제 선언 목록에 존재**하고, key에 인코딩된 property가
  // 그 선언의 property와 일치하는지 확인한다. 이 결속이 없으면 changed/allowIdToKey의 file·property를
  // 함께 바꿔치기해도(내부 일관이므로) conformance가 clean이었다 — 표기만 분리되고 실체와 무관해진다.
  // actual 선언의 key는 신뢰 대상이 아니다 — canonical 재계산과 일치해야 하고 중복도 금지한다.
  const actualByKey = new Map();
  for (const d of actualDecls) {
    const want = declarationKey(d);
    if (d.key !== want) errors.push(`DECL_KEY_NONCANONICAL ${d.key} != ${want}`);
    if (actualByKey.has(d.key)) errors.push(`DECL_KEY_DUP ${d.key}`);
    actualByKey.set(d.key, d);
  }
  const baseByKey = new Map();
  if (!Array.isArray(baseDecls)) errors.push('BASE_DECLS_REQUIRED');
  else for (const d of baseDecls) baseByKey.set(d.key, d);
  // changed는 production schema 전체를 갖고, actual(after)·base(before) 양쪽과 exact 대조한다.
  const CH_FIELDS = ['key', 'file', 'selector', 'property', 'declarationOccurrence',
    'before', 'after', 'beforeImportant', 'afterImportant'];
  for (const c of fixture.changed || []) {
    for (const f of CH_FIELDS) if (!(f in c)) { errors.push(`CHANGED_SCHEMA_MISSING ${c.key} ${f}`); }
    const want = declarationKey(c);
    if (c.key !== want) errors.push(`CHANGED_KEY_NONCANONICAL ${c.key} != ${want}`);
    const d = actualByKey.get(c.key);
    if (!d) { errors.push(`CHANGED_KEY_NOT_IN_ACTUAL ${c.key}`); continue; }
    for (const [f, av] of [['file', d.file], ['selector', d.selector], ['property', d.property],
      ['declarationOccurrence', d.declarationOccurrence], ['after', d.value], ['afterImportant', d.important]])
      if (c[f] !== av) errors.push(`CHANGED_VS_ACTUAL ${c.key} ${f}`);
    const b = baseByKey.get(c.key);
    if (!b) { if (Array.isArray(baseDecls)) errors.push(`CHANGED_KEY_NOT_IN_BASE ${c.key}`); continue; }
    if (c.before !== b.value) errors.push(`CHANGED_VS_BASE ${c.key} before`);
    if (c.beforeImportant !== b.important) errors.push(`CHANGED_VS_BASE ${c.key} beforeImportant`);
  }
  for (const [id, key] of Object.entries(fixture.allowIdToKey || {}))
    if (!actualByKey.has(key)) errors.push(`ALLOW_KEY_NOT_IN_ACTUAL ${id} ${key}`);
  errors.push(...validateCounts(fixture, spec.COUNTS, spec));                       // 검수 §4: counts 포함
  errors.push(...validateSmokeCoverage(fixture, spec.REQUIRED_SMOKE_SURFACES, spec)); // coverage 포함
  errors.push(...validateMaskContract(fixture, spec));                          // 마스크 정본 계약(context는 generator가 별도 검사)
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
// 마스크 계약 — allow 선언 → 마스크 정본 → 브라우저 좌표를 한 곳에서 잠근다.
// 이 함수가 없던 동안 LIGHT_DIFF_MASKS와 context.baseLightMaskRects는 서로를 검사하지 않았고,
// spec에 없는 selector가 context에 들어가도(또는 live allow의 마스크가 빠져도) 전부 GREEN이었다.
// fixture(파생) ↔ spec(정본) ↔ context(관측) 세 축을 교차 단정한다.
export function validateMaskContract(fixture, spec, ctx) {
  const errors = [];
  const masks = spec.LIGHT_DIFF_MASKS || {};
  const idToKey = fixture.allowIdToKey || {};
  const byKey = new Map((fixture.changed || []).map((c) => [c.key, c]));
  const selOf = (key) => String(key).split('|')[2];

  // 1) allow ID 우주 = LIGHT_DIFF_MASKS 키 == fixture allowIdToKey (dead 예외 개념 없음)
  // allow ID 키는 canonical 양의 정수 문자열이어야 한다. '01'과 '1'은 서로 다른 object key인데
  // Number() 변환 후 합쳐져 중복 선언이 조용히 통과한다.
  const CANON_ID = /^[1-9][0-9]*$/;
  const canon = (obj, where) => { const out = new Set();
    for (const k of Object.keys(obj)) { if (!CANON_ID.test(k)) { errors.push(`MASK_ID_NONCANONICAL ${where} ${JSON.stringify(k)}`); continue; }
      if (out.has(Number(k))) errors.push(`MASK_ID_DUPLICATE ${where} ${k}`); out.add(Number(k)); } return out; };
  const maskIds = canon(masks, 'LIGHT_DIFF_MASKS');
  const dIds = new Set();
  const fxIds = canon(idToKey, 'allowIdToKey');
  for (const id of maskIds) if (dIds.has(id)) errors.push(`MASK_ID_ALSO_DEAD ${id}`);
  for (const id of fxIds) if (!maskIds.has(id) && !dIds.has(id)) errors.push(`MASK_ID_UNCLASSIFIED ${id}`);
  for (const id of [...maskIds, ...dIds]) if (!fxIds.has(id)) errors.push(`MASK_ID_UNKNOWN ${id}`);

  // 2) 각 ID의 selector가 그 allow가 붙은 선언의 selector와 exact 일치
  for (const [idStr, m] of Object.entries(masks)) {
    const key = idToKey[idStr];
    if (key === undefined) continue;                       // 1)에서 이미 보고됨
    if (!m || typeof m.selector !== 'string') { errors.push(`MASK_SHAPE ${idStr}`); continue; }
    if (!Number.isFinite(m.paintOutsetPx) || m.paintOutsetPx < 0) errors.push(`MASK_OUTSET ${idStr}`);
    if (!Number.isFinite(m.expectedScale) || !(m.expectedScale > 0)) errors.push(`MASK_EXPECTED_SCALE ${idStr}`);
    if (m.selector !== selOf(key)) errors.push(`MASK_SELECTOR_MISMATCH ${idStr} ${m.selector} != ${selOf(key)}`);
    if (!byKey.has(key)) errors.push(`MASK_KEY_MISSING ${idStr}`);
  }

  // 3) live mask selector는 coverage가 소유해야 한다(dead 선언으로 도망갈 수 없다)
  const owner = new Map();
  for (const x of spec.REQUIRED_SMOKE_SURFACES || [])
    for (const o of x.coverageSelectors || []) {
      if (!owner.has(o.selector)) owner.set(o.selector, new Set());
      owner.get(o.selector).add(x.name);
    }
  for (const [idStr, m] of Object.entries(masks))
    if (m && !owner.has(m.selector)) errors.push(`MASK_NOT_COVERED ${idStr} ${m.selector}`);
  const outsetBySel = new Map();
  for (const [idStr, m] of Object.entries(masks)) {
    if (!m) continue;
    if (outsetBySel.has(m.selector) && outsetBySel.get(m.selector).o !== m.paintOutsetPx)
      errors.push(`MASK_OUTSET_CONFLICT ${m.selector} ${outsetBySel.get(m.selector).o}!=${m.paintOutsetPx}`);
    if (outsetBySel.has(m.selector) && outsetBySel.get(m.selector).s !== m.expectedScale)
      errors.push(`MASK_SCALE_CONFLICT ${m.selector} ${outsetBySel.get(m.selector).s}!=${m.expectedScale}`);
    outsetBySel.set(m.selector, { o: m.paintOutsetPx, s: m.expectedScale });
  }

  if (!ctx) return errors;                                  // context 없이 spec/fixture만 검사하는 호출 허용

  // 4) context rect 검사.
  //   ⚠️ coverage owner로 rect 배치를 제한하지 않는다. coverage owner는 "그 상태의 증거를 대표하는
  //   화면"일 뿐이고, 같은 selector가 다른 화면(모달 뒤 캔버스 등)에도 실제로 렌더된다. owner 밖
  //   rect를 지우면 그 화면에서 허용된 라이트 변화가 마스크 밖으로 노출돼 false-red가 난다.
  //   대신 (a) spec 정본 밖 selector 금지 (b) manifest에 없는 surface 이름 금지 (c) 좌표 유효성
  //   (d) paintRect = borderRect ⊕ (outset×scale) 를 강제한다.
  const vp = (ctx.viewport && Number.isFinite(ctx.viewport.width) && Number.isFinite(ctx.viewport.height)
    && ctx.viewport.width > 0 && ctx.viewport.height > 0) ? ctx.viewport : null;
  if (!vp) errors.push('MASK_CTX_VIEWPORT');
  const specSels = new Set(Object.values(masks).map((m) => m && m.selector));
  const surfaceNames = (spec.REQUIRED_SMOKE_SURFACES || []).map((x) => x.name);
  const surfaceSet = new Set(surfaceNames);
  // **full matrix 계약**: 조사 우주 자체의 완전성을 잠근다.
  //   이전 판은 context에 "존재하는 키만" 순회하고 빈 배열을 거부했다. 그래서 "조사했지만 0건"과
  //   "아예 조사하지 않음"이 구조적으로 같은 모양이 되어, 한 화면을 통째로 빠뜨려도 조용히 통과했다.
  //   이제 surface 키 집합은 manifest 24개와 exact 일치해야 하고, 각 surface는 live selector 15개
  //   키를 **전부** 가져야 하며, 미발견은 생략이 아니라 `[]`로 표기한다.
  const ctxSurfaces = Object.keys(ctx.baseLightMaskRects || {});
  for (const s of ctxSurfaces) if (!surfaceSet.has(s)) errors.push(`MASK_UNKNOWN_SURFACE ${s}`);
  for (const s of surfaceNames) if (!Object.prototype.hasOwnProperty.call(ctx.baseLightMaskRects || {}, s))
    errors.push(`MASK_SURFACE_NOT_SCANNED ${s}`);
  const seen = new Map();
  for (const sel of specSels) seen.set(sel, 0);
  for (const [surface, byselRaw] of Object.entries(ctx.baseLightMaskRects || {})) {
    const bysel = byselRaw || {};
    if (surfaceSet.has(surface))
      for (const sel of specSels) if (!Object.prototype.hasOwnProperty.call(bysel, sel))
        errors.push(`MASK_SELECTOR_NOT_SCANNED ${surface} ${sel}`);
    for (const [sel, rects] of Object.entries(bysel)) {
      if (!specSels.has(sel)) { errors.push(`MASK_FOREIGN_SELECTOR ${surface} ${sel}`); continue; }
      if (!Array.isArray(rects)) { errors.push(`MASK_RECT_NOT_ARRAY ${surface} ${sel}`); continue; }
      seen.set(sel, seen.get(sel) + rects.length);
      const outset = (Object.values(masks).find((m) => m.selector === sel) || {}).paintOutsetPx;
      for (const r of rects) {
        const need = ['x', 'y', 'width', 'height', 'scale'];
        if (need.some((k) => !Number.isFinite(r[k]))) { errors.push(`MASK_RECT_NONFINITE ${surface} ${sel}`); continue; }
        if (!(r.width > 0) || !(r.height > 0) || !(r.scale > 0)) { errors.push(`MASK_RECT_DEGENERATE ${surface} ${sel}`); continue; }
        if (!r.paintRect || need.slice(0, 4).some((k) => !Number.isFinite(r.paintRect[k]))
          || !(r.paintRect.width > 0) || !(r.paintRect.height > 0)) { errors.push(`MASK_PAINT_MISSING ${surface} ${sel}`); continue; }
        // paintRect는 borderRect를 outset×scale 만큼 사방 확장한 것과 정확히 같아야 한다
        const specM = Object.values(masks).find((mm) => mm.selector === sel) || {};
        if (specM.expectedScale !== undefined && Math.abs(r.scale - specM.expectedScale) > 1e-9)
          { errors.push(`MASK_SCALE_UNEXPECTED ${surface} ${sel} ${r.scale}!=${specM.expectedScale}`); continue; }
        const o = outset * r.scale, EPS = 1e-6;
        const want = { x: r.x - o, y: r.y - o, width: r.width + 2 * o, height: r.height + 2 * o };
        for (const k of ['x', 'y', 'width', 'height'])
          if (Math.abs(r.paintRect[k] - want[k]) > EPS) { errors.push(`MASK_PAINT_MISMATCH ${surface} ${sel} ${k}`); break; }
        if (vp && (r.paintRect.x < 0 || r.paintRect.y < 0
          || r.paintRect.x + r.paintRect.width > vp.width || r.paintRect.y + r.paintRect.height > vp.height))
          errors.push(`MASK_RECT_OUT_OF_VIEWPORT ${surface} ${sel}`);
      }
    }
  }
  // 전 surface 합계가 0이면 그 live selector는 어디서도 관측되지 않은 것 — 마스크가 무의미해진다.
  for (const sel of specSels) if (!seen.get(sel)) errors.push(`MASK_RECT_ABSENT ${sel}`);
  return errors;
}


export function validateSmokeCoverage(fixture, surfaces, spec) {
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
  // dead 예외 개념 없음 — S4는 죽은 컴포넌트를 범위에서 제외했으므로 모든 대상 selector가 live이고
  // coverage로 덮여야 한다. 예외 목록·더미 술어 자체가 self-bless 우회였다(리뷰 실증).
  const unmapped = [];
  for (const n of fixture.new) for (const br of String(n.selector).split(',').map((x) => x.trim())) {
    const tail2 = br.replace(DARK_PREFIX, '').trim();
    if (!tail2) continue;
    if (!covered.has(tail2)) unmapped.push(`NEW ${tail2}`);
  }
  for (const c of fixture.changed) {
    if (!c.evidence.includes('smoke-light') && !c.evidence.includes('allow')) continue;
    for (const br of String(c.selector).split(',').map((x) => x.trim())) if (!covered.has(br)) unmapped.push(`CHANGED ${br}`);
  }
  for (const u of [...new Set(unmapped)]) errors.push(`SMOKE_UNMAPPED ${u}`);
  // 양방향 equality: coverage에만 있고 실제 대상(NEW ∪ smoke/allow CHANGED)에 없는 항목도 결함이다(.Bogus 방지)
  const universe = new Set();
  for (const nn of fixture.new) for (const br of String(nn.selector).split(',').map((x) => x.trim())) {
    const t2 = br.replace(DARK_PREFIX, '').trim(); if (t2) universe.add(t2); }
  for (const c of fixture.changed) {
    if (!c.evidence.includes('smoke-light') && !c.evidence.includes('allow')) continue;
    for (const br of String(c.selector).split(',').map((x) => x.trim())) universe.add(br); }
  for (const c of covered) if (!universe.has(c)) errors.push(`SMOKE_EXTRA ${c}`);
  return errors;
}
// ── 검수 §5: fingerprint에 BASE·FILES 포함
// 대비 참고치 계약 — 이름 집합 exact equality + 양쪽 중복 금지 + 드리프트.
// `REFERENCE[name] !== undefined` 필터만 쓰면 case 하나를 지우거나 reference 하나를 지워도
// drift가 빈 배열이 되어 검사가 조용히 사라진다(리뷰 실증).
export function validateContrastReference(cases, reference, results, tol = 0.3) {
  const errors = [];
  const caseNames = (cases || []).map((c) => c.name);
  const refNames = Object.keys(reference || {});
  if (new Set(caseNames).size !== caseNames.length) errors.push('CONTRAST_CASE_NAME_DUP');
  const cs = [...new Set(caseNames)].sort(), rs = [...refNames].sort();
  if (JSON.stringify(cs) !== JSON.stringify(rs))
    errors.push(`CONTRAST_REFERENCE_SET_MISMATCH cases=[${cs.join(',')}] ref=[${rs.join(',')}]`);
  const TOL_MAX = 0.3;
  const byName = new Map((cases || []).map((c) => [c.name, c]));
  // case.min을 독립 검증한다. result.min/pass를 min에 "맞춰" 넣으면 상호 일치라 통과했다(리뷰 실증).
  for (const c of cases || []) {
    if (typeof c.min !== 'number' || !Number.isFinite(c.min) || !(c.min > 1) || !(c.min <= 21))
      errors.push(`CONTRAST_CASE_MIN_INVALID ${c.name} ${c.min}`);
  }
  const seen = new Set();
  for (const r of results || []) {
    if (seen.has(r.name)) errors.push(`CONTRAST_RESULT_DUP ${r.name}`);
    seen.add(r.name);
    // result 메타데이터가 case와 계산 결과에 결속돼야 동결된 대비 증거를 신뢰할 수 있다.
    const cse = byName.get(r.name);
    if (cse) {
      if (r.min !== cse.min) errors.push(`CONTRAST_RESULT_MIN_MISMATCH ${r.name} ${r.min}!=${cse.min}`);
      const expectPass = typeof r.ratio === 'number' && Number.isFinite(r.ratio)
        && typeof cse.min === 'number' && Number.isFinite(cse.min) && r.ratio >= cse.min;
      if (r.pass !== expectPass) errors.push(`CONTRAST_RESULT_PASS_MISMATCH ${r.name} ${r.pass}!=${expectPass}`);
    }
    if (!(r.name in (reference || {}))) { errors.push(`CONTRAST_REFERENCE_MISSING ${r.name}`); continue; }
    // NaN/undefined/문자열이면 `Math.abs(NaN - ref) > tol`이 false라 드리프트 검사가 사라진다.
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!fin(tol) || tol < 0 || tol > TOL_MAX) { errors.push(`CONTRAST_TOL_INVALID ${tol}`); continue; }
    if (!fin(r.ratio) || !(r.ratio >= 1 && r.ratio <= 21)) { errors.push(`CONTRAST_RESULT_RATIO_INVALID ${r.name} ${r.ratio}`); continue; }
    const rv = reference[r.name];
    if (!fin(rv) || !(rv >= 1 && rv <= 21)) { errors.push(`CONTRAST_REFERENCE_INVALID ${r.name} ${rv}`); continue; }
    if (Math.abs(r.ratio - reference[r.name]) > tol)
      errors.push(`CONTRAST_REFERENCE_DRIFT ${r.name} ${r.ratio} vs ${reference[r.name]}`);
  }
  for (const n of refNames) if (!seen.has(n)) errors.push(`CONTRAST_RESULT_MISSING ${n}`);
  return errors;
}

// generator가 candidate fixture를 승인하기 전 통과해야 하는 **순수 실행 경로**.
// 배선을 정규식으로 확인하면 호출을 지우고 같은 문자열을 주석에 남겨도 통과한다 — 이 함수에
// 변이 spec을 주입하는 행동 테스트로 배선을 잠근다.
export function validateCandidate({ fixture, spec, context, contrastResults }) {
  const errors = [];
  // context 생략은 fail-closed — validateMaskContract가 context 없으면 spec/fixture만 보고 반환하므로
  // candidate 승인 경로에서 그대로 두면 좌표 계약 전체가 조용히 빠진다(리뷰 실증).
  if (!context || typeof context !== 'object' || Array.isArray(context)) { errors.push('CANDIDATE_CONTEXT_REQUIRED'); return errors; }
  if (!Array.isArray(contrastResults)) { errors.push('CANDIDATE_CONTRAST_RESULTS_REQUIRED'); return errors; }
  errors.push(...validateCounts(fixture, spec.COUNTS, spec));
  errors.push(...validateSmokeCoverage(fixture, spec.REQUIRED_SMOKE_SURFACES, spec));
  errors.push(...validateMaskContract(fixture, spec, context));
  errors.push(...validateContrastReference(spec.CONTRAST_CASES, spec.CONTRAST_REFERENCE, contrastResults || []));
  return errors;
}

// 승인과 쓰기를 한 함수로 묶는다 — writer를 주입 가능하게 둬서 "오류가 있으면 정말 안 쓴다"를
// 소스 정규식이 아니라 **행동**으로 검증할 수 있게 한다(주석 decoy로 통과하던 배선 테스트 대체).
// errors가 비어 있지 않으면 serialize도 write도 호출하지 않는다.
// PNG를 **실제로 디코드**한다. signature와 IHDR 위치만 보면 CRC·필수 chunk가 없는 33바이트
// 가짜도 통과한다(리뷰 실증: decodePngHeader ok:true 인데 PNG.sync.read는 CRC 오류).
// 이미 의존성에 있는 pngjs로 파싱하고 치수는 decode 결과에서 파생한다.
export function decodePngHeader(bytes) {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) return { ok: false, reason: 'PNG_EMPTY' };
  let img = null;
  try { img = PNG.sync.read(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)); }
  catch (e) { return { ok: false, reason: `PNG_DECODE_FAILED ${e && e.message}` }; }
  if (!img || !(img.width > 0) || !(img.height > 0)) return { ok: false, reason: 'PNG_BAD_DIMENSIONS' };
  return { ok: true, width: img.width, height: img.height };
}

// ── 산출물 검증 코어 ────────────────────────────────────────────────────────
// 입력은 **raw bytes만** 받는다. caller가 이미 파싱한 객체·해시·validator 결과를 정답으로
// 주입할 수 없어야 한다(그게 self-validation의 근원이다). context도 여기서 직접 파싱한다.
function artifactsCore({ fixture, spec, contextRaw, sha256, readPng, baseDecls }) {
  const errors = [];
  if (typeof sha256 !== 'function' || typeof readPng !== 'function') return ['ARTIFACTS_IO_REQUIRED'];
  if (typeof contextRaw !== 'string') return ['ARTIFACTS_CONTEXT_RAW_REQUIRED'];
  let ctx = null;
  try { ctx = JSON.parse(contextRaw); } catch (e) { return ['ARTIFACTS_CONTEXT_UNPARSEABLE']; }
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return ['ARTIFACTS_CONTEXT_SHAPE'];

  // 1) spec ↔ fixture 신뢰 루트
  const fp = specFingerprint(spec, sha256);
  if (fixture.fingerprint !== fp) errors.push(`FROZEN_FINGERPRINT_DRIFT ${fixture.fingerprint} != ${fp}`);
  if (fixture.base !== spec.BASE) errors.push(`FROZEN_BASE_DRIFT ${fixture.base} != ${spec.BASE}`);

  // 2) blob 계약 — 키 집합 exact + {rel, blob} exact
  const specKeys = Object.keys(spec.FILES || {}).sort();
  const fxKeys = Object.keys(fixture.blobs || {}).sort();
  if (JSON.stringify(specKeys) !== JSON.stringify(fxKeys))
    errors.push(`FROZEN_BLOB_KEYSET [${fxKeys}] != [${specKeys}]`);
  for (const k of specKeys) {
    const want = spec.FILES[k], got = (fixture.blobs || {})[k];
    if (!got) { errors.push(`FROZEN_BLOB_MISSING ${k}`); continue; }
    if (got.rel !== want.rel) errors.push(`FROZEN_BLOB_REL ${k} ${got.rel} != ${want.rel}`);
    if (got.blob !== want.blob) errors.push(`FROZEN_BLOB_SHA ${k} ${got.blob} != ${want.blob}`);
  }

  // 3) context 원문 해시 — hash·mask·privacy가 모두 **같은 bytes**에서 파생된다
  if (!fixture.smoke) errors.push('FROZEN_SMOKE_MISSING');
  else if (fixture.smoke.contextSha256 !== sha256(contextRaw))
    errors.push(`FROZEN_CONTEXT_SHA_DRIFT ${fixture.smoke.contextSha256} != ${sha256(contextRaw)}`);

  // 4) raster 계약 — 정본 상수와 각각 대조(자기정합 금지)
  const RC = spec.RASTER_CONTRACT;
  if (!RC) errors.push('FROZEN_RASTER_CONTRACT_MISSING');
  else {
    const vp = ctx.viewport || {};
    if (vp.width !== RC.width || vp.height !== RC.height)
      errors.push(`RASTER_CONTEXT_VIEWPORT ${vp.width}x${vp.height} != ${RC.width}x${RC.height}`);
    const cap = ctx.capture || {};
    if (cap.scale !== RC.screenshotScale) errors.push(`RASTER_SCREENSHOT_SCALE ${cap.scale} != ${RC.screenshotScale}`);
    if (cap.dpr !== RC.dpr) errors.push(`RASTER_DPR ${cap.dpr} != ${RC.dpr}`);
  }

  // 5) PNG 이름 집합·바이트 해시·IHDR 크기(정본 대조)
  const want = (spec.REQUIRED_SMOKE_SURFACES || []).map((x) => x.captureName).sort();
  const caps = (fixture.smoke && fixture.smoke.captures) || [];
  const got = caps.map((c) => c.captureName).sort();
  if (JSON.stringify(want) !== JSON.stringify(got)) errors.push('FROZEN_CAPTURE_SET_MISMATCH');
  for (const c of caps) {
    let bytes = null;
    try { const r = readPng(c.captureName); bytes = (r && r.bytes) ? r.bytes : r; } catch (e) { bytes = null; }
    if (!bytes) { errors.push(`FROZEN_PNG_UNREADABLE ${c.captureName}`); continue; }
    if (sha256(bytes) !== c.sha256) errors.push(`FROZEN_PNG_SHA_DRIFT ${c.captureName}`);
    // 치수는 caller 신고가 아니라 바이트에서 파생한다.
    const hdr = decodePngHeader(bytes);
    if (!hdr.ok) { errors.push(`RASTER_PNG_DECODE ${c.captureName} ${hdr.reason}`); continue; }
    if (RC && (hdr.width !== RC.width || hdr.height !== RC.height))
      errors.push(`RASTER_PNG_SIZE ${c.captureName} ${hdr.width}x${hdr.height} != ${RC.width}x${RC.height}`);
  }

  // 6) 마스크·좌표 계약 — 방금 파싱한 그 객체로만 검사한다
  errors.push(...validateMaskContract(fixture, spec, ctx));

  // 7) privacy audit — subject를 **재계산**한다. audit에 적힌 값을 기대값으로 되쓰면 자기비교다.
  const { privacyAudit, ...subject } = ctx;
  if (!privacyAudit) errors.push('FROZEN_PRIVACY_AUDIT_MISSING');
  else {
    const recomputed = sha256(JSON.stringify(canonicalize(subject)));
    errors.push(...validatePrivacyAudit(privacyAudit, {
      captures: caps.map((c) => ({ captureName: c.captureName, sha256: c.sha256 })),
      contextSubjectSha256: recomputed,
    }));
  }

  // 8) BASE 선언 — canonical key·중복. 빈 배열은 공허 통과이므로 fail-closed.
  if (!Array.isArray(baseDecls) || baseDecls.length === 0) errors.push('FROZEN_BASE_DECLS_REQUIRED');
  else {
    const seen = new Set(); const files = new Set();
    for (const d of baseDecls) {
      const k = declarationKey(d);
      if (d.key !== k) errors.push(`FROZEN_BASE_KEY_NONCANONICAL ${d.key} != ${k}`);
      if (seen.has(d.key)) errors.push(`FROZEN_BASE_KEY_DUP ${d.key}`);
      seen.add(d.key); files.add(d.file);
    }
    for (const k of specKeys) if (!files.has(spec.FILES[k].rel))
      errors.push(`FROZEN_BASE_FILE_ABSENT ${spec.FILES[k].rel}`);
  }
  return errors;
}

// 디스크에 **커밋된** fixture 원문을 검증한다(정상 운영·CI 계약: errors === []).
export function validateCommittedArtifacts({ committedFixtureRaw, spec, contextRaw, sha256, readPng, baseDecls }) {
  if (typeof committedFixtureRaw !== 'string') return ['COMMITTED_FIXTURE_RAW_REQUIRED'];
  let fixture = null;
  try { fixture = JSON.parse(committedFixtureRaw); } catch (e) { return ['COMMITTED_FIXTURE_UNPARSEABLE']; }
  return artifactsCore({ fixture, spec, contextRaw, sha256, readPng, baseDecls });
}

// 메모리에서 새로 만든 candidate를 검증한다. **커밋된 fixture를 정답으로 쓰지 않는다.**
export function validateCandidateArtifacts({ fixture, spec, contextRaw, sha256, readPng, baseDecls }) {
  return artifactsCore({ fixture, spec, contextRaw, sha256, readPng, baseDecls });
}

// ── 승인 orchestration ─────────────────────────────────────────────────────
// validator를 **주입받지 않는다**. 데이터와 순수 IO만 받고 내부에서 concrete validator를 호출한다.
// 순서: candidate → conformance → candidate artifacts → serialize → write.
// 내부 validator 반환값이 배열이 아니면 내부 결함으로 보고 write하지 않는다.
export function approveAndWrite({
  fixture, spec, contrastResults,
  actualDecls, actualRaw, preAnnSources, actualAllowIdToKey, baseDecls,
  contextRaw, sha256, readPng,
  serialize, write,
}) {
  const calls = { candidate: 0, conformance: 0, artifacts: 0 };
  if (typeof serialize !== 'function' || typeof write !== 'function')
    return { errors: ['APPROVE_IO_REQUIRED'], wrote: false, bytes: null, calls };
  // 비배열 반환도, 예외도 내부 결함으로 보고 write하지 않는다(예외가 그대로 튀면 fail-closed가 아니다).
  const step = (name, fn) => { let r;
    try { r = fn(); } catch (e) { return [`APPROVE_VALIDATOR_THREW ${name} ${e && e.message}`]; }
    if (!Array.isArray(r)) return [`APPROVE_VALIDATOR_NONARRAY ${name}`];
    return r; };

  calls.candidate = 1;
  let errors = step('candidate', () => validateCandidate({ fixture, spec, context: safeParse(contextRaw), contrastResults }));
  if (errors.length) return { errors, wrote: false, bytes: null, calls };

  calls.conformance = 1;
  errors = step('conformance', () => evaluateConformance(actualDecls, actualRaw, preAnnSources, spec, fixture, actualAllowIdToKey, baseDecls));
  if (errors.length) return { errors, wrote: false, bytes: null, calls };

  calls.artifacts = 1;
  errors = step('artifacts', () => validateCandidateArtifacts({ fixture, spec, contextRaw, sha256, readPng, baseDecls }));
  if (errors.length) return { errors, wrote: false, bytes: null, calls };

  const bytes = serialize(fixture);
  write(bytes);
  return { errors: [], wrote: true, bytes, calls };
}
function safeParse(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }

export function specFingerprint(spec, sha256Hex) {   // 검수 §7: surfaces·marker·override target 포함
  return sha256Hex(JSON.stringify({ base: spec.BASE, files: spec.FILES, counts: spec.COUNTS,
    darkCounts: spec.DARK_DECL_COUNTS, groupStage: spec.GROUP_STAGE,
    surfaces: spec.REQUIRED_SMOKE_SURFACES.map((x) => [x.name, x.captureName,
      JSON.stringify(x.coverageSelectors), JSON.stringify(x.darkReviewSelectors),
      JSON.stringify(x.requiredElements || []), JSON.stringify(x.actions)]),
    lightDiffMasks: spec.LIGHT_DIFF_MASKS,
    contrastReference: spec.CONTRAST_REFERENCE,   // 참고치 삭제·변조도 fingerprint를 흔든다
    rasterContract: spec.RASTER_CONTRACT,        // viewport·DPR·scale이 바뀌면 다른 spec identity다
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
import { canonicalize } from './s4Canonicalize.mjs';
import { PNG } from 'pngjs';
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
// 선언 key 정본 — collector와 validator가 **같은 함수**를 쓴다. 따로 만들면 validator가
// `d.key`를 그냥 신뢰하게 되고, actual의 file/atRules/occurrence를 바꿔치기해도 통과한다(리뷰 실증).
export function declarationKeyBase({ file, atRules, selector, property }) {
  return `${file}|${(atRules || []).join('>')}|${selector}|${property}`;
}
export function declarationKey(d) {
  return `${declarationKeyBase(d)}|${d.declarationOccurrence}`;
}
export function collectDeclarations(root, file) {
  const out = []; const occ = new Map(); let order = 0;
  root.walkDecls((d) => {
    const atRules = []; let p = d.parent;
    while (p && p.type !== 'root') { if (p.type === 'atrule') atRules.unshift(`@${p.name} ${p.params}`); p = p.parent; }
    const selector = d.parent.type === 'rule' ? d.parent.selector : '';
    const k0 = declarationKeyBase({ file, atRules, selector, property: d.prop });
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
    // `dead` 의미론은 삭제했다 — dead:true가 대비 실패를 무조건 통과시키는 우회였다.
    if ('dead' in cs) errors.push(`CONTRAST_DEAD_FORBIDDEN ${cs.name}`);
    // 숫자 스키마 fail-closed — min이나 pct가 없으면 비교식이 NaN이 되어 조용히 통과했다(리뷰 실증).
    const fin = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!fin(cs.min) || !(cs.min > 1)) errors.push(`CONTRAST_MIN_INVALID ${cs.name} ${cs.min}`);
    for (const st of cs.stack || []) if ('mix' in st && !(fin(st.pct) && st.pct >= 0 && st.pct <= 100))
      errors.push(`CONTRAST_PCT_INVALID ${cs.name} ${st.pct}`);
    if (!fin(ratio) || !(ratio >= 1 && ratio <= 21)) { errors.push(`CONTRAST_RATIO_INVALID ${cs.name} ${ratio}`); continue; }
    results.push({ name: cs.name, ratio: +ratio.toFixed(3), min: cs.min, pass: fin(cs.min) && ratio >= cs.min });
    if (!fin(cs.min) || ratio < cs.min) errors.push(`CONTRAST_FAIL ${cs.name} ${ratio.toFixed(3)} < ${cs.min}`);
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

export function validateCounts(fx, COUNTS, spec) {
  const e = []; const c = fx.counts;
  const chk = (k, v, exp) => { if (v !== exp) e.push(`${k} ${v}!=${exp}`); };
  chk('conversions', c.conversions, COUNTS.conversions); chk('changed', c.changed, COUNTS.changedDecls);
  chk('new', c.new, COUNTS.newDecls); chk('newRules', c.newRules, COUNTS.newRules);
  chk('residual', c.residual, COUNTS.residual); chk('raw', c.raw, COUNTS.rawLiterals);
  chk('processed', c.processed, COUNTS.processedLiterals); chk('allowBearing', c.allowBearing, COUNTS.allowIds);
  // allow ID는 **연속 번호가 아니다**(죽은 컴포넌트 제외로 3·4·11이 비었다). 1..N 가정은 영구 RED를 만든다.
  // 재번호화하지 않고 네 집합의 sorted exact equality를 검사한다. COUNTS.allowIds는 개수로만 쓴다.
  // `map(Number)`만 쓰면 '04'가 4로 합쳐져 `allowIds=[1,'04']`가 정상 집합처럼 보인다(리뷰 실증).
  // 값은 positive safe integer **타입**으로, 객체 키는 canonical 문자열로 각각 강제한 뒤 비교한다.
  const CANON = /^[1-9][0-9]*$/;
  const okInt = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  const numsOf = (arr, where) => { const out = [];
    for (const v of arr) { if (!okInt(v)) { e.push(`ALLOW_ID_TYPE ${where} ${JSON.stringify(v)}`); continue; } out.push(v); }
    return [...new Set(out)].sort((x, y) => x - y); };
  const keysOf = (obj, where) => { const out = [];
    for (const k of Object.keys(obj || {})) {
      if (!CANON.test(k) || !Number.isSafeInteger(Number(k))) { e.push(`ALLOW_ID_KEY ${where} ${JSON.stringify(k)}`); continue; }
      out.push(Number(k));
    } return [...new Set(out)].sort((x, y) => x - y); };
  const fromChanged = numsOf(fx.changed.flatMap((x) => x.allowIds || []), 'changed');
  const fromKeyMap = keysOf(fx.allowIdToKey, 'allowIdToKey');
  const fromConv = numsOf((spec && spec.CONVERSIONS || []).filter((c) => c.ident && c.ident.t === 'allow').map((c) => c.ident.id), 'CONVERSIONS');
  const fromMasks = keysOf((spec && spec.LIGHT_DIFF_MASKS) || {}, 'LIGHT_DIFF_MASKS');
  const raw = fx.changed.flatMap((x) => x.allowIds || []);
  if (raw.length !== new Set(raw).size) e.push('allowIds 중복');
  if (fromChanged.length !== COUNTS.allowIds) e.push(`allowIds 개수 ${fromChanged.length}!=${COUNTS.allowIds}`);
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  // spec 생략은 fail-closed — 없으면 네 집합 중 둘(changed↔keyMap)만 검사돼 조용히 약해진다.
  if (!spec) e.push('ALLOW_SET_SPEC_REQUIRED');
  else {
    if (!eq(fromChanged, fromConv)) e.push(`ALLOW_SET_CHANGED_VS_CONVERSIONS ${fromChanged.join(',')} != ${fromConv.join(',')}`);
    if (!eq(fromChanged, fromMasks)) e.push(`ALLOW_SET_CHANGED_VS_MASKS ${fromChanged.join(',')} != ${fromMasks.join(',')}`);
  }
  if (!eq(fromChanged, fromKeyMap)) e.push(`ALLOW_SET_CHANGED_VS_KEYMAP ${fromChanged.join(',')} != ${fromKeyMap.join(',')}`);
  if (new Set(fx.changed.map((x) => x.key)).size !== fx.changed.length) e.push('changed key dup');
  return e;
}
