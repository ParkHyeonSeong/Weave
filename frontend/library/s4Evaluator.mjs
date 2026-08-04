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

// paintRect = borderRect ⊕ (outset × scale). **단일 원천**이다 —
// 캡처 실행기가 이 값을 만들고 validateMaskContract가 같은 함수로 재파생해 대조한다.
// 러너가 공식을 따로 적으면 MASK_PAINT_MISMATCH가 동전던지기가 되고, 바깥으로 편향된 rect가
// 회귀를 삼킨다(위험 방향). outset의 오라클은 maxOutwardPaintPx, scale의 오라클은 crossCheckScale이다.
export function derivePaintRect(occ, outsetPx) {
  const d = outsetPx * occ.scale;
  return { x: occ.x - d, y: occ.y - d, width: occ.width + 2 * d, height: occ.height + 2 * d };
}

// selector → paintOutsetPx. 한 selector에 두 allow가 붙을 수 있으므로 집합에서 파생한다.
export function outsetBySelector(spec) {
  const out = new Map();
  for (const m of Object.values(spec.LIGHT_DIFF_MASKS || {})) if (m) out.set(m.selector, m.paintOutsetPx);
  return out;
}

// ── plain JSON 계약 ───────────────────────────────────────────────────────────
// context/observed는 "JSON에서 나온 것과 구별 불가"해야 한다.
//
// 왜 필요한가: `diffSurfaceLight`는 호출부가 준 객체를 검증하고 **그 다음에** 같은 객체에서
// paintRect를 다시 읽는다. accessor(getter)를 심으면 검증 때는 작은 rect를, 소비 때는 화면 전체를
// 돌려줄 수 있다(읽을 때마다 값이 달라지는 TOCTOU). 비열거 속성·심볼 키·이상한 prototype도
// 같은 부류다 — 검증 순회에서는 보이지 않는데 다른 경로에서는 읽힌다.
// 동결 파일에서 JSON.parse한 값은 항상 이 계약을 만족하므로, 정상 경로에는 비용이 없다.
export function plainJsonErrors(value, path = '$', seen = new Set()) {
  const errors = [];
  const t = typeof value;
  if (value === null || t === 'boolean' || t === 'string') return errors;
  if (t === 'number') { if (!Number.isFinite(value)) errors.push(`JSON_NONFINITE ${path}`); return errors; }
  if (t !== 'object') { errors.push(`JSON_BAD_TYPE ${path} ${t}`); return errors; }
  if (seen.has(value)) { errors.push(`JSON_CYCLE ${path}`); return errors; }
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  const isArr = Array.isArray(value);
  if (isArr ? proto !== Array.prototype : !(proto === Object.prototype || proto === null))
    errors.push(`JSON_BAD_PROTO ${path}`);
  if (Object.getOwnPropertySymbols(value).length) errors.push(`JSON_SYMBOL_KEY ${path}`);
  const names = Object.getOwnPropertyNames(value);
  const idx = isArr ? new Set(Array.from({ length: value.length }, (_, i) => String(i))) : null;
  for (const k of names) {
    if (isArr && k === 'length') continue;                 // 배열의 length는 정의상 비열거다
    if (isArr && !idx.has(k)) { errors.push(`JSON_ARRAY_EXTRA_KEY ${path}.${k}`); continue; }
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (typeof d.get === 'function' || typeof d.set === 'function') { errors.push(`JSON_ACCESSOR ${path}.${k}`); continue; }
    if (!d.enumerable) { errors.push(`JSON_NON_ENUMERABLE ${path}.${k}`); continue; }
    errors.push(...plainJsonErrors(d.value, `${path}.${k}`, seen));
  }
  seen.delete(value);
  return errors;
}

// ── 마스크가 덮는 실제 픽셀 ───────────────────────────────────────────────────
// rect → 픽셀 범위 규칙의 **단일 원천**. s4PixelDiff.fillRects가 이 함수를 쓰고 예산 검증도
// 이 함수를 쓴다. 두 곳에 같은 floor/ceil을 따로 적어두면 한쪽만 바뀌어도 예산이 거짓이 된다.
export function rectPixelBounds(r, width, height, scale = 1) {
  return {
    x0: Math.max(0, Math.floor(r.x * scale)), y0: Math.max(0, Math.floor(r.y * scale)),
    x1: Math.min(width, Math.ceil((r.x + r.width) * scale)), y1: Math.min(height, Math.ceil((r.y + r.height) * scale)),
  };
}
// 겹침을 반영한 마스크 픽셀 수. 면적 합이 아니라 **집합의 크기**여야 한다 —
// 겹치는 rect를 여러 개 넣어 면적 합만 맞추는 우회를 막는다.
export function countMaskedPixels(rects, width, height, scale = 1) {
  const grid = new Uint8Array(width * height);
  let n = 0;
  for (const r of rects) {
    const b = rectPixelBounds(r, width, height, scale);
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
      const i = y * width + x;
      if (!grid[i]) { grid[i] = 1; n++; }
    }
  }
  return n;
}

// ── paintOutsetPx의 오라클 ────────────────────────────────────────────────────
// 선언된 outset이 "그 allow가 실제로 바꾼 property가 border box 밖에 칠할 수 있는 최대 거리"와
// 같은지 본다. 이전 판은 outset이 손으로 적은 숫자였고 아무것도 그걸 검사하지 않았다 —
// 값을 키우면 마스크가 넓어져 실제 회귀를 삼키는데(위험 방향) 통과했다.
//
// 방향성: outset이 **작으면** 허용 변화가 마스크 밖으로 새어나가 RED가 된다(시끄럽지만 안전).
// **크면** 무관한 픽셀까지 덮어 회귀를 감춘다(위험). 그래서 상한을 계약으로 잠근다.
//
// 괄호 안 콤마를 보존하는 분할 — computed 값의 색은 `rgba(0, 0, 0, 0.03)`처럼 콤마를 품는다.
export function splitTopLevel(str) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(str)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// `name(...)`의 인자를 **괄호 균형을 세어** 뽑는다.
// `/drop-shadow\(([^)]*)\)/`는 인자 안의 `rgb(0, 0, 0)`의 첫 `)`에서 끊겨
// `rgb(0, 0, 0)`만 남기고 길이를 0개로 만들었다(실측: 정상 drop-shadow가 파싱 오류로 떨어짐).
export function extractFunctionArgs(str, name) {
  const s = String(str), lower = s.toLowerCase(), tag = `${name.toLowerCase()}(`;
  const args = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(tag, i);
    if (at < 0) break;
    let depth = 0, j = at + tag.length - 1;
    for (; j < s.length; j++) {
      if (s[j] === '(') depth++;
      else if (s[j] === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) return { args, rest: '', err: `UNBALANCED_${name.toUpperCase()}` };
    args.push(s.slice(at + tag.length, j));
    i = j + 1;
  }
  // 인자를 걷어낸 나머지 — 모델에 없는 함수가 섞여 있으면 여기 남는다.
  let rest = '', k = 0;
  for (;;) {
    const at = lower.indexOf(tag, k);
    if (at < 0) { rest += s.slice(k); break; }
    rest += s.slice(k, at);
    let depth = 0, j = at + tag.length - 1;
    for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')') { depth--; if (depth === 0) break; } }
    k = j + 1;
  }
  return { args, rest: rest.trim(), err: null };
}

