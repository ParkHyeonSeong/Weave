// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { applyLinkValue } from './editorLink.js';

// Canvas의 최악 케이스(autolink:true → Link.inclusive:true)로 에디터를 만들어
// "삽입 직후 다음 입력이 링크로 이어짐"까지 잡는다. Scrum(autolink:false)은 더 안전한 부분집합.
function makeEditor(content = '<p></p>') {
  return new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } })],
    content,
  });
}

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('applyLinkValue', () => {
  it('빈 선택이면 URL을 클릭 가능한 텍스트로 삽입하고 href를 정규화한다', () => {
    editor = makeEditor();
    editor.commands.focus();
    applyLinkValue(editor, 'example.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com"');
    expect(editor.getText()).toBe('example.com');
  });

  it('삽입 직후 일반 텍스트 입력이 링크로 이어지지 않는다 (stored mark 제거)', () => {
    editor = makeEditor();
    editor.commands.focus();
    applyLinkValue(editor, 'example.com');
    // 실제 타이핑과 동일하게 storedMarks/inclusive를 반영하는 insertText로 다음 글자 입력
    editor.view.dispatch(editor.state.tr.insertText('X'));
    // X가 링크 바깥(</a> 뒤)에 있어야 한다
    expect(editor.getHTML()).toMatch(/<\/a>X/);
  });

  it('텍스트가 선택돼 있으면 선택 범위에 링크 mark를 적용한다', () => {
    editor = makeEditor('<p>hello</p>');
    editor.commands.setTextSelection({ from: 1, to: 6 });
    applyLinkValue(editor, 'example.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>hello</a>');
  });

  it('위험 스킴(javascript:)은 삽입/링크되지 않고 문서에 raw href가 남지 않는다', () => {
    editor = makeEditor();
    editor.commands.focus();
    applyLinkValue(editor, 'javascript:alert(1)');
    expect(editor.getText()).toBe('');
    expect(editor.getHTML()).not.toContain('javascript');
  });

  it('빈 입력이면 선택된 링크를 해제한다', () => {
    editor = makeEditor('<p><a href="https://x.com">hi</a></p>');
    editor.commands.setTextSelection({ from: 1, to: 3 });
    applyLinkValue(editor, '');
    expect(editor.getHTML()).not.toContain('<a');
  });
});
