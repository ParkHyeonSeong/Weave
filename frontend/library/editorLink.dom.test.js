// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { applyLinkValue, isEditingLink } from './editorLink.js';

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

  it('inclusive 링크 오른쪽 경계에서는 기존 링크를 덮어쓰지 않고 새 링크를 삽입한다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a></p>');
    editor.commands.setTextSelection(4); // 'one' 뒤(autolink:true → inclusive 경계, isActive('link')===true)
    applyLinkValue(editor, 'two.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://a.com"');    // 기존 링크 유지
    expect(html).toContain('href="https://two.com"');   // 새 링크 추가
  });

  it('링크 내부 커서에서는 기존 href를 갱신한다(텍스트 유지)', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a></p>');
    editor.commands.setTextSelection(2); // 'o|ne' 링크 내부
    applyLinkValue(editor, 'two.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://two.com"');
    expect(html).not.toContain('href="https://a.com"'); // 덮어씀
    expect(html).toContain('>one</a>');                  // 텍스트 유지
  });

  it('링크 왼쪽 경계에서는 새 링크 삽입이 아니라 기존 href를 갱신한다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a>two</p>');
    editor.commands.setTextSelection(1); // 'one' 앞(왼쪽 경계)
    applyLinkValue(editor, 'three.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://three.com"');
    expect(html).not.toContain('href="https://a.com"');
    expect((html.match(/<a /g) || []).length).toBe(1); // 링크 1개(앞에 새 링크 안 생김)
  });

  it('단일 문자 링크도 왼쪽 경계에서 편집된다', () => {
    editor = makeEditor('<p><a href="https://a.com">x</a>y</p>');
    editor.commands.setTextSelection(1); // 'x' 앞
    applyLinkValue(editor, 'three.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://three.com"');
    expect((html.match(/<a /g) || []).length).toBe(1);
  });

  it('isEditingLink: 오른쪽 경계는 false, 내부·왼쪽 경계는 true', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a>two</p>');
    editor.commands.setTextSelection(4); expect(isEditingLink(editor)).toBe(false); // 오른쪽 경계
    editor.commands.setTextSelection(2); expect(isEditingLink(editor)).toBe(true);  // 내부
    editor.commands.setTextSelection(1); expect(isEditingLink(editor)).toBe(true);  // 왼쪽 경계
  });

  it('오른쪽 경계(뒤에 비링크 텍스트)에서 새 입력은 기존 링크를 덮지 않고 새 링크를 만든다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a>two</p>');
    editor.commands.setTextSelection(4); // 'one' 뒤, nodeAfter='two'(비링크)
    applyLinkValue(editor, 'new.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://a.com"');    // 기존 유지
    expect(html).toContain('href="https://new.com"');   // 새 링크
    expect(html).toContain('>one</a>');                 // 'one' 텍스트 유지
  });

  it('오른쪽 경계에서 빈 입력은 기존(이전) 링크를 지우지 않는다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a>two</p>');
    editor.commands.setTextSelection(4); // 오른쪽 경계
    applyLinkValue(editor, '');
    expect(editor.getHTML()).toContain('href="https://a.com"'); // 그대로 유지
  });

  it('링크 내부에서 빈 입력은 그 링크를 해제한다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a></p>');
    editor.commands.setTextSelection(2); // 내부
    applyLinkValue(editor, '');
    expect(editor.getHTML()).not.toContain('<a');
  });

  it('빈 입력이면 선택된 링크를 해제한다', () => {
    editor = makeEditor('<p><a href="https://x.com">hi</a></p>');
    editor.commands.setTextSelection({ from: 1, to: 3 });
    applyLinkValue(editor, '');
    expect(editor.getHTML()).not.toContain('<a');
  });
});
