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
