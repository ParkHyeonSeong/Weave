import DOMPurify from 'isomorphic-dompurify';

/**
 * HTML 문자열을 DOMPurify로 정화.
 * XSS 공격 벡터(script, onerror, javascript: 등)를 제거.
 */
export function sanitizeHtml(html) {
  if (!html) return html;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
  });
}