// 한 shadow 레이어에서 border box 밖으로 나가는 최대 거리. inset은 0.
// blur는 상한으로 **전체 반경**을 쓴다(스펙상 실제 확산은 그보다 작다). 현 allow에는 blur>0인
// 항목이 없어 이 느슨함은 실사용에서 발현되지 않는다 — 생기면 RED로 드러나고 재검토 대상이다.
// wantLengths: box-shadow의 computed 값은 항상 4개(dx dy blur spread)지만
// filter의 drop-shadow()는 spread가 없어 3개(dx dy blur)다. 개수를 property별로 못박아,
// 형태가 다르면 0으로 떨어지지 않고 오류가 되게 한다.
function shadowLayerOutset(layer, wantLengths) {
  if (/(^|\s)inset(\s|$)/.test(layer)) return { px: 0, err: null };
  const lens = (layer.replace(/[a-z-]+\([^)]*\)/gi, ' ').match(/-?[0-9.]+px/g) || []).map(parseFloat);
  if (lens.length !== wantLengths) return { px: 0, err: `SHADOW_LAYER_UNPARSEABLE ${JSON.stringify(layer)}` };
  const [dx, dy, blur, spread = 0] = lens;
  const reach = blur + spread;
  return { px: Math.max(0, reach - dx, reach + dx, reach - dy, reach + dy), err: null };
}
// property → 그 property가 border box 밖에 칠할 수 있는 최대 거리(변환 전 CSS px).
// 모델에 없는 property는 0으로 떨어지지 않고 **오류**다. 새 allow가 조용히 outset 0을 얻으면
// 그 property의 외곽 페인트가 검사 없이 통과한다.
export function maxOutwardPaintPx(property, paint) {
  const p = paint || {};
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
  switch (property) {
    // 배경/전경 잉크/테두리는 모두 border box 안이다.
    case 'background': case 'background-color': case 'background-image':
    case 'color':
    case 'border': case 'border-color':
    case 'border-top-color': case 'border-right-color': case 'border-bottom-color': case 'border-left-color':
      return { px: 0, errors: [] };
    case 'box-shadow': {
      if (typeof p.boxShadow !== 'string') return { px: NaN, errors: ['PAINT_BOX_SHADOW_MISSING'] };
      if (p.boxShadow === 'none') return { px: 0, errors: [] };
      let px = 0; const errors = [];
      for (const layer of splitTopLevel(p.boxShadow)) {
        const r = shadowLayerOutset(layer, 4);
        if (r.err) errors.push(r.err); else px = Math.max(px, r.px);
      }
      return { px: errors.length ? NaN : px, errors };
    }
    case 'outline': case 'outline-color': {
      if (typeof p.outlineStyle !== 'string') return { px: NaN, errors: ['PAINT_OUTLINE_MISSING'] };
      if (p.outlineStyle === 'none') return { px: 0, errors: [] };
      const w = num(p.outlineWidth), off = num(p.outlineOffset);
      if (!Number.isFinite(w) || !Number.isFinite(off)) return { px: NaN, errors: ['PAINT_OUTLINE_UNPARSEABLE'] };
      return { px: Math.max(0, w + off), errors: [] };
    }
    case 'filter': {
      if (typeof p.filter !== 'string') return { px: NaN, errors: ['PAINT_FILTER_MISSING'] };
      if (p.filter === 'none') return { px: 0, errors: [] };
      const errors = [];
      const { args, rest, err } = extractFunctionArgs(p.filter, 'drop-shadow');
      if (err) errors.push(`PAINT_FILTER_${err}`);
      // drop-shadow 말고 다른 함수가 섞여 있으면 그 외곽 영향을 모델링하지 않은 것이다.
      if (rest) errors.push(`PAINT_FILTER_UNMODELED ${rest}`);
      let px = 0;
      for (const a of args) {                     // drop-shadow는 spread가 없어 길이 3개다
        const r = shadowLayerOutset(a, 3);
        if (r.err) errors.push(`FILTER_${r.err}`); else px = Math.max(px, r.px);
      }
      return { px: errors.length ? NaN : px, errors };
    }
    default:
      return { px: NaN, errors: [`PAINT_PROPERTY_UNMODELED ${property}`] };
  }
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
  const propOf = (key) => (key === undefined ? undefined : String(key).split('|')[3]);

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
    if (m.expectedScale !== undefined) errors.push(`MASK_EXPECTED_SCALE_OBSOLETE ${idStr}`);   // selector 전역 배율은 폐기됨
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
  // selector → { outset, 변경 property 집합 }. 같은 selector에 두 allow가 붙으면 둘 다 일치해야 한다.
  const bySel = new Map();
  for (const [idStr, m] of Object.entries(masks)) {
    if (!m) continue;
    const prop = propOf(idToKey[idStr]);
    if (!bySel.has(m.selector)) bySel.set(m.selector, { o: m.paintOutsetPx, props: new Set() });
    const e = bySel.get(m.selector);
    if (e.o !== m.paintOutsetPx) errors.push(`MASK_OUTSET_CONFLICT ${m.selector} ${e.o}!=${m.paintOutsetPx}`);
    if (prop !== undefined) e.props.add(prop);
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
  // **full matrix 계약(현재 23 surface × 15 live selector)**: 조사 우주 자체의 완전성을 잠근다.
  //   이전 판은 context에 "존재하는 키만" 순회하고 빈 배열을 거부했다. 그래서 "조사했지만 0건"과
  //   "아예 조사하지 않음"이 구조적으로 같은 모양이 되어, 한 화면을 통째로 빠뜨려도 조용히 통과했다.
  //   이제 surface 키 집합은 manifest 23개와 exact 일치해야 하고, 각 surface는 live selector 15개
  //   키를 **전부** 가져야 하며, 미발견은 생략이 아니라 `[]`로 표기한다.
  const ctxSurfaces = Object.keys(ctx.baseLightMaskRects || {});
  for (const s of ctxSurfaces) if (!surfaceSet.has(s)) errors.push(`MASK_UNKNOWN_SURFACE ${s}`);
  for (const s of surfaceNames) if (!Object.prototype.hasOwnProperty.call(ctx.baseLightMaskRects || {}, s))
    errors.push(`MASK_SURFACE_NOT_SCANNED ${s}`);
  // 배율 표(정본) ↔ occurrence 점유(관측) 양방향 대조용 수집
  const scaleTable = spec.ELEMENT_SCALES;
  if (!scaleTable || typeof scaleTable !== 'object') errors.push('MASK_SCALE_TABLE_MISSING');
  const envHit = new Map();            // selector -> 실제 도달한 극단(envelope 도달 검사용)
  const occupied = new Map();          // surface -> Set<selector>. occurrence가 1건 이상인 셀.
  // 문자열 결합 키(`a b`)는 쓰지 않는다 — 구분자가 눈에 안 보여 실제로 NUL이 섞여 들어가도
  // 컴파일되고, 두 방향 검사가 서로 다른 키를 보며 99건씩 헛돌았다(실측).
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
      if (rects.length) { if (!occupied.has(surface)) occupied.set(surface, new Set()); occupied.get(surface).add(sel); }
      const entry = bySel.get(sel) || {};
      const outset = entry.o;
      const declaredScale = ((scaleTable || {})[surface] || {})[sel];
      for (const r of rects) {
        const need = ['x', 'y', 'width', 'height', 'scale', 'borderBoxWidth', 'borderBoxHeight',
          'transformScaleX', 'transformScaleY'];
        if (need.some((k) => !Number.isFinite(r[k]))) { errors.push(`MASK_RECT_NONFINITE ${surface} ${sel}`); continue; }
        if (!(r.width > 0) || !(r.height > 0) || !(r.scale > 0)
          || !(r.borderBoxWidth > 0) || !(r.borderBoxHeight > 0)) { errors.push(`MASK_RECT_DEGENERATE ${surface} ${sel}`); continue; }
        if (!r.paintRect || need.slice(0, 4).some((k) => !Number.isFinite(r.paintRect[k]))
          || !(r.paintRect.width > 0) || !(r.paintRect.height > 0)) { errors.push(`MASK_PAINT_MISSING ${surface} ${sel}`); continue; }
        // (a) 배율은 (surface, selector)별 정본 표와 일치해야 한다
        if (!Number.isFinite(declaredScale) || !(declaredScale > 0))
          { errors.push(`MASK_SCALE_UNDECLARED ${surface} ${sel}`); continue; }
        if (qs(r.scale) !== qs(declaredScale))
          { errors.push(`MASK_SCALE_UNEXPECTED ${surface} ${sel} ${r.scale}!=${declaredScale}`); continue; }
        // (b) 오라클: 같은 occurrence 안에서 rect/borderBox 파생과 transform 행렬 곱이 일치해야 한다.
        //     scale과 paintRect를 함께 부풀리는 위조는 여기서 걸린다 — scale을 키우면 width가
        //     borderBox×scale에서 벗어나고, width까지 맞추면 정본 표·PNG 좌표와 어긋난다.
        const cross = crossCheckScale(r);
        if (cross.length) { errors.push(...cross.map((e) => `MASK_${e} ${surface} ${sel}`)); continue; }
        // (c) outset은 **그 allow가 실제로 바꾼 property**의 computed 외곽 페인트에서 파생돼야 한다
        const props = [...(entry.props || [])];
        if (!props.length) { errors.push(`MASK_OUTSET_NO_PROPERTY ${surface} ${sel}`); continue; }
        let derived = 0; let derr = [];
        for (const prop of props) {
          const d = maxOutwardPaintPx(prop, r);
          derr.push(...d.errors);
          derived = Math.max(derived, d.px);
        }
        if (derr.length) { errors.push(...derr.map((e) => `MASK_${e} ${surface} ${sel}`)); continue; }
        if (!Number.isFinite(derived) || q(outset) !== q(derived))
          { errors.push(`MASK_OUTSET_UNJUSTIFIED ${surface} ${sel} 선언=${outset} 파생=${derived} (${props.join(',')})`); continue; }
        // (d) 변환 전 크기가 selector별 envelope 안이어야 한다 — 부모/형제 요소를 대입하면
        //     좌표·배율은 자기정합적이어도 크기가 어긋난다.
        const envE = (spec.SELECTOR_SIZE_ENVELOPE || {})[sel];
        if (!envE) { errors.push(`MASK_ENVELOPE_UNDECLARED ${sel}`); continue; }
        if (q(r.borderBoxWidth) < q(envE.minW) || q(r.borderBoxWidth) > q(envE.maxW)
          || q(r.borderBoxHeight) < q(envE.minH) || q(r.borderBoxHeight) > q(envE.maxH)) {
          errors.push(`MASK_ENVELOPE_VIOLATION ${surface} ${sel} ${r.borderBoxWidth}x${r.borderBoxHeight} 밖 [${envE.minW}..${envE.maxW}]x[${envE.minH}..${envE.maxH}]`);
          continue;
        }
        envHit.set(sel, {
          minW: Math.min((envHit.get(sel) || {}).minW ?? Infinity, r.borderBoxWidth),
          maxW: Math.max((envHit.get(sel) || {}).maxW ?? -Infinity, r.borderBoxWidth),
          minH: Math.min((envHit.get(sel) || {}).minH ?? Infinity, r.borderBoxHeight),
          maxH: Math.max((envHit.get(sel) || {}).maxH ?? -Infinity, r.borderBoxHeight),
        });
        const EPS = 1e-6;
        const want = derivePaintRect(r, outset);   // 러너가 쓰는 바로 그 함수
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
  // 5) 배율 표 ↔ occurrence 점유 **양방향** 일치.
  //    한 방향만 보면 우회가 남는다: 표에만 있으면 "쓰이지 않는 선언"이 방치되고(그 셀의 rect를
  //    지워 검사에서 도망칠 수 있다), occurrence에만 있으면 (a)에서 걸리지만 그건 rect 단위라
  //    빈 배열로 셀을 지우는 경우를 못 잡는다.
  for (const [surface, bysel] of Object.entries(scaleTable || {})) {
    if (!surfaceSet.has(surface)) { errors.push(`MASK_SCALE_UNKNOWN_SURFACE ${surface}`); continue; }
    if (!bysel || typeof bysel !== 'object') { errors.push(`MASK_SCALE_ROW_SHAPE ${surface}`); continue; }
    for (const sel of Object.keys(bysel)) {
      if (!specSels.has(sel)) errors.push(`MASK_SCALE_FOREIGN_SELECTOR ${surface} ${sel}`);
      else if (!(occupied.get(surface) || new Set()).has(sel)) errors.push(`MASK_SCALE_UNUSED ${surface} ${sel}`);
    }
  }
  for (const [surface, sels] of occupied) for (const sel of sels)
    if (!Object.prototype.hasOwnProperty.call((scaleTable || {})[surface] || {}, sel))
      errors.push(`MASK_SCALE_UNDECLARED_CELL ${surface} ${sel}`);

  // 6) envelope 극단 **도달** 검사 + 표 키 집합.
  //    범위 검사만으로는 max를 크게 적어 무력화할 수 있다. 선언한 극단이 실제로 관측돼야 한다.
  const envTable = spec.SELECTOR_SIZE_ENVELOPE || {};
  for (const sel of Object.keys(envTable)) if (!specSels.has(sel)) errors.push(`MASK_ENVELOPE_FOREIGN_SELECTOR ${sel}`);
  for (const sel of specSels) {
    const d = envTable[sel];
    if (!d) { errors.push(`MASK_ENVELOPE_UNDECLARED ${sel}`); continue; }
    for (const k of ['minW', 'maxW', 'minH', 'maxH'])
      if (!Number.isFinite(d[k]) || !(d[k] > 0)) errors.push(`MASK_ENVELOPE_SHAPE ${sel} ${k}`);
    if (q(d.minW) > q(d.maxW) || q(d.minH) > q(d.maxH)) errors.push(`MASK_ENVELOPE_INVERTED ${sel}`);
    const hit = envHit.get(sel);
    if (!hit) { errors.push(`MASK_ENVELOPE_UNREACHED ${sel}`); continue; }
    for (const k of ['minW', 'maxW', 'minH', 'maxH'])
      if (q(hit[k]) !== q(d[k])) errors.push(`MASK_ENVELOPE_SLACK ${sel} ${k} 선언=${d[k]} 실측=${hit[k]}`);
  }

  // 7) surface별 마스크 픽셀 예산 — 마스크가 화면을 얼마나 먹는지의 총량을 못박는다.
  //    개별 rect가 전부 계약을 지켜도 rect 수를 늘리거나 겹치게 배치해 면적을 키울 수 있었다.
  const budget = spec.MASK_PIXEL_BUDGET || {};
  const RCb = spec.RASTER_CONTRACT;
  if (!RCb || !Number.isFinite(RCb.width) || !Number.isFinite(RCb.height)) errors.push('MASK_BUDGET_NO_RASTER');
  else {
    for (const s of Object.keys(budget)) if (!surfaceSet.has(s)) errors.push(`MASK_BUDGET_UNKNOWN_SURFACE ${s}`);
    for (const surface of surfaceNames) {
      const want = budget[surface];
      if (!Number.isInteger(want) || want < 0) { errors.push(`MASK_BUDGET_UNDECLARED ${surface}`); continue; }
      const rects = [];
      for (const rs of Object.values((ctx.baseLightMaskRects || {})[surface] || {}))
        if (Array.isArray(rs)) for (const r of rs) if (r && r.paintRect) rects.push(r.paintRect);
      const got = countMaskedPixels(rects, RCb.width, RCb.height);
      if (got !== want) errors.push(`MASK_BUDGET_MISMATCH ${surface} ${got} != ${want}`);
    }
  }
  return errors;
}


export function validateSmokeCoverage(fixture, surfaces, spec) {
  const errors = [];
  const names = surfaces.map((x) => x.name);
  if (new Set(names).size !== names.length) errors.push('SURFACE_NAME_DUP');
  // selected를 만드는 op: 클릭, 또는 저장된 뷰를 **소비하는 goto**.
  // setStorage는 뺐다 — localStorage에 값을 쓰는 것은 DOM 상태를 증명하지 못한다.
  // 실증: canvas의 .TrackHeader__ViewBtn--active가 provenBy:0(setStorage)이었고, 러너가 그
  // 액션 직후에 단정하자 아직 이동 전인 화면을 검사해 RUN_STATE_UNPROVEN이 났다.
  const STATE_OPS = { hover: ['hover'], focus: ['click', 'focus'], selected: ['click', 'goto'] };
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
  // dataset 계약이 없으면 candidate 승인 자체가 성립하지 않는다 — fail-closed.
  errors.push(...validateDatasetContract(spec, buildActionContext(context)));
  errors.push(...validateScenarioCanon(spec, buildActionContext(context)));
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
  // depth/colorType/interlace도 돌려준다 — pixelmatch의 픽셀 해석을 바꿀 수 있는 축들이다.
  return { ok: true, width: img.width, height: img.height,
    depth: img.depth, colorType: img.colorType, interlace: !!img.interlace };
}

// ── raster 계약 ───────────────────────────────────────────────────────────────
// context가 신고한 캡처 조건이 정본 상수와 정확히 같은지. **단일 원천**이다 —
// 승인 경로(artifactsCore)와 public 픽셀 비교 경로(diffSurfaceLight)가 같은 함수를 쓴다.
// 이전에는 승인 경로에만 있었고 픽셀 비교 경로에는 없었다. 그래서 계약이 1440x900인데
// 40x40이나 3000x2000 PNG를 넘겨도 errors=0 diff=0 ok=true가 났다(실측).
// 두 곳에 따로 적으면 한쪽만 느슨해져 같은 구멍이 재개통된다.
export function validateRasterContext(ctx, spec) {
  const RC = spec && spec.RASTER_CONTRACT;
  if (!RC) return ['FROZEN_RASTER_CONTRACT_MISSING'];
  const errors = [];
  const vp = (ctx && ctx.viewport) || {};
  if (vp.width !== RC.width || vp.height !== RC.height)
    errors.push(`RASTER_CONTEXT_VIEWPORT ${vp.width}x${vp.height} != ${RC.width}x${RC.height}`);
  const cap = (ctx && ctx.capture) || {};
  if (cap.scale !== RC.screenshotScale) errors.push(`RASTER_SCREENSHOT_SCALE ${cap.scale} != ${RC.screenshotScale}`);
  if (cap.dpr !== RC.dpr) errors.push(`RASTER_DPR ${cap.dpr} != ${RC.dpr}`);
  return errors;
}

// PNG 바이트가 정본 raster 규격과 정확히 같은지. 치수는 **바이트에서 파생**한다(신고 금지).
// 색심도·컬러타입도 잠근다: legacy committed BASE 24개가 전부 depth 8 / colorType 2(RGB) / 비인터레이스다.
// (현재 target은 23이고 legacy 24는 promotion pending이다 — 두 숫자는 다른 것을 가리킨다.)
// 이게 없으면 팔레트 PNG나 16비트 PNG로 바꿔 pixelmatch의 픽셀 해석을 바꿀 수 있다.
export function validatePngRaster(bytes, spec, label) {
  const RC = spec && spec.RASTER_CONTRACT;
  if (!RC) return ['FROZEN_RASTER_CONTRACT_MISSING'];
  const hdr = decodePngHeader(bytes);
  if (!hdr.ok) return [`RASTER_PNG_DECODE ${label} ${hdr.reason}`];
  const errors = [];
  if (hdr.width !== RC.width || hdr.height !== RC.height)
    errors.push(`RASTER_PNG_SIZE ${label} ${hdr.width}x${hdr.height} != ${RC.width}x${RC.height}`);
  if (hdr.depth !== 8) errors.push(`RASTER_PNG_DEPTH ${label} ${hdr.depth} != 8`);
  if (hdr.colorType !== 2 && hdr.colorType !== 6) errors.push(`RASTER_PNG_COLOR_TYPE ${label} ${hdr.colorType}`);
  if (hdr.interlace) errors.push(`RASTER_PNG_INTERLACED ${label}`);
  return errors;
}

// ── action log 계약 ───────────────────────────────────────────────────────────
// context가 **커밋된 실행기로 만들어졌는지**를 승인 경로에서 강제한다.
//
// 왜: 실행기를 커밋해도 s4-gen은 디스크의 context를 읽을 뿐이므로, 손으로 만든 context를
// 그대로 승인시킬 수 있다. 실행기가 남긴 실행 기록을 계약으로 검사하면 그 경로가 막힌다.
// 실행 기록은 "어느 action이 어느 상태를 증명했는가"를 담으므로, 없으면 만들 수 없고
// 있으면 manifest와 대조 가능하다(선언만으로 통과하지 않는다).
//
// ⚠️ **이것은 provenance 증명이 아니다.** 로그의 모든 값은 spec에서 계산 가능하므로
// 브라우저 없이 만든 합성 로그는 이 검사를 통과한다(적대검증에서 실증). 값어치는
// "실행 주장이 명시되고 manifest와 교차검증된다"이지 "실행기를 우회할 수 없다"가 아니다.
// 환원 불가능한 신뢰 루트는 s4CaptureRunner.mjs 최상단에 적어 두었다.
//
// 검사 항목:
//  1) surface 키 집합 == manifest exact
//  2) 각 surface의 로그 길이·순서·op가 resolveActions 결과와 exact 일치
//  3) 단정 op(waitFor/expectPresent/expectAbsent)는 decided를 갖고, 그 값이 op의 기대와 맞는다
//  4) manifest가 선언한 상태 증거(state/produces)는 그 action 단계의 decided에서 visible>0
export function validateActionLog(spec, ctx) {
  const errors = [];
  const surfaces = spec.REQUIRED_SMOKE_SURFACES || [];
  const log = ctx.actionLog;
  if (!log || typeof log !== 'object' || Array.isArray(log)) return ['ACTIONLOG_MISSING'];
  const names = new Set(surfaces.map((x) => x.name));
  for (const k of Object.keys(log)) if (!names.has(k)) errors.push(`ACTIONLOG_UNKNOWN_SURFACE ${k}`);
  const intOk = (v) => Number.isInteger(v) && v >= 0;
  for (const surface of surfaces) {
    const entries = log[surface.name];
    if (!Array.isArray(entries)) { errors.push(`ACTIONLOG_SURFACE_MISSING ${surface.name}`); continue; }
    const { steps, errors: planErrors } = planSurface(surface, ctx);
    if (planErrors.length) { errors.push(...planErrors.map((e) => `ACTIONLOG_${e}`)); continue; }
    if (entries.length !== steps.length) {
      errors.push(`ACTIONLOG_LENGTH ${surface.name} ${entries.length}!=${steps.length}`);
      continue;
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i], e = entries[i], at = `${surface.name}[${i}]`;
      if (!e || typeof e !== 'object') { errors.push(`ACTIONLOG_ENTRY_SHAPE ${at}`); continue; }
      if (e.index !== i) errors.push(`ACTIONLOG_INDEX ${at} ${e.index}`);
      if (e.op !== s.op) errors.push(`ACTIONLOG_OP ${at} ${e.op} != ${s.op}`);
      if (!OP_SCHEMA[s.op]) { errors.push(`ACTIONLOG_UNKNOWN_OP ${at} ${s.op}`); continue; }
      const asserting = ['waitFor', 'expectPresent', 'expectAbsent'].includes(s.op);
      if (asserting) {
        const d = e.decided;
        if (!d || !intOk(d.count) || !intOk(d.visible)) { errors.push(`ACTIONLOG_NO_DECISION ${at} ${s.op}`); continue; }
        const wantVisible = !(s.op === 'expectAbsent' || (s.op === 'waitFor' && s.state === 'hidden'));
        if (wantVisible ? !(d.visible > 0) : d.visible !== 0)
          errors.push(`ACTIONLOG_DECISION_CONTRADICTS ${at} ${s.op} visible=${d.visible}`);
      }
      for (const p of s.postAssert || []) {
        const d = e.decided && e.decided[p.selector];
        if (!d || !intOk(d.count) || !intOk(d.visible)) { errors.push(`ACTIONLOG_STATE_UNRECORDED ${at} ${p.why} ${p.selector}`); continue; }
        if (!(d.visible > 0)) errors.push(`ACTIONLOG_STATE_UNPROVEN ${at} ${p.why} ${p.selector} visible=${d.visible}`);
      }
    }
  }
  return errors;
}

// ── phase별 증거 계약 ─────────────────────────────────────────────────────────
// 러너가 기록만 하고 아무도 검증하지 않으면, 지우거나 바꾼 뒤 해시를 다시 만들면 통과한다.
// coverageEvidence·darkReview·provenance를 승인 계약에 넣는다.
export function validateCaptureEvidence(spec, ctx, provenanceRefs) {
  const errors = [];
  const surfaces = spec.REQUIRED_SMOKE_SURFACES || [];
  const phase = ctx.phase;
  if (!['light', 'dark'].includes(phase)) return [`EVIDENCE_PHASE_INVALID ${String(phase)}`];
  // dataset 계약은 **무조건, 가장 먼저** 본다.
  // 이전 판은 `if (DATASET_ENDPOINTS.length)`로 감싸서 목록이 비면 dataset 증거가 통째로
  // 조용히 생략됐다. 게다가 provenanceRefs 조기 return 뒤에 두면 refs를 빼는 것만으로도
  // 계약 검사가 사라진다 — 계약 부재 자체가 실패여야 하므로 어떤 분기보다 앞이다.
  {
    const flatEarly = buildActionContext(ctx);
    errors.push(...validateDatasetContract(spec, flatEarly).map((e) => `EVIDENCE_${e}`));
    errors.push(...validateScenarioCanon(spec, flatEarly).map((e) => `EVIDENCE_${e}`));
    // 시나리오의 ID와 이름이 같은 대상을 가리키는지 원본 응답으로 대조한다.
    errors.push(...validateScenarioIdentity(flatEarly, ctx.datasetResponses).map((e) => `EVIDENCE_${e}`));
  }
  // provenance 대조 입력은 **필수**다. 생략하면 provenance의 존재만 보는 것이라 아무 의미가 없다.
  if (!provenanceRefs || typeof provenanceRefs !== 'object') return [...errors, 'EVIDENCE_PROVENANCE_REFS_REQUIRED'];
  const { headCommit, headBlobs, specFingerprintNow } = provenanceRefs;
  for (const [k, v] of [['headCommit', headCommit], ['specFingerprintNow', specFingerprintNow]])
    if (typeof v !== 'string' || !v) errors.push(`EVIDENCE_PROVENANCE_REF_MISSING ${k}`);
  if (!headBlobs || typeof headBlobs !== 'object') errors.push('EVIDENCE_PROVENANCE_REF_MISSING headBlobs');
  if (errors.length) return errors;

  const flat = buildActionContext(ctx);
  const resolveP = (v) => String(v).replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (flat[k] !== undefined ? String(flat[k]) : m));
  // evidence 항목의 스키마·범위. count/visible(또는 present)이 정수이고 0 <= seen <= count여야 한다.
  const checkEntry = (where, sel, v, kind) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`EVIDENCE_SHAPE ${where} ${sel}`); return null; }
    if (!Number.isInteger(v.count)) { errors.push(`EVIDENCE_NO_COUNT ${where} ${sel}`); return null; }
    const seen = kind === 'pseudo' ? v.present : v.visible;
    if (!Number.isInteger(seen)) { errors.push(`EVIDENCE_NO_${kind === 'pseudo' ? 'PRESENT' : 'VISIBLE'} ${where} ${sel}`); return null; }
    if (seen < 0 || seen > v.count) { errors.push(`EVIDENCE_RANGE ${where} ${sel} ${seen}/${v.count}`); return null; }
    return seen;
  };

  // 1) coverageEvidence: surface 집합 exact + **resolved selector 키 집합 exact** + 관측됨
  //    개수만 비교하면 `.Real`을 `.Bogus`로 바꿔도 통과한다(실증).
  const cov = ctx.coverageEvidence;
  if (!cov || typeof cov !== 'object' || Array.isArray(cov)) errors.push('EVIDENCE_COVERAGE_MISSING');
  else {
    const names = new Set(surfaces.map((x) => x.name));
    for (const k of Object.keys(cov)) if (!names.has(k)) errors.push(`EVIDENCE_COVERAGE_UNKNOWN_SURFACE ${k}`);
    for (const x of surfaces) {
      const got = cov[x.name];
      if (!got || typeof got !== 'object' || Array.isArray(got)) { errors.push(`EVIDENCE_COVERAGE_SURFACE_MISSING ${x.name}`); continue; }
      const wantPseudo = new Set(), want = new Set();
      for (const o of x.coverageSelectors || []) {
        if (o.locator && o.locator.pseudo) { const k = `${resolveP(o.locator.selector)}${o.locator.pseudo}`; want.add(k); wantPseudo.add(k); }
        else want.add(resolveP(o.selector));
      }
      for (const r of x.requiredElements || []) want.add(resolveP(r));
      const gotKeys = Object.keys(got).sort(), wantKeys = [...want].sort();
      if (JSON.stringify(gotKeys) !== JSON.stringify(wantKeys)) {
        errors.push(`EVIDENCE_COVERAGE_KEYSET ${x.name} missing=[${wantKeys.filter((k) => !gotKeys.includes(k))}] extra=[${gotKeys.filter((k) => !wantKeys.includes(k))}]`);
        continue;
      }
      for (const sel of wantKeys) {
        const seen = checkEntry(`coverage ${x.name}`, sel, got[sel], wantPseudo.has(sel) ? 'pseudo' : 'visible');
        if (seen !== null && !(seen > 0)) errors.push(`EVIDENCE_COVERAGE_UNSEEN ${x.name} ${sel} ${seen}`);
      }
    }
  }

  // 2) darkReview: dark phase에만, 선언 selector 집합 exact, pass가 관측과 **일관**
  if (phase === 'light') {
    if (ctx.darkReview !== undefined) errors.push('EVIDENCE_DARK_REVIEW_IN_LIGHT');
  } else {
    const dr = ctx.darkReview;
    if (!dr || typeof dr !== 'object' || Array.isArray(dr)) errors.push('EVIDENCE_DARK_REVIEW_MISSING');
    else {
      const names = new Set(surfaces.map((x) => x.name));
      for (const k of Object.keys(dr)) if (!names.has(k)) errors.push(`EVIDENCE_DARK_REVIEW_UNKNOWN_SURFACE ${k}`);
      for (const x of surfaces) {
        const got = dr[x.name];
        if (!got || typeof got !== 'object' || Array.isArray(got)) { errors.push(`EVIDENCE_DARK_REVIEW_SURFACE_MISSING ${x.name}`); continue; }
        const wantKeys = (x.darkReviewSelectors || []).map((v) => (String(v).includes('::')
          ? `${resolveP(String(v).slice(0, String(v).indexOf('::')))}${String(v).slice(String(v).indexOf('::'))}`
          : resolveP(v))).sort();
        const gotKeys = Object.keys(got).sort();
        if (JSON.stringify(gotKeys) !== JSON.stringify(wantKeys)) {
          errors.push(`EVIDENCE_DARK_REVIEW_KEYSET ${x.name} missing=[${wantKeys.filter((k) => !gotKeys.includes(k))}] extra=[${gotKeys.filter((k) => !wantKeys.includes(k))}]`);
          continue;
        }
        for (const sel of wantKeys) {
          const kind = sel.includes('::') ? 'pseudo' : 'visible';
          const seen = checkEntry(`darkReview ${x.name}`, sel, got[sel], kind);
          if (seen === null) continue;
          // pass는 자기신고다 — 관측값과 **일치**해야 한다.
          if (got[sel].pass !== (seen > 0)) errors.push(`EVIDENCE_DARK_REVIEW_PASS_INCONSISTENT ${x.name} ${sel} pass=${got[sel].pass} seen=${seen}`);
          if (!(seen > 0)) errors.push(`EVIDENCE_DARK_REVIEW_FAIL ${x.name} ${sel}`);
        }
      }
    }
  }

  // 3) provenance: 지금 HEAD·blob·fingerprint·dataset digest와 exact 대조
  const pv = ctx.provenance;
  if (!pv || typeof pv !== 'object' || Array.isArray(pv)) errors.push('EVIDENCE_PROVENANCE_MISSING');
  else {
    if (pv.headCommit !== headCommit) errors.push(`EVIDENCE_PROVENANCE_HEAD ${pv.headCommit} != ${headCommit}`);
    if (pv.specFingerprint !== specFingerprintNow) errors.push(`EVIDENCE_PROVENANCE_FINGERPRINT ${pv.specFingerprint} != ${specFingerprintNow}`);
    const got = pv.blobs || {};
    const gk = Object.keys(got).sort(), wk = Object.keys(headBlobs).sort();
    if (JSON.stringify(gk) !== JSON.stringify(wk)) errors.push(`EVIDENCE_PROVENANCE_BLOB_SET [${gk}] != [${wk}]`);
    for (const k of wk) if (got[k] !== headBlobs[k]) errors.push(`EVIDENCE_PROVENANCE_BLOB ${k}`);
    // dataset digest는 **원본 응답에서 재계산**한다 — 기록된 값을 그대로 믿으면 자기신고다.
    const rec = datasetDigest(ctx.datasetResponses, spec, (v) => createHash('sha256').update(v).digest('hex'));
    if (rec.errors.length) errors.push(...rec.errors.map((e) => `EVIDENCE_${e}`));
    else if (pv.datasetDigest !== rec.digest)
      errors.push(`EVIDENCE_PROVENANCE_DATASET ${pv.datasetDigest} != ${rec.digest}`);
    const urls = (ctx.datasetResponses || []).map((r) => r && r.url).sort();
    const want = (spec.DATASET_ENDPOINTS || []).map((u) => resolveTemplate(u, flat).url).sort();
    if (JSON.stringify(urls) !== JSON.stringify(want)) errors.push(`EVIDENCE_DATASET_ENDPOINT_SET [${urls}] != [${want}]`);
  }
  return errors;
}

