import DOMPurify from 'isomorphic-dompurify';
import { paletteClassFor } from './tiptapColorMap.js';

// 빈 문단(엔터로 띄운 빈 줄)을 편집기와 동일하게 한 줄 높이로 렌더하기 위한 hook.
// TipTap getHTML은 빈 줄을 <p></p>로 직렬화하는데, 읽기 모드(dangerouslySetInnerHTML)에선
// 콘텐츠 높이 0 + 인접 빈 문단의 마진 상쇄로 여러 빈 줄이 한 줄로 뭉개진다. 편집기가 빈
// 문단에 그리는 <br>(ProseMirror-trailingBreak)과 동일하게 <br>을 채워 개행을 보존한다.
function fillEmptyParagraph(node) {
  if (node.nodeName === 'P' && node.childNodes.length === 0) {
    node.appendChild(node.ownerDocument.createElement('br'));
  }
}

// TipTap이 문서에 굳혀 둔 팔레트 색을 시맨틱 클래스로 바꾸는 hook.
// 알려진 팔레트 색만 골라 선언을 제거하고 클래스를 붙이면 클래스가 유일한 색 소스가 되어
// [data-theme] 전환이 재렌더 없이 먹는다. 팔레트 밖 색·프로퍼티는 손대지 않는다.
// sanitizeHtml은 읽기 관문일 뿐 저장 경로에 없다(sanitizeSavePath.dom.test.js가 물리 저장 호출부 15곳을 고정).
//
// ⛔ style 문자열을 직접 쪼개지 마라(`raw.split(';')`). 실측 반례 2종:
//   ① `color: #DC2626; color: #123456` — 브라우저가 쓰는 최종색은 팔레트 **밖**인 #123456인데
//      split은 앞의 #DC2626을 집어 `wv-tc-dc2626`을 붙인다. 다크에서 남색이 빨강이 된다.
//      반대 순서 `color: #123456; color: #DC2626`은 클래스는 맞지만 죽은 선언 #123456이
//      인라인에 남아 클래스를 이긴다.
//   ② `background-image: url("data:image/svg+xml;base64,…")` — data URI 안의 `;`가 선언
//      구분자로 오인돼 `url("data:image/svg+xml; base64,…")`로 깨진다.
// CSSStyleDeclaration을 읽으면 둘 다 사라진다. getPropertyValue는 캐스케이드가 끝난
// **최종 유효값**을 주고(같은 블록에서는 !important가 순서를 이긴다), removeProperty는
// 그 프로퍼티의 죽은 중복 선언까지 함께 지우며, 나머지 선언은 우리가 재직렬화하지 않으므로
// 원문 의미가 보존된다. Chrome 151·jsdom 동일 동작을 실측했다.

// S7이 다루는 색 프로퍼티는 정확히 둘이다 — TipTap 정본이 `color` / `background-color`
// **longhand**만 쓴다. 각 프로퍼티가 "소유"하는 클래스 접두사도 여기서 갈린다.
const PALETTE_PROPS = ['color', 'background-color'];
const OWNED_CLASS_RE = {
  color: /^wv-tc-/,
  'background-color': /^wv-(hl|cell)-/,
};

// `background` 축약이 관여했다는 흔적. 축약을 쓰면 엔진이 이 longhand들을 함께 채운다
// (Chrome은 9개로 펼치고 jsdom은 `background` 하나로 남긴다 — 둘 다 여기 걸린다).
// 하나라도 있으면 background-color 축 전체를 미처리한다: `removeProperty`가 축약을
// 재직렬화해 background-image 등 나머지 구성요소의 원문을 깨기 때문이다.
const BACKGROUND_SHORTHAND_TRACE = new Set([
  'background',
  'background-position', 'background-position-x', 'background-position-y',
  'background-size',
  'background-repeat', 'background-repeat-x', 'background-repeat-y',
  'background-origin',
  'background-clip',
  'background-attachment',
]);

// ⛔ raw style 문자열을 정규식으로 훑지 마라. CSS 주석 · custom property 문자열 · 대문자 URL
//    안의 `; background-color:`를 실제 선언으로 오인한다(반례 3종이 테스트에 있다).
//    CSSStyleDeclaration의 indexed property 목록이 "엔진이 실제로 인정한 선언"의 정본이다.
const declaredProps = (node) => {
  const out = new Set();
  for (let i = 0; i < node.style.length; i += 1) out.add(node.style.item(i));
  return out;
};

