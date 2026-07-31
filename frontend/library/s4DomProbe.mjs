// frontend/library/s4DomProbe.mjs
// **committed exact-DOM probe** — 브라우저에서 실행할 측정 코드의 단일 원천.
//
// 왜 커밋하는가: mask rect가 "그 요소의 것"임을 보증하는 오라클이 필요한데, 러너가 그때그때
// 짜는 코드로는 el.parentElement를 재거나 컨테이너를 통째로 넣어도 형태적으로 구별되지 않는다.
// 이 파일 바이트의 SHA를 specFingerprint에 넣어, 측정 코드가 바뀌면 동결이 무효화되게 한다.
//
// 계약
//  - `document.querySelectorAll(selector)` **정확히 그것만** 쓴다. parentElement·closest·
//    확장 rect·외부 주입 rect 금지.
//  - 반환한 element **자신의** getBoundingClientRect()만 측정한다.
//  - 유효 배율은 **두 경로로 독립 파생**한다:
//      (A) rect / borderBox      — getBoundingClientRect + getComputedStyle 사용값
//      (B) transform 행렬 곱      — 자기 + 조상 체인의 computed transform
//    (A)는 조상 transform을 "결과"로만 보고, (B)는 "원인"만 본다. 서로를 참조하지 않으므로
//    한쪽만 위조하면 evaluator에서 불일치로 잡힌다.
//    ⚠️ 이전 판은 (B) 없이 `getComputedStyle(el).transform`만 봤다. 그래서 캔버스처럼 배율이
//    **조상**에 걸린 경우 scale을 1로 자기신고했고(실측 0.5), settings 스와치처럼 자기 자신에
//    걸린 경우만 우연히 맞았다. 자기신고 1은 오라클이 아니다.
//  - 조상 rect는 재지 않는다. (B)는 computed transform 문자열만 읽는다.
//  - 결과는 DOM 순서를 보존하고, 미발견은 생략이 아니라 `[]`로 남긴다.
//
// 이 모듈은 문자열을 만들어 주기만 한다(브라우저에 주입해 실행). Node에서는 파싱만 하므로
// 여기에 DOM API를 직접 쓰지 않는다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// **이 파일 전체 바이트**가 측정 계약이다. PROBE_SOURCE 문자열만 해시하면 측정의 절반만 잠긴다:
// QUANT/SCALE_QUANT(양자화 격자), normalizeOccurrence(무엇을 동결하는가), validateProbeResult
// (무엇을 거부하는가), crossCheckScale(두 파생을 얼마나 엄격히 대조하는가)는 전부 이 파일에 있고
// 전부 동결 좌표의 의미를 바꾼다. 실측: QUANT를 64→32로 바꿔도 fingerprint가 그대로였다.
//
// 비용: 주석 한 줄만 고쳐도 fingerprint가 흔들려 재동결을 요구한다. 이 파일이 곧 계약이므로
// 그 비용을 받아들인다 — 느슨하게 잡는 쪽이 훨씬 비싸다.
// 이 모듈은 도구 전용이다(library/scripts/테스트만 import한다 — 브라우저 번들에 들어가지 않는다).
// vitest 변환 아래에서도 변환된 소스가 아니라 **디스크 원본**을 읽는 것을 실측 확인했다.
export const PROBE_MODULE_PATH = fileURLToPath(import.meta.url);
export const PROBE_MODULE_BYTES = readFileSync(PROBE_MODULE_PATH);

