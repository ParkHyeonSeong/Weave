// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { buildMarkdownExtensions } from './markdownCodec.js';
import { MarkdownClipboardExtension } from '@/components/Canvas/extensions/MarkdownClipboardExtension';

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

// PM 공식 API: someProp은 등록된 prop 함수에 콜백을 적용해 첫 non-undefined를 반환
function serializeSlice(ed, slice) {
  return ed.view.someProp('clipboardTextSerializer', (f) => f(slice, ed.view));
}

describe('MarkdownClipboardExtension', () => {
  it('전체 선택 복사 시 text/plain에 markdown 서식을 싣는다', () => {
    editor = new Editor({
      extensions: buildMarkdownExtensions([StarterKit, MarkdownClipboardExtension]),
      content: '<h2>Title</h2><p><strong>bold</strong> plain</p>',
    });
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    const text = serializeSlice(editor, slice);
    expect(text).toContain('## Title');
    expect(text).toContain('**bold**');
  });

  it('부분 선택 slice도 markdown으로 직렬화한다', () => {
    editor = new Editor({
      extensions: buildMarkdownExtensions([StarterKit, MarkdownClipboardExtension]),
      content: '<p>plain</p><p><strong>bold</strong></p>',
    });
    // 두 번째 문단의 'bold' (p"plain"이 pos 0..6 → 두 번째 p 텍스트는 8..12)
    editor.commands.setTextSelection({ from: 8, to: 12 });
    const text = serializeSlice(editor, editor.state.selection.content());
    expect(text.trim()).toBe('**bold**');
  });
});