// fail-closed: 목록에 그 프로퍼티가 실제로 있어야 하고, background-color는 축약 흔적이
// 하나도 없어야 처리한다. 명시적 background-image·vertical-align 등은 흔적이 아니다.
const canProcess = (props, prop) => {
  if (!props.has(prop)) return false;
  if (prop !== 'background-color') return true;
  for (const p of props) if (BACKGROUND_SHORTHAND_TRACE.has(p)) return false;
  return true;
};

function swapPaletteColors(node) {
  if (node.nodeType !== 1 || !node.style || typeof node.style.getPropertyValue !== 'function') return;
  if (typeof node.hasAttribute !== 'function' || !node.hasAttribute('style')) return;

  const props = declaredProps(node);
  for (const prop of PALETTE_PROPS) {
    const value = node.style.getPropertyValue(prop);
    if (!value) continue;   // 그 속성을 주장하는 선언이 없다(또는 CSSOM이 폐기) → 클래스도 손대지 않는다

    // ⚠️ 순서가 계약이다. 인라인이 그 속성의 색을 주장하는 이상 같은 속성의 기존 wv 클래스는
    //    전부 낡은 값이므로 **canProcess 판정보다 먼저** 지운다. 팔레트 밖 색이든, 축약이
    //    섞여 우리가 미처리하든 마찬가지다 — 남겨 두면 `!important` 클래스가 인라인을 이겨
    //    화면이 예전 색으로 바뀐다(fail-closed가 오히려 원문 의미를 깨는 역전).
    for (const cls of [...node.classList]) {
      if (OWNED_CLASS_RE[prop].test(cls)) node.classList.remove(cls);
    }

    if (!canProcess(props, prop)) continue;         // 축약이 관여했다 → 인라인은 원문 그대로 둔다
    const next = paletteClassFor(node.nodeName, prop, value);
    if (!next) continue;                            // 팔레트 밖 → 인라인 값은 그대로 둔다
    node.style.removeProperty(prop);                // 같은 prop의 죽은 중복 선언까지 함께 사라진다
    node.classList.add(next);
  }

  if (!node.getAttribute('style')) node.removeAttribute('style');
}

/**
 * HTML 문자열을 DOMPurify로 정화.
 * XSS 공격 벡터(script, onerror, javascript: 등)를 제거.
 */
export function sanitizeHtml(html) {
  if (!html) return html;
  // hook은 전역이지만 sanitize 호출이 동기라 add→sanitize→remove가 원자적으로 끝난다
  // (sanitizeSvg 등 다른 호출과 간섭 없음). finally로 예외 시에도 hook을 반드시 제거.
  DOMPurify.addHook('afterSanitizeElements', fillEmptyParagraph);
  DOMPurify.addHook('afterSanitizeAttributes', swapPaletteColors);
  try {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target'],
    });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes');
    DOMPurify.removeHook('afterSanitizeElements');
  }
}

/**
 * 순수 SVG 문자열을 DOMPurify로 정화 (Typst 컴파일 출력 등 렌더용).
 * svg 프로파일로 벡터 요소(path/g/text/use/defs 등)는 보존하고 script·on* 이벤트
 * 핸들러·javascript: 같은 XSS 벡터는 제거한다.
 * 주: Mermaid는 securityLevel:'strict'로 자체 정화하며 라벨에 foreignObject(HTML)를
 * 쓰므로 이 함수를 덧씌우지 않는다(여기선 foreignObject를 보존하지 않음).
 */
export function sanitizeSvg(svg) {
  if (!svg) return svg;
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // Typst 글리프는 <use href="#..."> 내부 참조로 렌더되므로 use를 명시 허용한다
    // (svg 프로파일은 기본적으로 use 제거). 잔여: DOMPurify IS_ALLOWED_URI가 http/https를
    // 허용하므로 <use>/<image>의 외부 href(http(s))는 살아남는다 — Typst WASM은 내부 #참조만
    // 생성하므로 실제 경로엔 영향 없고, 필요시 CSP img-src로 브라우저 수준 차단 가능.
    ADD_TAGS: ['use'],
  });
}
