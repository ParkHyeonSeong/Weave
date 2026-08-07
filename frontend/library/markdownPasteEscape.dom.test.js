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

  it('Shift 붙여넣기(Cmd+Shift+V)는 블록 md 변환을 건너뛴다 (raw 텍스트로 삽입)', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p></p>' });
    editor.view.input.shiftKey = true;
    const handled = plugin.props.handlePaste(editor.view, makePasteEvent('# 제목'));
    expect(handled).toBe(true); // 직접 raw 슬라이스를 만들어 디스패치
    expect(editor.getHTML()).not.toContain('<h1');
    expect(editor.getText()).toContain('# 제목');
  });

  it('Shift 붙여넣기는 인라인 md 문법(굵게 등)도 마크로 변환되지 않아야 한다', () => {
    // 회귀 방지: PM 기본 doPaste에 위임(return false)하면 uiEvent=paste 메타가 붙어
    // Tiptap 마크 pasteRules(Bold/Italic/Strike/Code)가 붙여넣은 텍스트를 다시 스캔해
    // **/`` 같은 인라인 문법을 마크로 변환해버리는 구멍이 있었다.
    editor = new Editor({ extensions: [StarterKit], content: '<p></p>' });
    editor.view.input.shiftKey = true;
    const handled = plugin.props.handlePaste(editor.view, makePasteEvent('**굵게**'));
    expect(handled).toBe(true);
    expect(editor.getHTML()).not.toContain('<strong');
    expect(editor.getText()).toContain('**굵게**');
  });

  it('Shift 붙여넣기는 문단 구분(빈 줄)을 유지한다', () => {
    editor = new Editor({ extensions: [StarterKit], content: '<p></p>' });
    editor.view.input.shiftKey = true;
    plugin.props.handlePaste(editor.view, makePasteEvent('첫 문단\n\n둘째 문단'));
    const paragraphs = editor.getJSON().content.filter((n) => n.type === 'paragraph');
    expect(paragraphs.length).toBe(2);
  });

  it('[](url) 단독 붙여넣기는 URL 라벨 링크로 변환된다 (빈 라벨 폴백 — WEAVE-37)', () => {
    // looksLikeMarkdown이 hasEmptyLabelLink로 감지 → markdownToHtml이 URL을 라벨로 채워 삽입.
    editor = new Editor({ extensions: [StarterKit], content: '<p></p>' });
    editor.view.input.shiftKey = false;
    const handled = plugin.props.handlePaste(editor.view, makePasteEvent('[](https://example.com)'));
    expect(handled).toBe(true);
    const findLink = (n) => ((n?.type === 'text' && n.marks?.find((m) => m.type === 'link'))
      ? n : (n?.content || []).reduce((acc, c) => acc ?? findLink(c), null));
    const node = findLink(editor.getJSON());
    expect(node).toBeTruthy();
    expect(node.text).toBe('https://example.com');                                  // 텍스트 === URL
    expect(node.marks.find((m) => m.type === 'link').attrs.href).toBe('https://example.com');
  });
});
