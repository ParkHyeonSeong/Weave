import DOMPurify from 'isomorphic-dompurify';

// 빈 문단(엔터로 띄운 빈 줄)을 편집기와 동일하게 한 줄 높이로 렌더하기 위한 hook.
// TipTap getHTML은 빈 줄을 <p></p>로 직렬화하는데, 읽기 모드(dangerouslySetInnerHTML)에선
// 콘텐츠 높이 0 + 인접 빈 문단의 마진 상쇄로 여러 빈 줄이 한 줄로 뭉개진다. 편집기가 빈
// 문단에 그리는 <br>(ProseMirror-trailingBreak)과 동일하게 <br>을 채워 개행을 보존한다.
function fillEmptyParagraph(node) {
  if (node.nodeName === 'P' && node.childNodes.length === 0) {
    node.appendChild(node.ownerDocument.createElement('br'));
  }
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
  try {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target'],
    });
  } finally {
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