// ── dataset 계약 ──────────────────────────────────────────────────────────────
// **EXPECTED_DATASET_MANIFEST가 단일 원천이다.** DATASET_ENDPOINTS는 거기서 파생되고,
// 이 검증기가 "파생이 실제로 유지되는가"까지 본다 — 두 번째 수기 배열이 생기면 여기서 죽는다.
//
// 왜 fail-closed인가: 이전 판은 `if ((spec.DATASET_ENDPOINTS||[]).length)`로 감쌌다.
// 목록이 비면 dataset 증거가 통째로 **조용히 생략**되고, 캡처는 아무 데이터에서나 찍혀도
// 통과했다. 계약이 없다는 사실 자체가 실패여야 한다.
export const DATASET_MANIFEST_TOP_KEYS = ['schemaVersion', 'evidence', 'dataset', 'ambient', 'dev'];
export const DATASET_MANIFEST_CATEGORIES = ['dataset', 'ambient', 'dev'];
export const DATASET_EVIDENCE_KEYS = ['observedHead', 'observedSpecFingerprint', 'discoveryDigest',
  'files', 'surfaceCount', 'semanticTupleCount', 'backendTupleCount', 'backendUniqueUrlCount'];
// observedHead는 **git commit(SHA-1, 40 hex)**이고 나머지는 SHA-256(64 hex)이다.
// 한 규칙으로 묶으면 둘 중 하나는 반드시 틀린 형식을 통과시키거나 정상값을 거부한다
// (positive control이 실제로 잡았다).
export const DATASET_EVIDENCE_COMMIT_KEYS = ['observedHead'];
export const DATASET_EVIDENCE_SHA_KEYS = ['observedSpecFingerprint', 'discoveryDigest'];
export const DATASET_ENTRY_KEYS = ['method', 'urlTemplate', 'reason',
  'observedSurfaceCount', 'observedRequestCount'];
// category 크기는 **상수로 박지 않는다.** 박으면 이 validator가 production 전용이 되어
// 작은 합성 world를 시험할 수 없고, 그러면 합성 테스트가 production manifest를 복사해
// 쓰게 된다(= 자기증명). 여기서는 **내부 정합성**만 본다:
//   backendUniqueUrlCount === dataset.length + ambient.length  (아래 evidence 교차검사)
// production의 17/1/2가 맞는지는 **커밋된 discovery 원문**을 읽는 verifyDiscoveryEvidence와
// SPEC 전용 테스트가 판정한다 — 증거가 원천이고 manifest가 피검사물이다.
// 헤더 뱃지 숫자는 픽셀에 직접 나온다 — dataset에서 빠지면 두 phase가 다른 숫자로 찍힐 수 있다.
export const DATASET_REQUIRED_BADGE_TEMPLATES = ['{apiOrigin}/chat', '{apiOrigin}/notifications/unread-count'];
// 알림 **목록**은 이번 S4 픽셀에 안 나온다(메뉴를 여는 surface가 없다). ambient 전용이다.
export const DATASET_AMBIENT_ONLY_TEMPLATES = ['{apiOrigin}/notifications?limit=30'];
// discovery는 GET만 관찰했다. 다른 method를 넣으려면 discovery를 다시 돌려 증거를 갱신해야 한다.
export const DATASET_ALLOWED_METHODS = ['GET'];
const SHA_RX = /^[0-9a-f]{64}$/;
const COMMIT_RX = /^[0-9a-f]{40}$/;
const PLACEHOLDER_RX = /\{([A-Za-z0-9_]+)\}/g;

