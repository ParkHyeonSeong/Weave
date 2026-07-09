// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createMarkdownPastePlugin } from '@/components/Canvas/extensions/MarkdownPastePlugin';

function makePasteEvent(text) {
  return {
    clipboardData: { getData: (type) => (type === 'text/plain' ? text : '') },
    preventDefault() {},
  };
}

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('MarkdownPastePlugin shift 탈출구', () => {
  const plugin = createMarkdownPastePlugin();

  it('일반 붙여넣기는 markdown을 변환한다 (handled=true)', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p></p>' });
    editor.view.input.shiftKey = false;
    const handled = plugin.props.handlePaste(editor.view, makePasteEvent('# 제목'));
    expect(handled).toBe(true);
    expect(editor.getHTML()).toContain('<h1');
    expect(editor.getText()).toContain('제목');
  });

  it('Shift 붙여넣기(Cmd+Shift+V)는 md 변환을 건너뛴다 (handled=false)', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p></p>' });
    editor.view.input.shiftKey = true;
    const handled = plugin.props.handlePaste(editor.view, makePasteEvent('# 제목'));
    expect(handled).toBe(false); // PM 기본 plain text 삽입에 위임
  });
});
