import { Plugin } from '@tiptap/pm/state';
import { DOMParser as ProseDOMParser } from '@tiptap/pm/model';
import { markdownToHtml, looksLikeMarkdown } from '@/library/markdownMath';

export function createMarkdownPastePlugin() {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        // Cmd/Ctrl+Shift+V 탈출구: md 변환을 건너뛰어 raw 텍스트 그대로 붙인다
        // (PM 기본 동작이 shift 붙여넣기를 plain text로 처리하므로 false 위임이면 충분)
        if (view.input.shiftKey) return false;

        // HTML이 있으면 리치 콘텐츠 우선 (다른 에디터에서 복사한 경우)
        const html = event.clipboardData?.getData('text/html');
        if (html) return false;

        // 스키마 가드: 수식 노드가 없는 에디터에선 수식 변환·감지 비활성
        // (ProseMirror parseSlice가 미지 노드를 드롭해 내용이 사라지는 것 방지)
        const math = !!view.state.schema.nodes.inlineMath;

        const text = event.clipboardData?.getData('text/plain');
        if (!text || !looksLikeMarkdown(text, { math })) return false;

        event.preventDefault();

        const converted = markdownToHtml(text, { math });

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