// 템플릿의 {키}를 시나리오 값으로 치환한다. 남은 placeholder는 **해석 실패**다.
export function resolveTemplate(template, scenario) {
  const flat = scenario || {};
  const missing = [];
  const url = String(template).replace(PLACEHOLDER_RX, (m, k) => {
    if (flat[k] === undefined || flat[k] === null) { missing.push(k); return m; }
    return String(flat[k]);
  });
  return { url, missing };
}

// origin 문자열이 **origin으로서** 정당한지. 문자열 startsWith만 보면 userinfo·query·
// fragment가 섞인 값도 통과한다. URL 파서로 축을 하나씩 본다.
export function validateOriginValue(label, value, { allowBasePath }) {
  const errors = [];
  if (typeof value !== 'string' || !value) return [`ORIGIN_MISSING ${label}`];
  let u = null;
  try { u = new URL(value); } catch (e) { return [`ORIGIN_UNPARSEABLE ${label} ${value}`]; }
  if (!['http:', 'https:'].includes(u.protocol)) errors.push(`ORIGIN_SCHEME ${label} ${u.protocol}`);
  if (u.username || u.password) errors.push(`ORIGIN_USERINFO ${label}`);
  if (u.search) errors.push(`ORIGIN_SEARCH ${label}`);
  if (u.hash) errors.push(`ORIGIN_HASH ${label}`);
  const path = u.pathname.replace(/\/$/, '');
  if (!allowBasePath && path) errors.push(`ORIGIN_UNEXPECTED_PATH ${label} ${u.pathname}`);
  if (path.split('/').some((seg) => seg === '.' || seg === '..')) errors.push(`ORIGIN_DOT_SEGMENT ${label} ${u.pathname}`);
  // 정규화 후 문자열이 달라지면 값 자체가 canonical origin이 아니다.
  if (`${u.origin}${path}` !== value.replace(/\/$/, '')) errors.push(`ORIGIN_NOT_CANONICAL ${label} ${value}`);
  return errors;
}

// 해석된 절대 URL이 그 origin/base 안에 실제로 있는지 — 경로 탈출·dot-segment를 본다.
export function validateResolvedUrl(label, url, originValue) {
  const errors = [];
  const raw = String(url);
  // **파싱 전에** raw 문자열을 본다. new URL()은 dot-segment를 정규화해 없애 버리고,
  // percent-encoded 구분자(%2F·%2E)는 파싱 후 pathname에서 그대로 남아 눈에 안 띈다.
  const rawPath = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').replace(/^[^/?#]*/, '');
  const pathOnly = rawPath.split(/[?#]/)[0];
  for (const seg of pathOnly.split('/')) {
    if (seg === '.' || seg === '..') errors.push(`URL_RAW_DOT_SEGMENT ${label} ${seg}`);
    const dec = (() => { try { return decodeURIComponent(seg); } catch (e) { return null; } })();
    if (dec === null) errors.push(`URL_BAD_PERCENT ${label} ${seg}`);
    else if (dec !== seg && (dec === '.' || dec === '..' || dec.includes('/') || dec.includes('\\')))
      errors.push(`URL_ENCODED_SEPARATOR ${label} ${seg}`);
  }
  let u = null, o = null;
  try { u = new URL(raw); } catch (e) { return [`URL_UNPARSEABLE ${label} ${raw}`]; }
  // 정규화 결과가 원문과 다르면 원문이 canonical이 아니다 — 무엇을 관찰했는지가 흐려진다.
  if (u.href !== raw) errors.push(`URL_NOT_CANONICAL ${label} ${raw} -> ${u.href}`);
  try { o = new URL(originValue); } catch (e) { return [`URL_ORIGIN_UNPARSEABLE ${label}`]; }
  if (u.origin !== o.origin) errors.push(`URL_ORIGIN ${label} ${u.origin} != ${o.origin}`);
  if (u.username || u.password) errors.push(`URL_USERINFO ${label} ${raw}`);
  // fragment는 서버로 가지 않는다 — dataset URL에 있으면 관찰과 재조회가 어긋난다.
  // query는 정당하다(sources endpoint가 실제로 쓴다).
  if (u.hash) errors.push(`URL_HASH ${label} ${raw}`);
  const base = o.pathname.replace(/\/$/, '');
  if (base && !(u.pathname === base || u.pathname.startsWith(`${base}/`)))
    errors.push(`URL_BASE_PATH ${label} ${u.pathname} !⊂ ${base}`);
  if (u.pathname.split('/').some((seg) => seg === '.' || seg === '..'))
    errors.push(`URL_DOT_SEGMENT ${label} ${u.pathname}`);
  return errors;
}

// candidate context의 identity 필드가 **정본과 정확히 같은지**. 여기서 갈리면 화면과
// 데이터가 다른 대상을 가리킨다.
export function validateScenarioCanon(spec, context) {
  const errors = [];
  const canon = spec && spec.SCENARIO_CANON;
  const keys = (spec && spec.SCENARIO_CANON_KEYS) || [];
  if (!canon || typeof canon !== 'object' || Array.isArray(canon)) return ['SCENARIO_CANON_MISSING'];
  if (!Array.isArray(keys) || !keys.length) return ['SCENARIO_CANON_KEYS_MISSING'];
  if (!context || typeof context !== 'object' || Array.isArray(context)) return ['SCENARIO_CONTEXT_SHAPE'];
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(context, k)) { errors.push(`SCENARIO_FIELD_MISSING ${k}`); continue; }
    if (context[k] !== canon[k])
      errors.push(`SCENARIO_FIELD_MISMATCH ${k} ${JSON.stringify(context[k])} != ${JSON.stringify(canon[k])}`);
  }
  // ID는 양의 safe integer여야 한다 — 문자열 '13'은 URL은 만들어지지만 ID가 아니다.
  for (const k of ['trackId', 'bulkBranchId', 'bulkEpicId', 'scrumBoardId']) {
    const v = context[k];
    if (!Number.isSafeInteger(v) || v <= 0) errors.push(`SCENARIO_ID_INVALID ${k} ${JSON.stringify(v)}`);
  }
  errors.push(...validateOriginValue('apiOrigin', context.apiOrigin, { allowBasePath: true }));
  errors.push(...validateOriginValue('appOrigin', context.appOrigin, { allowBasePath: false }));
  return errors;
}

export function validateDatasetContract(spec, scenario) {
  // malformed 입력에서 **예외가 밖으로 새면 fail-closed가 아니다** — 호출부가 크래시하고
  // "무엇이 막았는지"가 사라진다. 어떤 입력이 와도 오류 배열을 돌려준다.
  try { return datasetContractErrors(spec, scenario); }
  catch (e) { return [`DATASET_CONTRACT_THREW ${(e && e.message) || e}`]; }
}

function datasetContractErrors(spec, scenario) {
  const errors = [];
  const man = spec ? spec.EXPECTED_DATASET_MANIFEST : undefined;
  if (man === null || man === undefined) return ['DATASET_MANIFEST_NULL'];
  if (typeof man !== 'object' || Array.isArray(man)) return ['DATASET_MANIFEST_SHAPE'];
  if (man.schemaVersion !== 1) errors.push(`DATASET_MANIFEST_SCHEMA_VERSION ${String(man.schemaVersion)}`);
  const topGot = Object.keys(man).sort(), topWant = [...DATASET_MANIFEST_TOP_KEYS].sort();
  if (JSON.stringify(topGot) !== JSON.stringify(topWant))
    errors.push(`DATASET_MANIFEST_FIELDS [${topGot}] != [${topWant}]`);

  const sc = scenario || {};
  const apiOrigin = sc.apiOrigin, appOrigin = sc.appOrigin;
  if (typeof apiOrigin !== 'string' || !apiOrigin) errors.push('DATASET_SCENARIO_API_ORIGIN_MISSING');
  if (typeof appOrigin !== 'string' || !appOrigin) errors.push('DATASET_SCENARIO_APP_ORIGIN_MISSING');
  // BulkAdd URL이 ID로 만들어진다 — 없으면 unresolved placeholder로 새어 나간다.
  for (const k of ['bulkBranchId', 'bulkEpicId'])
    if (!Number.isInteger(sc[k])) errors.push(`DATASET_SCENARIO_${k.toUpperCase()}_MISSING`);

  // ── category별 구조 ────────────────────────────────────────────────────────
  const seenTemplates = new Map();                 // urlTemplate -> category
  const seenResolved = new Map();                  // 'METHOD absoluteUrl' -> 위치
  for (const cat of DATASET_MANIFEST_CATEGORIES) {
    const list = man[cat];
    if (!Array.isArray(list)) { errors.push(`DATASET_CATEGORY_MISSING ${cat}`); continue; }
    if (!list.length && cat === 'dataset') { /* 아래 DATASET_ENDPOINTS_EMPTY가 잡는다 */ }
    const templates = [];
    for (let i = 0; i < list.length; i += 1) {
      const e = list[i], at = `${cat}[${i}]`;
      if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`DATASET_ENTRY_SHAPE ${at}`); continue; }
      const gk = Object.keys(e).sort(), wk = [...DATASET_ENTRY_KEYS].sort();
      if (JSON.stringify(gk) !== JSON.stringify(wk)) errors.push(`DATASET_ENTRY_FIELDS ${at} [${gk}] != [${wk}]`);
      if (!DATASET_ALLOWED_METHODS.includes(e.method)) errors.push(`DATASET_ENTRY_METHOD ${at} ${String(e.method)}`);
      if (typeof e.reason !== 'string' || !e.reason.trim()) errors.push(`DATASET_ENTRY_REASON ${at}`);
      for (const k of ['observedSurfaceCount', 'observedRequestCount'])
        if (!Number.isInteger(e[k]) || e[k] < 1) errors.push(`DATASET_ENTRY_${k.toUpperCase()} ${at} ${String(e[k])}`);
      // 관계식: 화면 수는 전체 화면 수를 넘을 수 없고, 요청 수는 화면 수보다 작을 수 없다.
      const evSurf = man.evidence && man.evidence.surfaceCount;
      if (Number.isInteger(e.observedSurfaceCount) && Number.isInteger(evSurf) && e.observedSurfaceCount > evSurf)
        errors.push(`DATASET_ENTRY_SURFACE_OVERFLOW ${at} ${e.observedSurfaceCount} > ${evSurf}`);
      if (Number.isInteger(e.observedSurfaceCount) && Number.isInteger(e.observedRequestCount)
        && e.observedRequestCount < e.observedSurfaceCount)
        errors.push(`DATASET_ENTRY_REQUEST_UNDERFLOW ${at} ${e.observedRequestCount} < ${e.observedSurfaceCount}`);
      const t = e.urlTemplate;
      if (typeof t !== 'string' || !t) { errors.push(`DATASET_ENTRY_URL_TEMPLATE ${at}`); continue; }
      templates.push(t);
      // category 간 교집합과 category 내 중복을 한 번에 본다.
      if (seenTemplates.has(t)) errors.push(`DATASET_TEMPLATE_DUPLICATE ${t} (${seenTemplates.get(t)}, ${cat})`);
      else seenTemplates.set(t, cat);
      // **상대 URL 금지.** origin이 빠지면 어느 서버의 응답인지가 계약에서 사라진다.
      if (t.startsWith('/')) { errors.push(`DATASET_RELATIVE_URL ${at} ${t}`); continue; }
      const wantOrigin = cat === 'dev' ? '{appOrigin}' : '{apiOrigin}';
      if (!t.startsWith(`${wantOrigin}/`)) { errors.push(`DATASET_ORIGIN_MISMATCH ${at} ${t} (want ${wantOrigin})`); continue; }
      const { url, missing } = resolveTemplate(t, sc);
      if (missing.length) { errors.push(`DATASET_UNRESOLVED_PLACEHOLDER ${at} {${missing.join('},{')}}`); continue; }
      const resolvedWant = cat === 'dev' ? appOrigin : apiOrigin;
      // 문자열 startsWith가 아니라 **URL 파서**로 본다 — userinfo·경로 탈출·dot-segment.
      if (typeof resolvedWant === 'string' && resolvedWant)
        errors.push(...validateResolvedUrl(at, url, resolvedWant).map((e) => `DATASET_${e}`));
      // 서로 다른 템플릿이 같은 절대 URL로 해석되면 관찰 대조에서 둘을 구분할 수 없다.
      const rk = `${e.method} ${url}`;
      if (seenResolved.has(rk)) errors.push(`DATASET_RESOLVED_DUPLICATE ${rk} (${seenResolved.get(rk)}, ${at})`);
      else seenResolved.set(rk, at);
    }
    const sorted = [...templates].sort();
    if (JSON.stringify(templates) !== JSON.stringify(sorted))
      errors.push(`DATASET_CATEGORY_UNSORTED ${cat}`);
  }

  // ── evidence ───────────────────────────────────────────────────────────────
  const ev = man.evidence;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) errors.push('DATASET_EVIDENCE_SHAPE');
  else {
    const gk = Object.keys(ev).sort(), wk = [...DATASET_EVIDENCE_KEYS].sort();
    if (JSON.stringify(gk) !== JSON.stringify(wk)) errors.push(`DATASET_EVIDENCE_FIELDS [${gk}] != [${wk}]`);
    for (const k of DATASET_EVIDENCE_COMMIT_KEYS)
      if (typeof ev[k] !== 'string' || !COMMIT_RX.test(ev[k])) errors.push(`DATASET_EVIDENCE_COMMIT ${k} ${String(ev[k])}`);
    for (const k of DATASET_EVIDENCE_SHA_KEYS)
      if (typeof ev[k] !== 'string' || !SHA_RX.test(ev[k])) errors.push(`DATASET_EVIDENCE_SHA ${k} ${String(ev[k])}`);
    // evidence.files는 **정확히 8개**의 {filename: sha256} exact map이다.
    if (!ev.files || typeof ev.files !== 'object' || Array.isArray(ev.files)) errors.push('DATASET_EVIDENCE_FILES_SHAPE');
    else {
      const gotF = Object.keys(ev.files).sort(), wantF = [...DISCOVERY_EVIDENCE_FILES].sort();
      if (JSON.stringify(gotF) !== JSON.stringify(wantF))
        errors.push(`DATASET_EVIDENCE_FILE_SET [${gotF}] != [${wantF}]`);
      for (const [k, v] of Object.entries(ev.files))
        if (typeof v !== 'string' || !SHA_RX.test(v)) errors.push(`DATASET_EVIDENCE_FILE_SHA ${k} ${String(v)}`);
    }
    // 개수는 **파생 대조**한다. 상수를 한 번 더 적으면 그 사본이 틀려도 아무도 모른다.
    const ds = Array.isArray(man.dataset) ? man.dataset : [];
    const am = Array.isArray(man.ambient) ? man.ambient : [];
    const dv = Array.isArray(man.dev) ? man.dev : [];
    const sum = (l) => l.reduce((a, e) => a + (Number.isInteger(e && e.observedSurfaceCount) ? e.observedSurfaceCount : 0), 0);
    const want = {
      surfaceCount: (spec.REQUIRED_SMOKE_SURFACES || []).length,
      backendUniqueUrlCount: ds.length + am.length,
      backendTupleCount: sum(ds) + sum(am),
      semanticTupleCount: sum(ds) + sum(am) + sum(dv),
    };
    for (const k of Object.keys(want))
      if (ev[k] !== want[k]) errors.push(`DATASET_EVIDENCE_COUNT ${k} ${String(ev[k])} != ${want[k]}`);
  }

  // ── 파생 무결성 + 필수 endpoint ────────────────────────────────────────────
  const ds = Array.isArray(man.dataset) ? man.dataset : [];
  if (!ds.length) errors.push('DATASET_ENDPOINTS_EMPTY');
  const derived = ds.map((e) => e && e.urlTemplate);
  const declared = spec.DATASET_ENDPOINTS;
  if (!Array.isArray(declared)) errors.push('DATASET_ENDPOINTS_NOT_ARRAY');
  else if (JSON.stringify(declared) !== JSON.stringify(derived))
    errors.push(`DATASET_ENDPOINTS_NOT_DERIVED [${declared}] != [${derived}]`);
  for (const t of DATASET_REQUIRED_BADGE_TEMPLATES)
    if (!derived.includes(t)) errors.push(`DATASET_BADGE_ENDPOINT_MISSING ${t}`);
  const ambient = Array.isArray(man.ambient) ? man.ambient : [];
  for (const t of DATASET_AMBIENT_ONLY_TEMPLATES) {
    if (derived.includes(t)) errors.push(`DATASET_AMBIENT_IN_DATASET ${t}`);
    if (!ambient.some((e) => e && e.urlTemplate === t)) errors.push(`DATASET_AMBIENT_MISSING ${t}`);
  }
  return errors;
}

