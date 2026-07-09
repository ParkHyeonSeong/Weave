import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { sliceToMarkdown } from '@/library/markdownCodec';

// 선택 복사(Cmd+C/Cmd+X) 시 text/plain에 markdown을 싣는다.
// clipboardTextSerializer는 PM 사양상 text/plain 전용 prop이라
// text/html 직렬화(리치 붙여넣기 경로)는 기존 그대로 유지된다.
export const MarkdownClipboardExtension = Extension.create({
  name: 'markdownClipboard',

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: new PluginKey('markdownClipboard'),
        props: {
          clipboardTextSerializer(slice) {
            try {
              return sliceToMarkdown(editor, slice);
            } catch {
              // 방어: 직렬화 실패 시 PM 기본 text/plain과 동일한 평문 폴백
              // (복사 자체가 죽는 것 방지 — 의도적으로 단위 테스트 없음)
              return slice.content.textBetween(0, slice.content.size, '\n\n');
            }
          },
        },
      }),
    ];
  },
});