// 브라우저에서 실행될 함수의 소스. selectors 배열을 받아 { [selector]: [occurrence...] }를 만든다.
export const PROBE_SOURCE = `function (selectors) {
  var out = {};
  var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; };
  // computed transform → 2D 행렬. 3D/비아핀은 flat=false로 표시해 evaluator가 거부하게 한다.
  var mat = function (t) {
    if (!t || t === 'none') return null;
    var m = t.match(/^matrix\\(([^)]+)\\)$/);
    if (m) { var p = m[1].split(',').map(Number); return { a: p[0], b: p[1], c: p[2], d: p[3], flat: true }; }
    var m3 = t.match(/^matrix3d\\(([^)]+)\\)$/);
    if (m3) {
      var q = m3[1].split(',').map(Number);
      var flat = q[2] === 0 && q[3] === 0 && q[6] === 0 && q[7] === 0 &&
                 q[8] === 0 && q[9] === 0 && q[10] === 1 && q[11] === 0 && q[14] === 0 && q[15] === 1;
      return { a: q[0], b: q[1], c: q[4], d: q[5], flat: flat };
    }
    return { a: NaN, b: NaN, c: NaN, d: NaN, flat: false };
  };
  for (var i = 0; i < selectors.length; i++) {
    var sel = selectors[i];
    var nodes = document.querySelectorAll(sel);     // 정확히 이 selector만
    var list = [];
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];                            // 요소 자신만 측정
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      // (A) 변환 전 border-box. computed width/height는 사용값이고 **box-sizing에 따라 기준 상자가
      // 다르다** — Blink는 border-box일 때 padding·border를 포함한 값을 돌려준다. 무조건 더하면
      // 이중 계산이 된다(실측: .SourcePicker__BranchKey 46.6016 + padding 12 = 58.6016으로 교차검증
      // 106건 실패). 원시 항목도 함께 남겨 재검산이 가능하게 한다.
      var bs = cs.boxSizing;
      var padX = num(cs.paddingLeft) + num(cs.paddingRight), padY = num(cs.paddingTop) + num(cs.paddingBottom);
      var brdX = num(cs.borderLeftWidth) + num(cs.borderRightWidth), brdY = num(cs.borderTopWidth) + num(cs.borderBottomWidth);
      var bw = bs === 'border-box' ? num(cs.width) : num(cs.width) + padX + brdX;
      var bh = bs === 'border-box' ? num(cs.height) : num(cs.height) + padY + brdY;
      // (B) 자기 + 조상 transform 행렬 곱. rect는 읽지 않는다.
      var sx = 1, sy = 1, skew = 0, nonFlat = 0, zoomed = 0, depth = 0, node = el;
      while (node && node.nodeType === 1) {
        var ncs = getComputedStyle(node);
        var m = mat(ncs.transform);
        if (m) {
          if (!m.flat) nonFlat++;
          if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9) skew++;
          var kx = Math.sqrt(m.a * m.a + m.b * m.b);
          var ky = kx === 0 ? 0 : (m.a * m.d - m.b * m.c) / kx;
          sx *= kx; sy *= ky;
        }
        var z = parseFloat(ncs.zoom);
        if (isFinite(z) && z !== 1) zoomed++;       // zoom은 좌표계를 바꾼다 — 있으면 거부한다
        node = node.parentElement; depth++;
      }
      list.push({
        x: r.x, y: r.y, width: r.width, height: r.height,
        borderBoxWidth: bw, borderBoxHeight: bh,
        transformScaleX: sx, transformScaleY: sy,
        chainDepth: depth, skewCount: skew, nonFlatCount: nonFlat, zoomCount: zoomed,
        offsetWidth: el.offsetWidth, offsetHeight: el.offsetHeight,
        display: cs.display, boxSizing: bs,
        cssWidth: cs.width, cssHeight: cs.height, padX: padX, padY: padY, brdX: brdX, brdY: brdY,
        boxShadow: cs.boxShadow, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth,
        outlineOffset: cs.outlineOffset, filter: cs.filter,
      });
    }
    out[sel] = list;                                 // 미발견도 [] 로 남긴다
  }
  return out;
}`;