// 시나리오의 **ID와 이름이 같은 대상을 가리키는지**를 실제 응답으로 대조한다.
// 필드명은 라이브 응답에서 확인한 것이다(추측 아님):
//   GET {apiOrigin}/branches            -> { status, branches: [{ branch_id, branch_name, ... }] }
//   GET {apiOrigin}/branches/{id}/epics -> { status, epics:    [{ epic_id,   epic_name,   ... }] }
// BulkAdd는 이름으로 클릭하고 URL은 ID로 만든다 — 둘이 갈라지면 화면과 데이터가 다른 대상이 된다.
export function validateScenarioIdentity(scenario, datasetResponses) {
  const errors = [];
  const sc = scenario || {};
  if (typeof sc.apiOrigin !== 'string' || !sc.apiOrigin) return ['IDENTITY_API_ORIGIN_MISSING'];
  if (!Array.isArray(datasetResponses)) return ['IDENTITY_RESPONSES_SHAPE'];
  const byUrl = new Map();
  for (const r of datasetResponses) if (r && typeof r === 'object') byUrl.set(String(r.url), r);
  const readList = (url, listKey) => {
    const r = byUrl.get(url);
    if (!r) { errors.push(`IDENTITY_RESPONSE_MISSING ${url}`); return null; }
    if (r.status !== 200) { errors.push(`IDENTITY_RESPONSE_STATUS ${url} ${String(r.status)}`); return null; }
    let body = null;
    try { body = JSON.parse(r.body); } catch (e) { errors.push(`IDENTITY_UNPARSEABLE ${url}`); return null; }
    // 이 API는 200으로도 실패를 돌려준다(`{status:false, code:'NEED_LOGIN'}` — 실측).
    // envelope을 안 보면 로그아웃 응답 위에서 신원 대조가 "목록 없음"으로만 보인다.
    if (!body || body.status !== true) { errors.push(`IDENTITY_ENVELOPE ${url} status=${JSON.stringify(body && body.status)}`); return null; }
    const list = body && body[listKey];
    if (!Array.isArray(list)) { errors.push(`IDENTITY_LIST_MISSING ${url} .${listKey}`); return null; }
    return list;
  };
  const check = (label, url, listKey, idKey, nameKey, wantId, wantName) => {
    if (!Number.isInteger(wantId)) { errors.push(`IDENTITY_ID_MISSING ${label}`); return; }
    if (typeof wantName !== 'string' || !wantName) { errors.push(`IDENTITY_NAME_MISSING ${label}`); return; }
    const list = readList(url, listKey);
    if (!list) return;
    const hit = list.find((x) => x && x[idKey] === wantId);
    if (!hit) { errors.push(`IDENTITY_ENTRY_ABSENT ${label} ${idKey}=${wantId}`); return; }
    if (hit[nameKey] !== wantName)
      errors.push(`IDENTITY_NAME_MISMATCH ${label} ${idKey}=${wantId} ${JSON.stringify(hit[nameKey])} != ${JSON.stringify(wantName)}`);
  };
  check('branch', `${sc.apiOrigin}/branches`, 'branches', 'branch_id', 'branch_name', sc.bulkBranchId, sc.branchName);
  check('epic', `${sc.apiOrigin}/branches/${sc.bulkBranchId}/epics`, 'epics', 'epic_id', 'epic_name', sc.bulkEpicId, sc.epicName);
  return errors;
}

// discovery 원문(bySurface)은 **동시 요청 완료 순서**를 보존한다 — producer는 건드리지 않는다.
// 비교는 이 경계에서만 canonicalize한다: surface는 정본 순서, entry는 method+URL lexical.
export function canonicalObservation(bySurface, surfaceOrder) {
  if (!bySurface || typeof bySurface !== 'object' || Array.isArray(bySurface)) return null;
  const known = Array.isArray(surfaceOrder) ? surfaceOrder : [];
  const names = Object.keys(bySurface);
  const rank = new Map(known.map((n, i) => [n, i]));
  names.sort((x, y) => {
    const rx = rank.has(x) ? rank.get(x) : known.length, ry = rank.has(y) ? rank.get(y) : known.length;
    return rx !== ry ? rx - ry : (x < y ? -1 : 1);
  });
  return names.map((n) => {
    const m = bySurface[n] || {};
    return [n, Object.keys(m).sort().map((k) => [k, m[k]])];
  });
}

// canonical 관찰이 manifest가 신고한 endpoint 집합·횟수와 맞는지.
// 순서만 다른 주입은 GREEN, 누락·추가·count 변경은 RED여야 한다.
export function validateDiscoveryObservation(bySurface, spec, scenario) {
  const errors = [];
  const canon = canonicalObservation(bySurface, (spec.REQUIRED_SMOKE_SURFACES || []).map((x) => x.name));
  if (!canon) return ['OBSERVATION_SHAPE'];
  const man = spec.EXPECTED_DATASET_MANIFEST;
  if (!man) return ['OBSERVATION_MANIFEST_NULL'];
  const all = [...(man.dataset || []), ...(man.ambient || []), ...(man.dev || [])];
  const want = new Map();                          // resolved "METHOD url" -> {surfaces, requests}
  for (const e of all) {
    const { url, missing } = resolveTemplate(e.urlTemplate, scenario || {});
    if (missing.length) { errors.push(`OBSERVATION_UNRESOLVED ${e.urlTemplate}`); continue; }
    want.set(`${e.method} ${url}`, { surfaces: e.observedSurfaceCount, requests: e.observedRequestCount });
  }
  const gotSurfaces = new Map(), gotRequests = new Map();
  for (const [, entries] of canon) {
    for (const [k, n] of entries) {
      // bySurface 키는 "METHOD url status" 형태다 — status를 떼어 manifest 키와 맞춘다.
      const key = String(k).replace(/\s+\d+$/, '');
      gotSurfaces.set(key, (gotSurfaces.get(key) || 0) + 1);
      gotRequests.set(key, (gotRequests.get(key) || 0) + (Number(n) || 0));
    }
  }
  for (const k of [...want.keys()].sort()) if (!gotSurfaces.has(k)) errors.push(`OBSERVATION_ENDPOINT_MISSING ${k}`);
  for (const k of [...gotSurfaces.keys()].sort()) if (!want.has(k)) errors.push(`OBSERVATION_ENDPOINT_EXTRA ${k}`);
  for (const k of [...want.keys()].sort()) {
    if (!gotSurfaces.has(k)) continue;
    const w = want.get(k);
    if (gotSurfaces.get(k) !== w.surfaces) errors.push(`OBSERVATION_SURFACE_COUNT ${k} ${gotSurfaces.get(k)} != ${w.surfaces}`);
    if (gotRequests.get(k) !== w.requests) errors.push(`OBSERVATION_REQUEST_COUNT ${k} ${gotRequests.get(k)} != ${w.requests}`);
  }
  return errors;
}

// ── discovery 증거 (독립 검증) ────────────────────────────────────────────────
// **방향이 중요하다.** manifest 값으로 기대 관찰을 합성해 비교하면 manifest가 자기를 증명한다.
// 여기서는 반대로 간다: 커밋된 Run A/B **raw 바이트**에서 tuple을 파생하고, manifest가 그
// 관찰과 맞는지 본다. 증거가 원천이고 manifest가 피검사물이다.
//
// 동결 단위: { surface, method, absoluteUrl, status, ok, count }
// producer의 삽입 순서는 감사용으로 보존하고, 비교 경계에서만 canonicalize한다
// (surface = 정본 순서, tuple = lexical).
export const DISCOVERY_EVIDENCE_FILES = ['runA.out', 'runB.out', 'runA.err', 'runB.err',
  'runA.code', 'runB.code', 'runA.adapter.json', 'runB.adapter.json'];
const ENDPOINT_RX = /^(\S+) ([A-Z]+) (\S+) (\d+) (ok|fail) x(\d+)$/;

// payload의 endpoints 줄을 tuple로 판다. 형식이 어긋나면 오류로 남긴다(조용히 건너뛰지 않는다).
export function discoveryTuples(payload) {
  const errors = [], tuples = [];
  const list = payload && payload.endpoints;
  if (!Array.isArray(list)) return { tuples: null, errors: ['EVIDENCE_ENDPOINTS_SHAPE'] };
  for (const line of list) {
    const m = ENDPOINT_RX.exec(String(line));
    if (!m) { errors.push(`EVIDENCE_ENDPOINT_UNPARSEABLE ${line}`); continue; }
    tuples.push({ surface: m[1], method: m[2], absoluteUrl: m[3],
      status: Number(m[4]), ok: m[5] === 'ok', count: Number(m[6]) });
  }
  return { tuples, errors };
}

// 비교 경계의 정규화. 알려진 surface는 정본 순서, 나머지는 뒤에 lexical.
export function canonicalTuples(tuples, surfaceOrder) {
  const rank = new Map((surfaceOrder || []).map((n, i) => [n, i]));
  const key = (t) => `${t.method} ${t.absoluteUrl} ${t.status} ${t.ok ? 'ok' : 'fail'} x${t.count}`;
  return [...tuples].sort((a, b) => {
    const ra = rank.has(a.surface) ? rank.get(a.surface) : rank.size;
    const rb = rank.has(b.surface) ? rank.get(b.surface) : rank.size;
    if (ra !== rb) return ra - rb;
    if (a.surface !== b.surface) return a.surface < b.surface ? -1 : 1;
    return key(a) < key(b) ? -1 : 1;
  }).map((t) => `${t.surface} ${key(t)}`);
}

// bySurface(감사 원문)에서 독립적으로 count를 재파생해 endpoints와 교차 대조한다.
function countsFromBySurface(payload) {
  const out = new Map();
  const by = payload && payload.bySurface;
  if (!by || typeof by !== 'object' || Array.isArray(by)) return null;
  for (const surface of Object.keys(by)) {
    const m = by[surface];
    if (!m || typeof m !== 'object') return null;
    for (const k of Object.keys(m)) out.set(`${surface} ${k}`, m[k]);
  }
  return out;
}

