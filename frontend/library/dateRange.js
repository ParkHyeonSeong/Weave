/**
 * cellStr가 [min, max] 밖이면 true. 모두 'YYYY-MM-DD'(또는 시간 포함 ISO).
 * 앞 10자(날짜부분)만 문자열 비교 — 0패딩 ISO라 사전식 비교가 곧 날짜순.
 */
export function isOutOfRange(cellStr, min, max) {
  const c = String(cellStr).slice(0, 10);
  if (min && c < String(min).slice(0, 10)) return true;
  if (max && c > String(max).slice(0, 10)) return true;
  return false;
}