// postcondition 판정용 소스. 캡처 실행기가 **이 소스로 직접 판정**한다 —
// 드라이버의 waitVisible이 즉시 resolve하며 거짓말해도 상태에 도달하지 않았으면 여기서 걸린다.
// probe와 같은 evaluate 채널을 쓰므로 신뢰 가정이 늘지 않는다.
// visible 판정: 0 크기·display none·visibility hidden·opacity 0을 제외한다.
// `:hover` / `:focus` 의사클래스도 querySelectorAll로 실제 판정된다(브라우저 입력 상태 반영).
export const ASSERT_SOURCE = `function (selectors) {
  var vw = window.innerWidth, vh = window.innerHeight;
  // "보인다"는 **스크린샷에 나타난다**는 뜻이어야 한다. 자기 요소의 rect/style만 보면
  // 뷰포트 밖 요소, 투명하거나 숨은 조상 아래 요소도 visible로 세어진다(리뷰 지적).
  function paints(el) {
    var r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return false;   // 뷰포트 교집합
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {                    // 자기 + 모든 조상
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (Number(cs.opacity) === 0) return false;
      if (cs.contentVisibility === 'hidden') return false;
    }
    return true;
  }
  var out = {};
  for (var i = 0; i < selectors.length; i++) {
    var sel = selectors[i];
    var nodes;
    try { nodes = document.querySelectorAll(sel); } catch (e) { out[sel] = { count: -1, visible: -1 }; continue; }
    var vis = 0;
    for (var j = 0; j < nodes.length; j++) if (paints(nodes[j])) vis++;
    out[sel] = { count: nodes.length, visible: vis };
  }
  return out;
}`;

// 캡처 조건을 **페이지에서 직접 읽는다**. context.capture.dpr은 지금까지 순수 자기신고였고
// (리뷰 지적: dpr은 PNG에서 파생 불가) 아무도 대조하지 않았다. devicePixelRatio는 evaluate로
// 읽을 수 있으므로 자기신고를 실측으로 바꿀 수 있다. 스크롤도 캡처 전제라 함께 읽는다.
export const RASTER_PROBE_SOURCE = `function () {
  return {
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY),
    docScrollWidth: document.documentElement.scrollWidth,
  };
}`;

// 테마 상태를 페이지에서 직접 읽는다. 러너는 이 값으로 phase(light/dark)를 **강제**한다 —
// 이전 판은 기존 theme을 읽어 복원만 했고, 라이트를 만들지도 확인하지도 않았다.
// 즉 다크 상태로 남아 있던 브라우저에서 찍으면 "라이트 BASE"가 다크 픽셀이 될 수 있었다.
export const THEME_PROBE_SOURCE = `function () {
  var el = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem('theme'); } catch (e) { }
  return {
    dataTheme: el.getAttribute('data-theme'),
    stored: stored,
    colorScheme: getComputedStyle(el).colorScheme || '',
  };
}`;

// 의사요소(::before 등)는 selector로 잡을 수 없다. computed style로만 존재를 판정한다.
// 인자: [[hostSelector, pseudo], ...]  →  { "sel::before": { count, present } }
export const PSEUDO_PROBE_SOURCE = `function (pairs) {
  var vw = window.innerWidth, vh = window.innerHeight;
  function hostPaints(el) {
    var r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  }
  var out = {};
  for (var i = 0; i < pairs.length; i++) {
    var host = pairs[i][0], pseudo = pairs[i][1], key = host + pseudo;
    var nodes;
    try { nodes = document.querySelectorAll(host); } catch (e) { out[key] = { count: -1, present: 0 }; continue; }
    var present = 0;
    for (var j = 0; j < nodes.length; j++) {
      if (!hostPaints(nodes[j])) continue;                       // 숨은 host의 의사요소는 안 보인다
      var cs = getComputedStyle(nodes[j], pseudo);
      if (!cs) continue;
      if (!cs.content || cs.content === 'none' || cs.content === 'normal') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      present++;
    }
    out[key] = { count: nodes.length, present: present };
  }
  return out;
}`;