// raw 바이트 → 오류 배열. spec/scenario는 피검사물이다.
export function verifyDiscoveryEvidence({ files, spec, scenario, sha256Hex, gitBlob }) {
  const errors = [];
  if (!files || typeof files !== 'object') return ['EVIDENCE_FILES_REQUIRED'];
  for (const n of DISCOVERY_EVIDENCE_FILES)
    if (typeof files[n] !== 'string') errors.push(`EVIDENCE_FILE_MISSING ${n}`);
  if (errors.length) return errors;
  const man = spec && spec.EXPECTED_DATASET_MANIFEST;
  if (!man || typeof man !== 'object') return ['EVIDENCE_MANIFEST_NULL'];
  const ev = man.evidence;
  if (!ev || typeof ev !== 'object') return ['EVIDENCE_MANIFEST_EVIDENCE_SHAPE'];

  // 1) raw SHA-256을 바이트에서 재계산해 manifest가 신고한 값과 대조한다.
  // **8파일 전부** 바이트 해시를 대조한다. 파일 집합(actual)도 exact 8이어야 한다.
  const gotFiles = Object.keys(files).sort(), wantFiles = [...DISCOVERY_EVIDENCE_FILES].sort();
  if (JSON.stringify(gotFiles) !== JSON.stringify(wantFiles))
    errors.push(`EVIDENCE_ACTUAL_FILE_SET [${gotFiles}] != [${wantFiles}]`);
  const expectFiles = (ev.files && typeof ev.files === 'object' && !Array.isArray(ev.files)) ? ev.files : null;
  if (!expectFiles) errors.push('EVIDENCE_EXPECTED_FILES_MISSING');
  else {
    const expKeys = Object.keys(expectFiles).sort();
    if (JSON.stringify(expKeys) !== JSON.stringify(wantFiles))
      errors.push(`EVIDENCE_EXPECTED_FILE_SET [${expKeys}] != [${wantFiles}]`);
    for (const n of DISCOVERY_EVIDENCE_FILES) {
      if (typeof files[n] !== 'string') continue;
      const got = sha256Hex(files[n]);
      if (got !== expectFiles[n]) errors.push(`EVIDENCE_FILE_SHA ${n} ${got} != ${expectFiles[n]}`);
    }
  }
  for (const n of ['runA.code', 'runB.code'])
    if (files[n].trim() !== '0') errors.push(`EVIDENCE_EXIT_CODE ${n} ${files[n].trim()}`);

  // 2) 두 payload를 판다.
  const parsed = {};
  for (const n of ['runA.out', 'runB.out']) {
    try { parsed[n] = JSON.parse(files[n]); }
    catch (e) { errors.push(`EVIDENCE_UNPARSEABLE ${n}`); }
  }
  if (errors.length) return errors;
  const A = parsed['runA.out'], B = parsed['runB.out'];

  const names = (spec.REQUIRED_SMOKE_SURFACES || []).map((x) => x.name);
  // 정본 목록 **자체**를 먼저 검증한다. 배열/문자열/정규형/중복/개수를 보지 않으면
  // duplicate append가 Set으로 흡수돼 조용히 통과한다(실증: 9건 오류인데 git은 9회 호출).
  const rawPaths = spec.PROVENANCE_BLOB_PATHS;
  const canonErrors = [];
  if (!Array.isArray(rawPaths) || !rawPaths.length) canonErrors.push('EVIDENCE_PROVENANCE_PATHS_MISSING');
  else {
    for (const p of rawPaths) {
      if (typeof p !== 'string' || !p) { canonErrors.push(`EVIDENCE_PROVENANCE_PATH_TYPE ${String(p)}`); continue; }
      if (p !== p.trim() || p.startsWith('/') || p.endsWith('/'))
        canonErrors.push(`EVIDENCE_PROVENANCE_PATH_NOT_CANONICAL ${p}`);
      if (p.split('/').some((seg) => !seg || seg === '.' || seg === '..'))
        canonErrors.push(`EVIDENCE_PROVENANCE_PATH_SEGMENT ${p}`);
      if (p.includes('\\')) canonErrors.push(`EVIDENCE_PROVENANCE_PATH_BACKSLASH ${p}`);
    }
    const seenP = new Set();
    for (const p of rawPaths) {
      if (seenP.has(p)) canonErrors.push(`EVIDENCE_PROVENANCE_PATH_DUPLICATE ${p}`);
      seenP.add(p);
    }
    if (seenP.size !== rawPaths.length)
      canonErrors.push(`EVIDENCE_PROVENANCE_PATH_CARDINALITY ${seenP.size} != ${rawPaths.length}`);
  }
  if (canonErrors.length) return [...errors, ...canonErrors];
  const wantPaths = [...rawPaths].sort();
  const wantSet = new Set(wantPaths);
  let pathSetOk = true;
  for (const [label, p] of [['A', A], ['B', B]]) {
    if (p.mode !== 'discovery') errors.push(`EVIDENCE_MODE_${label} ${String(p.mode)}`);
    if (p.eligibleForManifest !== true) errors.push(`EVIDENCE_ELIGIBLE_${label} ${String(p.eligibleForManifest)}`);
    if (p.surfacesCompleted !== names.length) errors.push(`EVIDENCE_SURFACES_COMPLETED_${label} ${p.surfacesCompleted} != ${names.length}`);
    const got = [...(p.surfaces || [])].sort(), want = [...names].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`EVIDENCE_SURFACE_SET_${label}`);
    const pv = p.provenance || {};
    if (pv.headCommit !== ev.observedHead) errors.push(`EVIDENCE_HEAD_${label} ${pv.headCommit} != ${ev.observedHead}`);
    if (pv.specFingerprint !== ev.observedSpecFingerprint) errors.push(`EVIDENCE_FINGERPRINT_${label}`);
    // **경로 집합 exact.** 개수만 세면 임의의 실제 repo 파일 9개를 올바른 OID와 함께
    // 넣어도 통과한다(실증). 정본 목록과 정확히 같아야 한다.
    const blobs = pv.blobs || {};
    const gotPaths = Object.keys(blobs).sort();
    if (JSON.stringify(gotPaths) !== JSON.stringify(wantPaths)) {
      pathSetOk = false;
      for (const k of gotPaths) if (!wantSet.has(k)) errors.push(`EVIDENCE_BLOB_PATH_EXTRA_${label} ${k}`);
      for (const k of wantPaths) if (!gotPaths.includes(k)) errors.push(`EVIDENCE_BLOB_PATH_MISSING_${label} ${k}`);
    }
    for (const [k, v] of Object.entries(blobs))
      if (typeof v !== 'string' || !/^[0-9a-f]{40}$/.test(v)) errors.push(`EVIDENCE_BLOB_FORMAT_${label} ${k}`);
    if (p.digest !== ev.discoveryDigest) errors.push(`EVIDENCE_DIGEST_${label} ${p.digest} != ${ev.discoveryDigest}`);
  }
  if (JSON.stringify(A.provenance) !== JSON.stringify(B.provenance)) errors.push('EVIDENCE_PROVENANCE_A_NE_B');

  // 2b) 두 payload 모두 endpoints ↔ bySurface **양방향 exact**.
  for (const [label, p] of [['A', A], ['B', B]]) {
    const t = discoveryTuples(p);
    if (!t.tuples) { errors.push(`EVIDENCE_ENDPOINTS_SHAPE_${label}`); continue; }
    const by = countsFromBySurface(p);
    if (!by) { errors.push(`EVIDENCE_BYSURFACE_SHAPE_${label}`); continue; }
    const bySurfaceNames = Object.keys(p.bySurface || {});
    const nameSet = new Set(names);
    for (const n of bySurfaceNames) if (!nameSet.has(n)) errors.push(`EVIDENCE_BYSURFACE_UNKNOWN_SURFACE_${label} ${n}`);
    for (const n of names) if (!bySurfaceNames.includes(n)) errors.push(`EVIDENCE_BYSURFACE_SURFACE_MISSING_${label} ${n}`);
    const fromT = new Map();
    for (const x of t.tuples) {
      const k = `${x.surface} ${x.method} ${x.absoluteUrl} ${x.status}`;
      if (fromT.has(k)) errors.push(`EVIDENCE_DUPLICATE_TUPLE_${label} ${k}`);
      fromT.set(k, x.count);
    }
    for (const [k, n] of fromT) {
      if (!by.has(k)) { errors.push(`EVIDENCE_BYSURFACE_KEY_MISSING_${label} ${k}`); continue; }
      if (by.get(k) !== n) errors.push(`EVIDENCE_BYSURFACE_COUNT_${label} ${k} ${by.get(k)} != ${n}`);
    }
    for (const k of by.keys()) if (!fromT.has(k)) errors.push(`EVIDENCE_BYSURFACE_KEY_EXTRA_${label} ${k}`);
    // producer 공식과 **같은 식**으로 digest를 재계산한다: `surface method url status ok xN`
    // 을 정렬해 개행으로 잇고 sha256. payload가 신고한 digest와 exact 대조한다.
    const lines = t.tuples
      .map((x) => `${x.surface} ${x.method} ${x.absoluteUrl} ${x.status} ${x.ok ? 'ok' : 'fail'} x${x.count}`)
      .sort();
    const recomputed = sha256Hex(lines.join('\n'));
    if (recomputed !== p.digest) errors.push(`EVIDENCE_DIGEST_RECOMPUTE_${label} ${recomputed} != ${p.digest}`);
    if (recomputed !== ev.discoveryDigest) errors.push(`EVIDENCE_DIGEST_VS_MANIFEST_${label} ${recomputed} != ${ev.discoveryDigest}`);
  }

  // 2c) provenance blob을 observedHead의 Git tree와 exact 대조한다.
  // **gitBlob 생략은 fail-closed다.** 이전 판은 함수가 없으면 이 검사를 통째로 건너뛰어,
  // "그 커밋의 그 파일"이라는 주장을 아무도 확인하지 않았다(실증: 생략 시 errors === []).
  if (typeof gitBlob !== 'function') errors.push('EVIDENCE_GIT_RESOLVER_REQUIRED');
  else if (!COMMIT_RX.test(String(ev.observedHead))) errors.push(`EVIDENCE_GIT_REF_INVALID ${ev.observedHead}`);
  else if (!pathSetOk) errors.push('EVIDENCE_BLOB_PATH_SET_INVALID (Git resolver 미호출)');
  else {
    const blobs = (A.provenance || {}).blobs || {};
    for (const rel of Object.keys(blobs).sort()) {
      // **Git을 부르기 전에** 정본 집합 멤버인지 본다. 그래야 경로에 shell metacharacter가
      // 섞여도 호출 자체가 일어나지 않는다.
      if (!wantSet.has(rel)) { errors.push(`EVIDENCE_BLOB_PATH_NOT_CANON ${rel}`); continue; }
      const want = gitBlob(ev.observedHead, rel);
      if (typeof want !== 'string' || !/^[0-9a-f]{40}$/.test(want)) errors.push(`EVIDENCE_BLOB_UNRESOLVED ${rel}`);
      else if (want !== blobs[rel]) errors.push(`EVIDENCE_BLOB_OID ${rel} ${blobs[rel]} != ${want}`);
    }
  }

  // 2d) stderr / adapter sidecar — **역할 구분**.
  // .err는 프로세스 출력(authoritative): FATAL 부재와 정상 종료 문구를 요구한다.
  // .adapter.json은 MCP 반환값의 **전사**다(어댑터는 파일을 쓰지 않는다). 승인 오라클로
  // 쓰지 않고 형태만 본다 — 여기서 lifecycle을 "증명"했다고 주장하면 과장이다.
  for (const n of ['runA.err', 'runB.err']) {
    const t = files[n];
    if (/FATAL|Error:|Traceback|BRIDGE_SHUTDOWN_UNACKED|OBSERVE_INCOMPLETE|HEAD_BINDING/.test(t))
      errors.push(`EVIDENCE_STDERR_FATAL ${n}`);
    if (!/discovery 완료/.test(t)) errors.push(`EVIDENCE_STDERR_NO_COMPLETION ${n}`);
  }
  for (const n of ['runA.adapter.json', 'runB.adapter.json']) {
    let arr = null;
    try { arr = JSON.parse(files[n]); } catch (e) { errors.push(`EVIDENCE_ADAPTER_UNPARSEABLE ${n}`); continue; }
    if (!Array.isArray(arr) || !arr.length) { errors.push(`EVIDENCE_ADAPTER_EMPTY ${n}`); continue; }
    if (arr.some((x) => typeof x === 'string' && x.includes('ERR:'))) errors.push(`EVIDENCE_ADAPTER_ERR ${n}`);
    for (const m of ['hello', 'beginAttempt', 'endAttempt', 'shutdown', 'clean-exit'])
      if (!arr.includes(m)) errors.push(`EVIDENCE_ADAPTER_NO_${m.toUpperCase().replace('-', '_')} ${n}`);
  }

  // 3) tuple 파생 + Run A/B canonical equality
  const ta = discoveryTuples(A), tb = discoveryTuples(B);
  errors.push(...ta.errors.map((e) => `${e} [A]`), ...tb.errors.map((e) => `${e} [B]`));
  if (!ta.tuples || !tb.tuples) return errors;
  const ca = canonicalTuples(ta.tuples, names), cb = canonicalTuples(tb.tuples, names);
  if (JSON.stringify(ca) !== JSON.stringify(cb)) {
    const sa = new Set(ca), sb = new Set(cb);
    for (const x of ca) if (!sb.has(x)) errors.push(`EVIDENCE_TUPLE_ONLY_A ${x}`);
    for (const x of cb) if (!sa.has(x)) errors.push(`EVIDENCE_TUPLE_ONLY_B ${x}`);
  }
  // surface가 정본 집합 밖이면 즉시 오류(ghost surface).
  for (const t of ta.tuples) if (!names.includes(t.surface)) errors.push(`EVIDENCE_UNKNOWN_SURFACE ${t.surface}`);
  for (const t of ta.tuples) {
    if (t.status !== 200) errors.push(`EVIDENCE_NON_200 ${t.surface} ${t.absoluteUrl} ${t.status}`);
    if (t.ok !== true) errors.push(`EVIDENCE_NOT_OK ${t.surface} ${t.absoluteUrl}`);
    if (t.method !== 'GET') errors.push(`EVIDENCE_NON_GET ${t.surface} ${t.method} ${t.absoluteUrl}`);
    if (!(t.count >= 1)) errors.push(`EVIDENCE_BAD_COUNT ${t.surface} ${t.absoluteUrl} ${t.count}`);
  }
  // 감사 원문(bySurface)에서 독립 재파생한 count와 교차 대조 — 두 표현이 갈리면 오류다.
  const byA = countsFromBySurface(A);
  if (!byA) errors.push('EVIDENCE_BYSURFACE_SHAPE');
  else for (const t of ta.tuples) {
    const k = `${t.surface} ${t.method} ${t.absoluteUrl} ${t.status}`;
    if (byA.get(k) !== t.count) errors.push(`EVIDENCE_COUNT_CROSSCHECK ${k} ${byA.get(k)} != ${t.count}`);
  }

  // 4) 관찰된 endpoint universe와 manifest category union이 정확히 같은가.
  const observedUrls = new Set(ta.tuples.map((t) => `${t.method} ${t.absoluteUrl}`));
  const declared = new Map();
  for (const cat of ['dataset', 'ambient', 'dev']) {
    for (const e of (man[cat] || [])) {
      const { url, missing } = resolveTemplate(e.urlTemplate, scenario || {});
      if (missing.length) { errors.push(`EVIDENCE_UNRESOLVED ${e.urlTemplate}`); continue; }
      declared.set(`${e.method} ${url}`, { cat, e });
    }
  }
  for (const k of [...observedUrls].sort()) if (!declared.has(k)) errors.push(`EVIDENCE_ENDPOINT_UNDECLARED ${k}`);
  for (const k of [...declared.keys()].sort()) if (!observedUrls.has(k)) errors.push(`EVIDENCE_ENDPOINT_UNOBSERVED ${k}`);

  // 4b) manifest category ↔ **사람 검수 동결본** exact 대조.
  // raw 증거는 픽셀 영향도를 판단할 수 없다 — 그 판단은 별도 artifact로 동결하고 여기서 맞춘다.
  const declaredCat = new Map();
  for (const cat of ['dataset', 'ambient', 'dev'])
    for (const e of (man[cat] || [])) declaredCat.set(e.urlTemplate, cat);
  // 검수 표는 **spec 데이터**다(주입 인자가 아니다). spec마다 단일 원천이고 fingerprint
  // 입력이므로, 표를 바꾸면 산출물의 지문이 바뀐다.
  const reviewed = spec.REVIEWED_CLASSIFICATION;
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)) {
    errors.push('EVIDENCE_REVIEWED_MISSING');
    return errors;
  }
  for (const t of Object.keys(reviewed).sort()) {
    if (!declaredCat.has(t)) { errors.push(`EVIDENCE_REVIEWED_NOT_IN_MANIFEST ${t}`); continue; }
    if (declaredCat.get(t) !== reviewed[t])
      errors.push(`EVIDENCE_REVIEWED_CATEGORY ${t} manifest=${declaredCat.get(t)} reviewed=${reviewed[t]}`);
  }
  for (const t of [...declaredCat.keys()].sort())
    if (!Object.prototype.hasOwnProperty.call(reviewed, t)) errors.push(`EVIDENCE_MANIFEST_NOT_REVIEWED ${t}`);

  // 5) manifest가 신고한 관찰 횟수가 증거와 맞는가 (**증거 → manifest 방향**).
  for (const [k, { e }] of [...declared.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const hits = ta.tuples.filter((t) => `${t.method} ${t.absoluteUrl}` === k);
    if (!hits.length) continue;
    const surf = new Set(hits.map((t) => t.surface)).size;
    const req = hits.reduce((a, t) => a + t.count, 0);
    if (e.observedSurfaceCount !== surf) errors.push(`EVIDENCE_MANIFEST_SURFACE_COUNT ${k} ${e.observedSurfaceCount} != ${surf}`);
    if (e.observedRequestCount !== req) errors.push(`EVIDENCE_MANIFEST_REQUEST_COUNT ${k} ${e.observedRequestCount} != ${req}`);
  }
  // evidence의 집계값도 증거에서 재계산한다.
  const backend = ta.tuples.filter((t) => declared.get(`${t.method} ${t.absoluteUrl}`)
    && declared.get(`${t.method} ${t.absoluteUrl}`).cat !== 'dev');
  if (ev.semanticTupleCount !== ta.tuples.length)
    errors.push(`EVIDENCE_SEMANTIC_TUPLE_COUNT ${ev.semanticTupleCount} != ${ta.tuples.length}`);
  if (ev.backendTupleCount !== backend.length)
    errors.push(`EVIDENCE_BACKEND_TUPLE_COUNT ${ev.backendTupleCount} != ${backend.length}`);
  const uniqBackend = new Set(backend.map((t) => `${t.method} ${t.absoluteUrl}`)).size;
  if (ev.backendUniqueUrlCount !== uniqBackend)
    errors.push(`EVIDENCE_BACKEND_UNIQUE_URL ${ev.backendUniqueUrlCount} != ${uniqBackend}`);
  if (ev.surfaceCount !== names.length)
    errors.push(`EVIDENCE_SURFACE_COUNT ${ev.surfaceCount} != ${names.length}`);
  return errors;
}

