import { looksLikeMarkdown, markdownToHtml } from './markdownMath';

/**
 * 기존 plain text 데이터를 HTML로 변환 (하위 호환).
 * 이미 HTML 태그가 있으면 그대로 반환.
 */
export function ensureHtml(text) {
  if (!text) return text;
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .split('\n')
    .map((line) => `<p>${line || '<br>'}</p>`)
    .join('');
}

/**
 * 승격판 (WEAVE-36): 태그가 없고 markdown으로 보이면 marked(breaks, math)로 렌더 —
 * 과거 MCP ingress로 뭉개져 저장된 raw md를 마이그레이션 없이 구제한다.
 * 소비처: Copy as Markdown 핸들러(S1.3) + 읽기 뷰 렌더(S2.6, sanitizeHtml 뒤따름).
 */
export function ensureRenderableHtml(text) {
  if (!text) return text;
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  if (looksLikeMarkdown(text, { math: true })) return markdownToHtml(text, { math: true });
  return ensureHtml(text);
}