// 화면을 결정하는 **데이터셋**을 같은 페이지에서 수집한다.
//
// 왜: light와 dark가 서로 다른 데이터에서 찍히면 비교 자체가 무의미하다. 이전 context의
// networkIndex/bundleSha256은 아무도 검증하지 않아 폐기했는데, 그러면 두 phase의 데이터
// 동일성을 증명할 수단이 사라진다.
//
// 계약: 이 소스는 **원본 응답을 그대로** 돌려준다. digest 계산은 하지 않는다 —
// 브리지나 candidate가 계산한 digest는 자기신고이고, 검증기가 raw 응답에서 직접 계산해야 한다.
// URL은 **절대 URL**을 받는다. 페이지 상대 `/api/...`는 frontend origin(:10000)으로 가는데
// 앱의 axios는 backend origin(:10001/api)을 쓴다 — 다른 것을 재보게 된다(동결 context의
// apiOrigin이 그 증거다).
export const DATASET_PROBE_SOURCE = `function (urls) {
  return Promise.all(urls.map(function (u) {
    return fetch(u, { credentials: 'include', headers: { accept: 'application/json' } })
      .then(function (r) { return r.text().then(function (t) { return { url: u, status: r.status, body: t }; }); })
      .catch(function (e) { return { url: u, status: -1, body: String(e && e.message) }; });
  }));
}`;

// **discovery 전용** 관찰 소스. 페이지가 실제로 부른 XHR/fetch의 origin·path·query를 수집한다.
// spec에 적힌 URL만 다시 fetch하면 **빠진 endpoint를 영원히 못 찾는다**(리뷰 지적).
// 이 소스는 아무것도 쓰지 않는다 — 사람이 검수할 목록을 만들 뿐이다.
// ⚠️ 이 소스는 **navigation 이전에** 심어야 한다. goto 이후에 evaluate로 심으면
// 페이지 로드 중 발생한 요청(대부분의 API 호출)은 이미 지나가 관찰되지 않는다(실증).
// driver.addInitScript(source)로 매 문서에 자동 주입한다.
// hook 버전. 소스가 바뀌면 올린다 — 같은 page에 남은 **구버전 hook**을 최신인 양 쓰지 않도록.
export const NETWORK_HOOK_VERSION = 2;

export const NETWORK_INSTALL_SOURCE = `function () {
  var VERSION = 2;
  var st = window.__s4net;
  if (st) {
    // 이미 있으면 **버전을 확인한다.** 이전 판은 존재하기만 하면 true를 돌려줘서,
    // 같은 page에 남은 구버전 hook으로 최신 HEAD를 시험한 것처럼 보일 수 있었다.
    if (st.version !== VERSION) return { ok: false, reason: 'STALE_HOOK', version: st.version, want: VERSION };
    return { ok: true, version: st.version, documentId: st.documentId,
      installedAtReadyState: st.installedAtReadyState, reused: true };
  }
  var docId;
  try { docId = String(performance.timeOrigin) + ':' + String(performance.now()) + ':' + location.href; }
  catch (e) { docId = String(Date.now()) + ':' + location.href; }
  st = { version: VERSION, documentId: docId, installedAtReadyState: document.readyState,
    entries: [], pending: 0, lastActivity: Date.now() };
  window.__s4net = st;
  function abs(raw) {
    try { return new URL(String(raw), location.href).href; } catch (e) { return String(raw); }
  }
  // ok 기준을 **통일**한다: 200-299. 이전 판은 fetch가 r.ok(200-299), XHR이 <400이라
  // 같은 3xx 응답이 채널에 따라 다르게 기록됐다.
  function isOk(status) { return status >= 200 && status < 300; }
  function record(method, url, status) {
    st.entries.push({ method: String(method || 'GET').toUpperCase(), url: abs(url),
      status: typeof status === 'number' ? status : -1, ok: isOk(status) });
    st.lastActivity = Date.now();
  }
  var of = window.fetch;
  window.fetch = function (input, init) {
    var url = (input && input.url) ? input.url : input;
    var method = (init && init.method) || (input && input.method) || 'GET';
    st.pending++; st.lastActivity = Date.now();
    return of.apply(this, arguments).then(function (r) {
      record(method, url, r.status); st.pending--; st.lastActivity = Date.now(); return r;
    }, function (e) { record(method, url, -1); st.pending--; st.lastActivity = Date.now(); throw e; });
  };
  var oo = XMLHttpRequest.prototype.open;
  var osend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__s4m = m; this.__s4u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    st.pending++; st.lastActivity = Date.now();
    xhr.addEventListener('loadend', function () {
      record(xhr.__s4m, xhr.__s4u, xhr.status);
      st.pending--; st.lastActivity = Date.now();
    });
    return osend.apply(this, arguments);
  };
  return { ok: true, version: VERSION, documentId: st.documentId,
    installedAtReadyState: st.installedAtReadyState, reused: false };
}`;

