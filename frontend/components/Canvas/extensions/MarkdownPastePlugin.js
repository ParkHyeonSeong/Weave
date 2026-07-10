import { Plugin } from '@tiptap/pm/state';
import { DOMParser as ProseDOMParser } from '@tiptap/pm/model';
import { markdownToHtml, looksLikeMarkdown } from '@/library/markdownMath';

// HTML 문자열을 현재 스키마로 파싱해 선택 영역에 꽂아 넣는다 (raw-escape/md-convert 경로 공용).
function replaceSelectionWithHtml(view, html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const slice = ProseDOMParser.fromSchema(view.state.schema).parseSlice(wrapper);
  view.dispatch(view.state.tr.replaceSelection(slice));
}

export function createMarkdownPastePlugin() {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        // Cmd/Ctrl+Shift+V 탈출구: md 변환을 건너뛰어 raw 텍스트 그대로 붙인다.
        // false를 위임(PM 기본 doPaste)하면 PM이 plain 텍스트 슬라이스는 만들어주지만,
        // 그 트랜잭션에 uiEvent=paste 메타를 무조건 붙여버려서 Tiptap의 Bold/Italic/
        // Strike/Code 마크 pasteRules(별도 appendTransaction)가 붙여넣은 텍스트를 다시
        // 스캔해 **/`` 같은 인라인 문법을 마크로 변환해버린다(헤딩 같은 블록 문법은
        // addPasteRules가 없어 안 걸리지만 인라인 마크는 새는 구멍). 그래서 여기서 직접
        // 이스케이프한 문단/줄바꿈만으로 슬라이스를 만들어 uiEvent 메타 없이 디스패치한다.
        if (view.input.shiftKey) {
          const text = event.clipboardData?.getData('text/plain');
          if (!text) return false;

          event.preventDefault();

          const escapeHtml = (s) =>
            s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const html = text
            .replace(/\r\n?/g, '\n') // CRLF 정규화 — \n{2,} 문단 분리가 Windows 클립보드에서도 성립
            .split(/\n{2,}/)
            .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
            .join('');

          replaceSelectionWithHtml(view, html);
          return true;
        }

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

        replaceSelectionWithHtml(view, converted);
        return true;
      },
    },
  });
}
