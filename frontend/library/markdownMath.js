import { Marked } from 'marked';
import { createWeaveMarked, weaveMarkedToHtml } from './markedFactory';

// data-latex는 속성값으로 들어가므로 &, <, >, " 이스케이프 필수
function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 블록: 문단 시작의 $$...$$ (여러 줄 블록만 처리)
const blockMathExtension = {
  name: 'blockMathMd',
  level: 'block',
  start(src) {
    // $$ 으로 시작하는 경우만 블록 레벨 처리 시도
    return src.startsWith('$$') ? 0 : -1;
  },
  tokenizer(src) {
    // 여러 줄 블록 수식: $$\n...\n$$ 형태 (블록이므로 반드시 뉴라인 포함)
    const multiLineMatch = /^\$\$\n([\s\S]+?)\n\$\$(?:\n+|$)/.exec(src);
    if (multiLineMatch) {
      return {
        type: 'blockMathMd',
        raw: multiLineMatch[0],
        latex: multiLineMatch[1].trim(),
      };
    }
    // 한 줄 블록: $$x^2$$ 뒤에 개행/EOF (라인이 전체 블록인 경우)
    const singleLineMatch = /^\$\$([^$\n]+?)\$\$(?:\n+|$)/.exec(src);
    if (singleLineMatch) {
      return {
        type: 'blockMathMd',
        raw: singleLineMatch[0],
        latex: singleLineMatch[1].trim(),
      };
    }
  },
  renderer(token) {
    // 블록 레벨 렌더링은 div로만
    return `<div data-type="block-math" data-latex="${escapeAttr(token.latex)}"></div>\n`;
  },
};

// 인라인: $$...$$ (단일 라인, 문단 중간) 또는 $...$
// (pandoc 스타일 가드 — 여닫는 $ 안쪽 공백 금지,
// 닫는 $ 뒤 숫자 금지: "$5 and $10" 같은 금액 표기 오탐 방지.
// tiptap mathMigrationRegex의 (?!\d) 가드와 동일 취지)
const inlineMathExtension = {
  name: 'inlineMathMd',
  level: 'inline',
  start(src) { return src.indexOf('$'); },
  tokenizer(src) {
    // 단일 라인 인라인 $$...$$ (공백 앞뒤 없음)
    const dollar2 = /^\$\$([^$\n]+?)\$\$(?!\$)/.exec(src);
    if (dollar2) return { type: 'inlineMathMd', raw: dollar2[0], latex: dollar2[1].trim() };
    // 단일 $ (공백 앞뒤 없음, 닫는 $ 뒤 숫자 없음)
    const dollar1 = /^\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$(?!\d)/.exec(src);
    if (dollar1) return { type: 'inlineMathMd', raw: dollar1[0], latex: dollar1[1] };
  },
  renderer(token) {
    return `<span data-type="inline-math" data-latex="${escapeAttr(token.latex)}"></span>`;
  },
};

// 인스턴스 분리: 전역 marked를 오염시키지 않는다. createWeaveMarked로 dialect(bare URL
// de-link)·빈 라벨 폴백을 direct 경로에도 통일한다(WEAVE-37 Task 4).
const plainMarked = createWeaveMarked();
const mathMarked = createWeaveMarked();
mathMarked.use({ extensions: [blockMathExtension, inlineMathExtension] });

// ⚠️ .parse()는 shadow한 md.lexer를 호출하지 않는다(19차 P1 실측) — 반드시 명시적
//    lexer→정규화→parser 경로(weaveMarkedToHtml)를 써야 direct 경로도 정규화된다.
export function markdownToHtml(text, { math = false } = {}) {
  return weaveMarkedToHtml(math ? mathMarked : plainMarked, text);
}

// 붙여넣은 텍스트가 블록 수식을 담고 있는지 — 마크다운 감지의 강한 신호로 사용
export function hasMathBlock(text) {
  return /^\$\$/m.test(text);
}

// 인라인 수식 존재 감지 — 인라인 tokenizer와 동일 가드(여닫는 $ 안쪽 공백 금지, 닫는 $ 뒤 숫자 금지)
const INLINE_MATH_RE = /\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$(?!\d)/;
export function hasInlineMath(text) {
  return INLINE_MATH_RE.test(text);
}

// 마크다운 문법 감지 (MarkdownPastePlugin에서 이관 — 변환기와 같은 파일에서 단위 테스트)
const MD_PATTERNS = [
  /^#{1,6}\s/m,          // 헤더 (# ~ ######)
  /^```/m,               // 코드 블록
  /^\*\*[^*]+\*\*/m,     // 볼드
  /^- \[[ x]\]/m,        // 체크리스트
  /^[-*+]\s/m,           // 비정렬 리스트
  /^\d+\.\s/m,           // 정렬 리스트
  /^>\s/m,               // 인용
  /^\|.+\|$/m,           // 테이블
];

// 감지 전용 raw marked 인스턴스(정규화 안 함).
// ⚠️ plainMarked(=createWeaveMarked)의 lexer는 빈 라벨을 이미 URL 라벨로 채워버리므로
//    그걸로 감지하면 항상 false다(9차 P1 실측 자기무력화) — 반드시 별도 raw lexer로 판정.
const detectMarked = new Marked({ breaks: true });

// [](url) 빈 라벨 링크가 최상위(다른 링크 밖)에 실토큰으로 존재하는가 — 정규식이 아니라
// lexer 토큰트리로 판정한다(코드스팬·이미지·이스케이프 오탐 방지 + table 셀·[][ref] 포함).
// 사전 필터는 '[' 존재만(ref-style [][r]은 '](' 없이도 빈 링크 — 5차 prefilter 결함).
export function hasEmptyLabelLink(text) {
  if (!text || !text.includes('[')) return false;
  let found = false;
  const walk = (tokens, inLink) => {
    for (const t of tokens || []) {
      if (found) return;
      if (t.type === 'link') {
        if (!inLink && !(t.tokens && t.tokens.length) && t.href) { found = true; return; }
        walk(t.tokens, true);
      } else if (t.type === 'table') {
        (t.header || []).forEach((c) => walk(c.tokens, inLink));
        (t.rows || []).forEach((r) => r.forEach((c) => walk(c.tokens, inLink)));
      } else if (t.type !== 'codespan' && t.type !== 'code') {
        walk(t.tokens, inLink);              // t.tokens가 [] truthy여서 items 건너뛰는 것 방지(9차)
        walk(t.items, inLink);
      }
    }
  };
  walk(detectMarked.lexer(text), false);
  return found;
}

export function looksLikeMarkdown(text, { math = false } = {}) {
  // 헤더/코드블록/(수식 노드를 아는 에디터에선) 블록·인라인 수식은 단독으로도 마크다운 판정
  if (MD_PATTERNS[0].test(text) || MD_PATTERNS[1].test(text)) return true;
  if (hasEmptyLabelLink(text)) return true; // WEAVE-37: 빈 라벨 링크 무음 소실 방지(단독 강신호)
  if (math && (hasMathBlock(text) || hasInlineMath(text))) return true;

  let matchCount = 0;
  for (const pattern of MD_PATTERNS) {
    if (pattern.test(text)) matchCount++;
    if (matchCount >= 2) return true;
  }
  return false;
}