// 네트워크가 **정말 조용해졌는지** 본다. 고정 sleep은 느린 응답을 놓치고 빠른 화면에서는 낭비다.
export const NETWORK_IDLE_SOURCE = `function (quietMs) {
  var st = window.__s4net;
  if (!st) return { installed: false, idle: false, pending: -1, sinceMs: -1, version: null };
  if (st.version !== 2) return { installed: true, stale: true, idle: false, pending: -1, sinceMs: -1, version: st.version };
  var since = Date.now() - st.lastActivity;
  return { installed: true, stale: false, idle: st.pending === 0 && since >= quietMs,
    pending: st.pending, sinceMs: since, version: st.version, documentId: st.documentId,
    installedAtReadyState: st.installedAtReadyState };
}`;

// 관찰 결과를 비우고 돌려준다. 버전이 다르면 **비우지 않고** 거부한다.
export const NETWORK_DRAIN_SOURCE = `function () {
  var st = window.__s4net;
  if (!st) return { ok: false, reason: 'NOT_INSTALLED' };
  if (st.version !== 2) return { ok: false, reason: 'STALE_HOOK', version: st.version };
  var out = st.entries;
  st.entries = [];
  return { ok: true, version: st.version, documentId: st.documentId,
    installedAtReadyState: st.installedAtReadyState, entries: out };
}`;

// 1/64 CSS px 양자화 — 캡처 시점과 검증 시점이 같은 규칙을 쓴다.
export const QUANT = 64;
export const q = (v) => Math.round(v * QUANT) / QUANT;

// 배율은 1/64보다 훨씬 미세한 값이라 좌표와 같은 격자로 양자화하면 0.5와 0.503이 붙는다.
// 별도 격자를 쓰고, 두 파생 경로 대조 tolerance도 여기에 맞춘다.
export const SCALE_QUANT = 1e6;
export const qs = (v) => Math.round(v * SCALE_QUANT) / SCALE_QUANT;

// probe가 돌려준 raw occurrence를 동결 형태로 정규화한다.
// paintRect는 **여기서 만들지 않는다** — spec의 paintOutsetPx와 실측 배율로 evaluator가 파생한다.
// scale은 (A)·(B) 어느 한쪽을 고르지 않고 둘 다 남긴다. 고르는 순간 다른 쪽이 검사에서 사라진다.
export function normalizeOccurrence(o) {
  return {
    x: q(o.x), y: q(o.y), width: q(o.width), height: q(o.height),
    borderBoxWidth: q(o.borderBoxWidth), borderBoxHeight: q(o.borderBoxHeight),
    transformScaleX: qs(o.transformScaleX), transformScaleY: qs(o.transformScaleY),
    scale: qs(o.transformScaleX),
    boxShadow: String(o.boxShadow), outlineStyle: String(o.outlineStyle),
    outlineWidth: String(o.outlineWidth), outlineOffset: String(o.outlineOffset),
    filter: String(o.filter),
  };
}

const NUM_KEYS = ['x', 'y', 'width', 'height', 'borderBoxWidth', 'borderBoxHeight',
  'transformScaleX', 'transformScaleY', 'chainDepth', 'skewCount', 'nonFlatCount', 'zoomCount',
  'offsetWidth', 'offsetHeight', 'padX', 'padY', 'brdX', 'brdY'];
