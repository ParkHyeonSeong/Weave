import { Plugin } from '@tiptap/pm/state';
import { DOMParser as ProseDOMParser } from '@tiptap/pm/model';
import { marked } from 'marked';

// 마크다운 문법 감지 패턴
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

function looksLikeMarkdown(text) {
  // 최소 2개 이상의 패턴이 매치되거나, 헤더/코드블록이 있으면 마크다운으로 판단
  const headerOrCode = MD_PATTERNS[0].test(text) || MD_PATTERNS[1].test(text);
  if (headerOrCode) return true;

  let matchCount = 0;
  for (const pattern of MD_PATTERNS) {
    if (pattern.test(text)) matchCount++;
    if (matchCount >= 2) return true;
  }
  return false;
}

export function createMarkdownPastePlugin() {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        // HTML이 있으면 리치 콘텐츠 우선 (다른 에디터에서 복사한 경우)
        const html = event.clipboardData?.getData('text/html');
        if (html) return false;

        const text = event.clipboardData?.getData('text/plain');
        if (!text || !looksLikeMarkdown(text)) return false;

        event.preventDefault();

        // marked로 마크다운 → HTML 변환
        const converted = marked.parse(text, { breaks: true });

        // HTML을 ProseMirror 노드로 파싱
        const wrapper = document.createElement('div');
        wrapper.innerHTML = converted;
        const slice = ProseDOMParser.fromSchema(view.state.schema)
          .parseSlice(wrapper);

        const tr = view.state.tr.replaceSelection(slice);
        view.dispatch(tr);
        return true;
      },
    },
  });
}
