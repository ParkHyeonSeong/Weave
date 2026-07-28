// frontend/library/s4Canonicalize.mjs
// 응답 JSON을 결정적 문자열로 만든다. **배열 순서는 보존**한다(UI 순서 회귀를 해시가 가리면 안 됨).
// 휘발 필드는 전역이 아니라 **endpoint별 화이트리스트**로만 제거한다(검수 §5).
// 예: /tracks 의 updated_at 은 목록 정렬 입력이므로 제거 금지 — 기본값은 "아무것도 제거하지 않음".
export const VOLATILE_BY_ENDPOINT = {
  // 예: '/tracks/[0-9]+/items$': ['synced_at']  ← 렌더·정렬에 쓰이지 않음이 Task 2에서 실측 확인된 필드만 등재.
  //     기본값은 비어 있음(아무것도 제거하지 않음)이 정답이며, 근거 없는 필드 추가는 금지.
};
const volatileFor = (url) => {
  for (const pat of Object.keys(VOLATILE_BY_ENDPOINT)) if (new RegExp(pat).test(url)) return new Set(VOLATILE_BY_ENDPOINT[pat]);
  return new Set();
};
export function canonicalize(value, drop = new Set()) {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, drop));   // 순서 보존
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) { if (drop.has(k)) continue; out[k] = canonicalize(value[k], drop); }
    return out;
  }
  return value;
}
export function bundleString(entries) {   // entries: [{url, body}] — url 기준 정렬 후 연결
  return entries.slice().sort((a, b) => a.url.localeCompare(b.url))
    .map((e) => `${e.url}\n${JSON.stringify(canonicalize(e.body, volatileFor(e.url)))}`).join('\n--\n');
}