const STR_KEYS = ['display', 'boxSizing', 'cssWidth', 'cssHeight',
  'boxShadow', 'outlineStyle', 'outlineWidth', 'outlineOffset', 'filter'];

// probe 결과가 계약을 지키는지(키 집합·형태·측정 가능성) 확인한다.
// 값의 의미(선언된 배율·outset과 맞는지)는 evaluator 몫.
export function validateProbeResult(result, selectors) {
  const errors = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ['PROBE_RESULT_SHAPE'];
  const want = new Set(selectors);
  for (const sel of want) if (!Object.prototype.hasOwnProperty.call(result, sel)) errors.push(`PROBE_SELECTOR_MISSING ${sel}`);
  for (const sel of Object.keys(result)) if (!want.has(sel)) errors.push(`PROBE_SELECTOR_EXTRA ${sel}`);
  for (const sel of want) {
    const list = result[sel];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { errors.push(`PROBE_NOT_ARRAY ${sel}`); continue; }
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const at = `${sel}[${i}]`;
      if (!o || typeof o !== 'object' || Array.isArray(o)) { errors.push(`PROBE_OCCURRENCE_SHAPE ${at}`); continue; }
      for (const k of NUM_KEYS)
        if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) errors.push(`PROBE_NONFINITE ${at} ${k}`);
      for (const k of STR_KEYS)
        if (typeof o[k] !== 'string') errors.push(`PROBE_NONSTRING ${at} ${k}`);
      if (errors.some((e) => e.endsWith(` ${at} width`) || e.endsWith(` ${at} height`))) continue;
      if (!(o.width > 0) || !(o.height > 0)) errors.push(`PROBE_DEGENERATE ${at}`);
      if (!(o.borderBoxWidth > 0) || !(o.borderBoxHeight > 0)) errors.push(`PROBE_BORDERBOX_UNMEASURABLE ${at}`);
      if (!(o.transformScaleX > 0) || !(o.transformScaleY > 0)) errors.push(`PROBE_BAD_SCALE ${at}`);
      // 배율 모델을 벗어난 좌표계는 조용히 통과시키지 않는다 — 회전·기울임·3D·zoom은 거부.
      if (o.skewCount) errors.push(`PROBE_SKEWED ${at}`);
      if (o.nonFlatCount) errors.push(`PROBE_NON_AFFINE ${at}`);
      if (o.zoomCount) errors.push(`PROBE_ZOOMED ${at}`);
      if (!(o.chainDepth >= 1)) errors.push(`PROBE_CHAIN_EMPTY ${at}`);
    }
  }
  return errors;
}

// (A)와 (B)가 같은 배율을 가리키는지 — 서로 다른 API에서 나온 두 값의 교차 단정.
// rect는 LayoutUnit(1/64 px) 격자에 스냅되므로 곱셈 결과에 그 오차가 실린다. 축당 1/64를
// 허용하되 상대오차도 함께 본다(큰 요소에서 tolerance가 과해지지 않도록).
export const LAYOUT_UNIT = 1 / 64;
export function crossCheckScale(o) {
  const errors = [];
  const axis = (rect, box, s, name) => {
    const want = box * s;
    const tol = LAYOUT_UNIT + Math.abs(want) * 1e-9;
    if (Math.abs(rect - want) > tol) errors.push(`SCALE_CROSSCHECK_${name} ${rect} != ${box}*${s}=${want}`);
  };
  axis(o.width, o.borderBoxWidth, o.transformScaleX, 'X');
  axis(o.height, o.borderBoxHeight, o.transformScaleY, 'Y');
  if (qs(o.transformScaleX) !== qs(o.transformScaleY))
    errors.push(`SCALE_ANISOTROPIC ${o.transformScaleX} != ${o.transformScaleY}`);
  return errors;
}
