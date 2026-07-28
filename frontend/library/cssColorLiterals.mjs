// frontend/library/cssColorLiterals.mjs
// CSS 선언 값에서 색 리터럴(#hex / rgb() / rgba())을 lexical 추출. 문자열·이스케이프·url() 내부는 건너뛴다.
// 유효성 판정 없음(7자리 hex도 verbatim). 경계는 ASCII 식별자 문자 한정(알려진 한계).
export function extractColorLiterals(value) {
  const out = []; let i = 0; const n = value.length;
  const isIdent = (c) => !!c && /[A-Za-z0-9_-]/.test(c);
  const skipBalanced = (start) => { let d = 1, j = start + 1;
    while (j < n && d > 0) {
      if (value[j] === '\\') { j += 2; continue; }
      if (value[j] === '"' || value[j] === "'") { const q = value[j++]; while (j < n) { if (value[j] === '\\') j += 2; else if (value[j] === q) { j++; break; } else j++; } continue; }
      if (value[j] === '(') d++; else if (value[j] === ')') d--; j++;
    } return j; };
  while (i < n) {
    const ch = value[i];
    if (ch === '"' || ch === "'") { const q = ch; i++; while (i < n) { if (value[i] === '\\') i += 2; else if (value[i] === q) { i++; break; } else i++; } continue; }
    if (ch === '\\') { i += 2; continue; }
    if (/^url\(/i.test(value.slice(i, i + 4)) && !isIdent(value[i - 1])) { i = skipBalanced(i + 3); continue; }
    if (ch === '#' && !isIdent(value[i - 1])) { let j = i + 1; while (j < n && /[0-9a-fA-F]/.test(value[j])) j++;
      if (j > i + 1 && !isIdent(value[j])) { out.push(value.slice(i, j)); i = j; continue; } i = j > i + 1 ? j : i + 1; continue; }
    if (/^rgba?\(/i.test(value.slice(i, i + 5)) && !isIdent(value[i - 1])) { const o = value.indexOf('(', i); const e = skipBalanced(o); out.push(value.slice(i, e)); i = e; continue; }
    i++;
  } return out;
}