// ── dataset digest ────────────────────────────────────────────────────────────
// **검증기가 raw 응답에서 직접 계산한다.** 브리지나 candidate가 준 digest를 그대로 쓰면
// 자기신고다. 휘발 필드를 제거하고 정렬한 뒤 canonicalize해서 해시한다.
export function datasetDigest(responses, spec, sha256Hex) {
  const errors = [];
  if (!Array.isArray(responses)) return { digest: null, errors: ['DATASET_RESPONSES_SHAPE'] };
  const volatile = spec.DATASET_VOLATILE_FIELDS || {};
  const unordered = new Set(spec.DATASET_UNORDERED_PATHS || []);
  // **배열 순서는 기본 보존한다.** 전부 정렬하면 UI 정렬 변화(에픽 순서·아이템 순서)가
  // digest에 안 보인다 — 실측: [1,2]와 [2,1]의 digest가 같았다.
  // 정말 순서가 의미 없는 endpoint+JSON path만 명시적으로 정렬한다.
  const strip = (v, url, path) => {
    if (Array.isArray(v)) {
      const mapped = v.map((x, i) => strip(x, url, `${path}[]`));
      return unordered.has(`${url}${path}[]`)
        ? mapped.slice().sort((a, b) => (JSON.stringify(canonicalize(a)) < JSON.stringify(canonicalize(b)) ? -1 : 1))
        : mapped;
    }
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) {
        // 휘발 필드는 **endpoint+path 단위**로 지운다. 전역 이름 기준으로 지우면
        // 어떤 화면에서는 렌더에 쓰이는 필드까지 함께 사라진다.
        const full = `${url}${path}.${k}`;
        const globals = Array.isArray(volatile) ? volatile : (volatile['*'] || []);
        const scoped = Array.isArray(volatile) ? [] : (volatile[url] || []);
        if (globals.includes(k) || scoped.includes(k) || scoped.includes(`${path}.${k}`)) continue;
        void full;
        out[k] = strip(v[k], url, `${path}.${k}`);
      }
      return out;
    }
    return v;
  };
  const parts = [];
  for (const r of responses) {
    if (!r || typeof r !== 'object') { errors.push('DATASET_ENTRY_SHAPE'); continue; }
    if (r.status !== 200) { errors.push(`DATASET_STATUS ${r.url} ${r.status}`); continue; }
    let body = null;
    try { body = JSON.parse(r.body); } catch (e) { errors.push(`DATASET_UNPARSEABLE ${r.url}`); continue; }
    parts.push([String(r.url), JSON.stringify(canonicalize(strip(body, String(r.url), '')))]);
  }
  if (errors.length) return { digest: null, errors };
  parts.sort((a, b) => (a[0] < b[0] ? -1 : 1));   // endpoint 간 순서만 정규화한다
  return { digest: sha256Hex(parts.map((p) => `${p[0]}\n${p[1]}`).join('\n--\n')), errors: [] };
}

// ── bundle 단일 검증기 ────────────────────────────────────────────────────────
// 승격이 호출하는 **구체 검증기**다. 주입받지 않는다 — `validateBundle: () => []`로
// dark context와 비-PNG를 light bundle로 승격시킨 전례가 있다(실증).
// 캡처 산출물이 committed가 되기 위해 통과해야 하는 모든 계약을 여기 한 곳에 모은다.
export function validateCaptureBundle({ spec, phase, contextRaw, pngByName, provenanceRefs }) {
  const errors = [];
  if (!['light', 'dark'].includes(phase)) return [`BUNDLE_PHASE_INVALID ${String(phase)}`];
  if (typeof contextRaw !== 'string') return ['BUNDLE_CONTEXT_RAW_REQUIRED'];
  if (!pngByName || typeof pngByName !== 'object') return ['BUNDLE_PNGS_REQUIRED'];
  let ctx = null;
  try { ctx = JSON.parse(contextRaw); } catch (e) { return ['BUNDLE_CONTEXT_UNPARSEABLE']; }
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return ['BUNDLE_CONTEXT_SHAPE'];
  if (ctx.phase !== phase) return [`BUNDLE_CONTEXT_PHASE ${ctx.phase} != ${phase}`];

  // PNG 이름 집합 exact + 각 바이트가 실제 PNG이고 raster 계약을 만족
  const want = (spec.REQUIRED_SMOKE_SURFACES || []).map((x) => x.captureName).sort();
  const got = Object.keys(pngByName).sort();
  if (JSON.stringify(got) !== JSON.stringify(want))
    errors.push(`BUNDLE_CAPTURE_SET missing=[${want.filter((n) => !got.includes(n))}] extra=[${got.filter((n) => !want.includes(n))}]`);
  for (const n of got.filter((x) => want.includes(x))) errors.push(...validatePngRaster(pngByName[n], spec, n));

  errors.push(...validateDatasetContract(spec, buildActionContext(ctx)));
  errors.push(...validateScenarioCanon(spec, buildActionContext(ctx)));
  errors.push(...validateRasterContext(ctx, spec));
  errors.push(...validateActionLog(spec, ctx));
  errors.push(...validateCaptureEvidence(spec, ctx, provenanceRefs));

  // ⚠️ **마스크 geometry는 여기서 보지 않는다.**
  // 이전 판은 빈 fixture(stub)를 넣고 오류 문자열을 정규식으로 걸렀는데, 두 방향으로 틀렸다:
  //  - fail-open: `MASK_ID_NONCANONICAL` 같은 진짜 spec 오류가 필터에 지워졌다.
  //  - false-red: stub은 변경 property를 못 찾아 `MASK_OUTSET_NO_PROPERTY`에서 continue하고,
  //    그 결과 envelope 도달 카운트가 비어 정상 후보가 `MASK_ENVELOPE_UNREACHED`로 떨어졌다(실증).
  // 마스크 계약은 **projector가 만든 실제 allowIdToKey/changed**가 있어야 판정할 수 있다.
  // 그래서 그 검증은 fixture 승인 경로(artifactsCore)의 몫이고, 그때까지 이 캡처는
  // committed가 아니라 candidate로만 존재해야 한다.
  //
  // privacy audit은 **여기서** 본다 — 승격 후에 보면 미감사 PNG가 이미 committed가 된다.
  errors.push(...validatePrivacyAudit(ctx.privacyAudit, {
    captures: got.filter((n) => want.includes(n)).map((n) => ({ captureName: n, sha256: sha256Static(pngByName[n]) })),
    contextSubjectSha256: contextSubjectSha256(ctx),
  }));
  return errors;
}

// privacy subject는 audit 자신을 제외한 context를 canonical 직렬화해 해시한다(승인 경로와 동일 규칙).
export function contextSubjectSha256(ctx) {
  const { privacyAudit, ...subject } = ctx;
  return sha256Static(JSON.stringify(canonicalize(subject)));
}
const sha256Static = (v) => createHash('sha256').update(Buffer.isBuffer(v) ? v : Buffer.from(v)).digest('hex');

// ── 산출물 검증 코어 ────────────────────────────────────────────────────────
// 입력은 **raw bytes만** 받는다. caller가 이미 파싱한 객체·해시·validator 결과를 정답으로
// 주입할 수 없어야 한다(그게 self-validation의 근원이다). context도 여기서 직접 파싱한다.
function artifactsCore({ fixture, spec: rawSpec, contextRaw, sha256, readPng, baseDecls, provenanceRefs }) {
  const errors = [];
  if (typeof sha256 !== 'function' || typeof readPng !== 'function') return ['ARTIFACTS_IO_REQUIRED'];
  // spec은 **여기서 한 번** 스냅샷한다. 이후 fingerprint·마스크·actionLog가 전부 같은 값을 본다.
  const snap = snapshotSpec(rawSpec);
  if (snap.errors.length) return snap.errors;
  const spec = snap.spec;
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
  errors.push(...validateRasterContext(ctx, spec));
  // BASE는 **라이트 캡처만** 허용한다. 두 phase가 같은 스키마를 공유하므로, 이 단정이 없으면
  // 수동 복사 과정에서 다크 PNG가 BASE로 들어가도 아무도 잡지 못한다.
  if (ctx.phase !== 'light') errors.push(`BASE_CONTEXT_PHASE ${ctx.phase} != light`);

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
    // 치수·색심도·컬러타입·인터레이스는 caller 신고가 아니라 바이트에서 파생한다.
    // 픽셀 비교 경로와 **같은 함수**를 쓴다(따로 적으면 한쪽만 느슨해진다).
    errors.push(...validatePngRaster(bytes, spec, c.captureName));
  }

  // 6) 마스크·좌표 계약 — 방금 파싱한 그 객체로만 검사한다
  errors.push(...validateMaskContract(fixture, spec, ctx));

  // 6b) 이 context가 **커밋된 실행기로** 만들어졌는지 — 손으로 만든 context는 승인되지 않는다
  errors.push(...validateActionLog(spec, ctx));
  // 6c) 러너가 남긴 증거(coverage·darkReview·provenance)를 계약으로 검증한다.
  //     기록만 하고 검증하지 않으면 지우거나 바꾼 뒤 해시를 다시 만들면 통과한다.
  errors.push(...validateCaptureEvidence(spec, ctx, provenanceRefs));

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
export function validateCommittedArtifacts({ committedFixtureRaw, spec, contextRaw, sha256, readPng, baseDecls, provenanceRefs }) {
  if (typeof committedFixtureRaw !== 'string') return ['COMMITTED_FIXTURE_RAW_REQUIRED'];
  let fixture = null;
  try { fixture = JSON.parse(committedFixtureRaw); } catch (e) { return ['COMMITTED_FIXTURE_UNPARSEABLE']; }
  return artifactsCore({ fixture, spec, contextRaw, sha256, readPng, baseDecls, provenanceRefs });
}

// 메모리에서 새로 만든 candidate를 검증한다. **커밋된 fixture를 정답으로 쓰지 않는다.**
export function validateCandidateArtifacts({ fixture, spec, contextRaw, sha256, readPng, baseDecls, provenanceRefs }) {
  return artifactsCore({ fixture, spec, contextRaw, sha256, readPng, baseDecls, provenanceRefs });
}

// ── 승인 orchestration ─────────────────────────────────────────────────────
// validator를 **주입받지 않는다**. 데이터와 순수 IO만 받고 내부에서 concrete validator를 호출한다.
// 순서: candidate → conformance → candidate artifacts → serialize → write.
// 내부 validator 반환값이 배열이 아니면 내부 결함으로 보고 write하지 않는다.
export function approveAndWrite({
  fixture, spec, contrastResults,
  actualDecls, actualRaw, preAnnSources, actualAllowIdToKey, baseDecls,
  contextRaw, sha256, readPng, provenanceRefs,
  serialize, write, discoveryEvidence,
}) {
  const calls = { candidate: 0, conformance: 0, artifacts: 0, evidence: 0 };
  if (typeof serialize !== 'function' || typeof write !== 'function')
    return { errors: ['APPROVE_IO_REQUIRED'], wrote: false, bytes: null, calls };
  // ── spec 단일 스냅샷 ──────────────────────────────────────────────────────
  // **가장 먼저, 정확히 한 번.** 이전 판은 evidence preflight가 raw spec을 보고 그 뒤에야
  // snapshotSpec을 돌려, 루트 getter가 조회마다 다른 값을 주면 evidence와 downstream이
  // 서로 다른 manifest를 소비할 수 있었다. 아래 모든 단계가 이 frozen spec만 쓴다.
  const snapped = snapshotSpec(spec);
  if (snapped.errors.length) return { errors: snapped.errors, wrote: false, bytes: null, calls };
  spec = snapped.spec;
  // ── discovery 증거 preflight ──────────────────────────────────────────────
  // **projection·bundle 읽기·serialize·write보다 먼저.** 이 게이트가 없으면 커밋된 증거는
  // 테스트에서만 읽히고 승인 경로는 그것을 한 번도 보지 않는다(실증: production 호출부 0곳).
  // 증거가 없거나 검증이 실패하면 아래 어떤 단계도 실행되지 않고 write는 0회다.
  calls.evidence = 1;
  if (!discoveryEvidence || typeof discoveryEvidence !== 'object')
    return { errors: ['APPROVE_EVIDENCE_REQUIRED'], wrote: false, bytes: null, calls };
  let evErrors = null;
  try {
    // scenario는 **정본**에서 온다. context에서 뽑으면 context가 깨진 경우 evidence 단계가
    // 먼저 죽어 "무엇이 막았는지"가 흐려지고, context를 고쳐 evidence 대조를 흔들 수도 있다.
    evErrors = verifyDiscoveryEvidence({ files: discoveryEvidence.files, spec,
      scenario: buildActionContext(spec.SCENARIO_CANON || {}),
      sha256Hex: (v) => createHash('sha256').update(v).digest('hex'),
      gitBlob: discoveryEvidence.gitBlob });
  } catch (e) { return { errors: [`APPROVE_EVIDENCE_THREW ${(e && e.message) || e}`], wrote: false, bytes: null, calls }; }
  if (!Array.isArray(evErrors))
    return { errors: ['APPROVE_EVIDENCE_NONARRAY'], wrote: false, bytes: null, calls };
  if (evErrors.length)
    return { errors: evErrors.map((e) => `EVIDENCE ${e}`).slice(0, 40), wrote: false, bytes: null, calls };
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
  errors = step('artifacts', () => validateCandidateArtifacts({ fixture, spec, contextRaw, sha256, readPng, baseDecls, provenanceRefs }));
  if (errors.length) return { errors, wrote: false, bytes: null, calls };

  const bytes = serialize(fixture);
  write(bytes);
  return { errors: [], wrote: true, bytes, calls };
}
function safeParse(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }

// fingerprint payload에 들어가는 키의 **정본 목록**. payload 조립과 이 배열이 어긋나면
// 상설 테스트가 잡는다(주석만 두면 '주석은 있었다'가 반복된다).
export const FINGERPRINT_PAYLOAD_KEYS = [
  'base', 'files', 'counts', 'darkCounts', 'groupStage', 'surfaces', 'lightDiffMasks',
  'elementScales', 'selectorSizeEnvelope', 'maskPixelBudget', 'contrastReference', 'rasterContract',
  'probeContract', 'probeSourceSha', 'probeModuleSha', 'runnerModuleSha', 'adapterModuleSha',
  'overrideTargets', 'conversions', 'annotations',
  'datasetEndpoints', 'datasetVolatileFields', 'datasetUnorderedPaths', 'expectedDatasetManifest',
  'provenanceBlobPaths', 'scenarioCanon', 'scenarioCanonKeys', 'reviewedClassification',
  'overrides', 'contrast',
];

// 값을 **정확히 한 번** 읽어 plain 사본을 만들면서 동시에 검증한다.
//
// 왜 한 번인가: 검증과 복제를 따로 하면 그 사이에 값이 바뀔 수 있다(루트 Proxy가 3번째 조회부터
// 다른 배열을 돌려주게 하자 fingerprint는 정상 SPEC과 동일한데 소비값은 106→105가 됐다 — 실증).
// 각 own property를 descriptor로 한 번만 읽고 그 값을 검증과 사본에 **함께** 쓰면,
// 값이 조회마다 달라지더라도 해시된 것과 소비되는 것이 같은 스냅샷이 된다.
export function plainJsonSnapshot(value, path = '$', seen = new Set()) {
  const t = typeof value;
  if (value === null || t === 'boolean' || t === 'string') return { value, errors: [] };
  if (t === 'number') return Number.isFinite(value) ? { value, errors: [] } : { value: null, errors: [`JSON_NONFINITE ${path}`] };
  if (t !== 'object') return { value: null, errors: [`JSON_BAD_TYPE ${path} ${t}`] };
  if (seen.has(value)) return { value: null, errors: [`JSON_CYCLE ${path}`] };
  seen.add(value);
  const errors = [];
  const isArr = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (isArr ? proto !== Array.prototype : !(proto === Object.prototype || proto === null))
    errors.push(`JSON_BAD_PROTO ${path}`);
  if (Object.getOwnPropertySymbols(value).length) errors.push(`JSON_SYMBOL_KEY ${path}`);
  const out = isArr ? [] : {};
  const names = Object.getOwnPropertyNames(value);
  const idx = isArr ? new Set(Array.from({ length: value.length }, (_, i) => String(i))) : null;
  for (const k of names) {
    if (isArr && k === 'length') continue;
    if (isArr && !idx.has(k)) { errors.push(`JSON_ARRAY_EXTRA_KEY ${path}.${k}`); continue; }
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (typeof d.get === 'function' || typeof d.set === 'function') { errors.push(`JSON_ACCESSOR ${path}.${k}`); continue; }
    if (!d.enumerable) { errors.push(`JSON_NON_ENUMERABLE ${path}.${k}`); continue; }
    const r = plainJsonSnapshot(d.value, `${path}.${k}`, seen);   // ← 이 한 번의 읽기만 쓴다
    errors.push(...r.errors);
    if (!r.errors.length) out[k] = r.value;
  }
  seen.delete(value);
  return { value: errors.length ? null : out, errors };
}

const deepFreeze = (v) => {
  if (v && typeof v === 'object') { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
};

// spec 진입점. **정확히 한 번** plain snapshot을 만들고, 이후 모든 소비자는 이 snapshot만 쓴다.
//
// 루트도 descriptor로 읽는다. `{...spec}`은 accessor를 **호출해 값으로 바꾸고** 비열거 속성을
// 지워버린다 — 검사하기 전에 증거가 사라진다(실증: 루트에 비열거·accessor를 주입해도 오류 0건).
// 모듈 네임스페이스의 Symbol.toStringTag만 예외로 둔다(모든 ESM 네임스페이스가 갖는다).
export function snapshotSpec(spec) {
  if (!spec || typeof spec !== 'object') return { spec: null, errors: ['SPEC_SHAPE'] };
  const errors = [];
  for (const sym of Object.getOwnPropertySymbols(spec))
    if (sym !== Symbol.toStringTag) errors.push(`SPEC_NOT_PLAIN JSON_SYMBOL_KEY SPEC ${String(sym)}`);
  const out = {};
  for (const k of Object.getOwnPropertyNames(spec)) {
    const d = Object.getOwnPropertyDescriptor(spec, k);
    if (!d) { errors.push(`SPEC_NOT_PLAIN JSON_NO_DESCRIPTOR SPEC.${k}`); continue; }
    // 비열거 루트 키는 거부한다 — ESM 네임스페이스에는 존재하지 않으며, 숨긴 필드의 통로다.
    if (!d.enumerable) { errors.push(`SPEC_NOT_PLAIN JSON_NON_ENUMERABLE SPEC.${k}`); continue; }
    // ⚠️ **루트의 accessor는 거부하지 않는다.** ESM live binding이 accessor이기 때문이다:
    //    node 네이티브 네임스페이스는 데이터 속성(accessor 0개)이지만 vitest 변환 아래에서는
    //    17개 export가 **전부 getter**다(실측). 거부하면 정상 입력이 영구 false RED가 된다.
    //    대신 여기서 **정확히 한 번만** 읽는다 — 조회마다 값이 달라져도 해시된 것과
    //    소비되는 것이 같은 스냅샷이라는 성질은 그대로 지켜진다.
    //    (중첩 값의 accessor는 그런 정당한 이유가 없으므로 plainJsonSnapshot이 계속 거부한다.)
    const value = d.get ? d.get.call(spec) : d.value;           // ← 이 한 번의 읽기만 쓴다
    const r = plainJsonSnapshot(value, `SPEC.${k}`);
    errors.push(...r.errors.map((e) => `SPEC_NOT_PLAIN ${e}`));
    if (!r.errors.length) out[k] = r.value;
  }
  if (errors.length) return { spec: null, errors };
  return { spec: deepFreeze(out), errors: [] };
}

// spec 값이 **plain JSON**이 아니면 fingerprint는 전수를 덮지 못한다.
//
// 실증된 회피: `Object.defineProperty(CONVERSIONS[0], 'skipVerify', { value: true, enumerable: false })`
// → JSON.stringify는 그 필드를 건너뛰므로 fingerprint 불변, 그러나 코드는 `.skipVerify === true`를
// 읽는다. toJSON·accessor·심볼 키도 같은 부류다. payload를 아무리 넓혀도 직렬화 기반인 한 못 막는다.
// 구조적 폐쇄는 "직렬화가 값 전체를 본다"를 먼저 보장하는 것뿐이다.
//
// spec은 모듈 네임스페이스라 Symbol.toStringTag를 갖는다 — 그래서 네임스페이스 자체가 아니라
// **전개한 값들**을 검사한다.
export function specPlainJsonErrors(spec) {
  return snapshotSpec(spec).errors;
}

export function specFingerprintPayload(spec, sha256Hex) {
  return { base: spec.BASE, files: spec.FILES, counts: spec.COUNTS,
    darkCounts: spec.DARK_DECL_COUNTS, groupStage: spec.GROUP_STAGE,
    // canonicalize로 키 순서를 정규화한다. 순수 포매팅(필드 순서) 정리가 fingerprint를 흔들면
    // 재캡처를 요구하게 되는데, 그건 계약이 아니라 잡음이다. 값이 바뀌면 여전히 흔들린다.
    surfaces: spec.REQUIRED_SMOKE_SURFACES.map((x) => [x.name, x.captureName,
      JSON.stringify(canonicalize(x.coverageSelectors)), JSON.stringify(canonicalize(x.darkReviewSelectors)),
      JSON.stringify(canonicalize(x.requiredElements || [])), JSON.stringify(canonicalize(x.actions))]),
    lightDiffMasks: spec.LIGHT_DIFF_MASKS,
    elementScales: spec.ELEMENT_SCALES,        // (surface,selector)별 실측 배율 — 캔버스 0.5 포함
    selectorSizeEnvelope: spec.SELECTOR_SIZE_ENVELOPE,
    maskPixelBudget: spec.MASK_PIXEL_BUDGET,
    contrastReference: spec.CONTRAST_REFERENCE,   // 참고치 삭제·변조도 fingerprint를 흔든다
    rasterContract: spec.RASTER_CONTRACT,        // viewport·DPR·scale이 바뀌면 다른 spec identity다
    probeContract: spec.PROBE_CONTRACT,
    probeSourceSha: sha256Hex(PROBE_SOURCE),     // 브라우저에 주입되는 코드
    // 측정 모듈 **전체 바이트**. PROBE_SOURCE만 해시하면 양자화 격자(QUANT/SCALE_QUANT)·정규화
    // (normalizeOccurrence)·거부 규칙(validateProbeResult)·교차검증 엄격도(crossCheckScale)가
    // 잠기지 않는다. 실측: QUANT 64→32 변경이 fingerprint를 흔들지 못했다.
    probeModuleSha: sha256Hex(PROBE_MODULE_BYTES),
    // 캡처 실행기 전체 바이트. op 화이트리스트·중단 규칙·postcondition 판정·산출물 경로가 전부
    // 여기 있고, 전부 "이 캡처가 어떻게 만들어졌는가"의 의미를 바꾼다.
    // (순환 import: evaluator ↔ runner. 둘 다 최상위에서 상대 함수를 호출하지 않으므로 안전하며
    //  두 로드 순서 모두 실측 확인했다.)
    runnerModuleSha: sha256Hex(RUNNER_MODULE_BYTES),
    // 커밋된 진입점. core를 우회하는 어댑터가 생기면 이 바이트가 단서가 된다.
    adapterModuleSha: sha256Hex(ADAPTER_MODULE_BYTES),
    overrideTargets: Object.entries(spec.OVERRIDES).map(([k, v]) =>
      [k, (v.match(/^\s{2}\.[^{]+\{/gm) || []).map((t) => t.trim())]),
    conversions: spec.CONVERSIONS.map((c) => [c.id, c.f, c.l, c.k, c.from, c.to, c.group, c.stage, JSON.stringify(canonicalize(c.ident))]),
    annotations: spec.ANNOTATIONS.map((a) => [a.f, a.l, a.marker, a.anchor, a.text]),
    datasetEndpoints: spec.DATASET_ENDPOINTS,
    datasetVolatileFields: spec.DATASET_VOLATILE_FIELDS,
    datasetUnorderedPaths: spec.DATASET_UNORDERED_PATHS,
    // 시나리오 정본도 fingerprint 입력이다 — ID/이름이 바뀌면 산출물의 의미가 바뀐다.
    provenanceBlobPaths: spec.PROVENANCE_BLOB_PATHS,
    scenarioCanon: spec.SCENARIO_CANON,
    scenarioCanonKeys: spec.SCENARIO_CANON_KEYS,
    reviewedClassification: spec.REVIEWED_CLASSIFICATION,
    // 검수된 기대 dataset. null이면 "아직 확정되지 않음"이고 그 사실 자체가 fingerprint에 남는다.
    expectedDatasetManifest: spec.EXPECTED_DATASET_MANIFEST,
    overrides: spec.OVERRIDES, contrast: spec.CONTRAST_CASES };
}

export function specFingerprint(spec, sha256Hex) {   // 검수 §7: surfaces·marker·override target 포함
  // non-plain이면 **해시를 돌려주지 않는다**. 이전 판은 오류 문자열을 해시했는데, 그러면
  // 서로 다른 EVIL/SAFE 값이 같은 오류 문자열 → 같은 fingerprint가 됐다(실증).
  // "해시가 baseline과 다르다"는 거부의 증거가 아니다. 거부는 중단이어야 한다.
  // 스냅샷을 **한 번** 만들고 그 스냅샷만 해시한다. 이전 판은 검증에서 한 번, payload 생성에서
  // 다시 raw spec을 읽었다 — 조회마다 값이 달라지는 루트에서 해시된 것과 소비되는 것이 갈렸다(실증).
  const snap = snapshotSpec(spec);
  if (snap.errors.length) throw new Error(`SPEC_NOT_PLAIN ${snap.errors.slice(0, 3).join('; ')}`);
  return sha256Hex(JSON.stringify(specFingerprintPayload(snap.spec, sha256Hex)));
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
import { createHash } from 'node:crypto';   // dataset digest 재계산 — 주입 금지
// 양자화·배율 교차검증은 probe와 **같은 규칙**을 써야 한다(캡처 시점과 검증 시점의 격자가 다르면
// exact 비교가 무의미해진다). 그래서 재정의하지 않고 committed probe 모듈에서 가져온다.
import { PROBE_SOURCE, PROBE_MODULE_BYTES, q, qs, crossCheckScale } from './s4DomProbe.mjs';
import { RUNNER_MODULE_BYTES, ADAPTER_MODULE_BYTES, planSurface, OP_SCHEMA } from './s4CaptureRunner.mjs';
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
