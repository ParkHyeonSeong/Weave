// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { applyLinkValue, isEditingLink, editingLinkMark } from './editorLink.js';

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

  it('editingLinkMark는 인접 경계에서 오른쪽(nodeAfter) 링크 href를 반환한다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a><a href="https://b.com">two</a></p>');
    editor.commands.setTextSelection(4); // one(1-4)|two 경계
    expect(editingLinkMark(editor)?.attrs.href).toBe('https://b.com');
  });

  it('인접한 다른 링크 경계에서 편집은 오른쪽 링크만 바꾸고 병합하지 않는다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a><a href="https://b.com">two</a></p>');
    editor.commands.setTextSelection(4);
    applyLinkValue(editor, 'c.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://a.com"');     // 왼쪽 링크 유지
    expect(html).toContain('href="https://c.com"');      // 오른쪽만 변경
    expect(html).not.toContain('href="https://b.com"');  // b → c
    expect(html).not.toMatch(/onetwo/);                  // 병합 안 됨
  });

  it('인접한 다른 링크 경계에서 빈 입력은 오른쪽 링크만 해제한다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a><a href="https://b.com">two</a></p>');
    editor.commands.setTextSelection(4);
    applyLinkValue(editor, '');
    const html = editor.getHTML();
    expect(html).toContain('href="https://a.com"');      // 왼쪽 유지
    expect(html).not.toContain('href="https://b.com"');  // 오른쪽만 해제
  });

  it('빈 입력이면 선택된 링크를 해제한다', () => {
    editor = makeEditor('<p><a href="https://x.com">hi</a></p>');
    editor.commands.setTextSelection({ from: 1, to: 3 });
    applyLinkValue(editor, '');
    expect(editor.getHTML()).not.toContain('<a');
  });
});

describe('Edge cases - same href adjacent links', () => {
  // ProseMirror는 동일 attrs(같은 href) 인접 텍스트 노드를 하나로 coalesce한다.
  // 따라서 '같은 href 인접 링크 2개'는 모델에 존재할 수 없고 항상 단일 링크('leftright')다.
  // → 경계에서 편집하면 합쳐진 링크 전체가 갱신되는 게 올바른 동작.
  it('같은 href 인접 링크는 모델상 1개로 합쳐져 편집 시 전체가 갱신된다', () => {
    editor = makeEditor('<p><a href="https://same.com">left</a><a href="https://same.com">right</a></p>');
    editor.commands.setTextSelection(5); // 합쳐진 단일 링크 내부
    const mark = editingLinkMark(editor);
    expect(mark?.attrs.href).toBe('https://same.com');
    applyLinkValue(editor, 'new.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://new.com"');
    expect(html).not.toContain('href="https://same.com"'); // 합쳐진 링크 전체 갱신
    expect((html.match(/<a /g) || []).length).toBe(1);      // 모델상 1개 링크
    expect(html).toContain('>leftright</a>');
  });
});

describe('Edge cases - left boundary', () => {
  it('왼쪽 경계: 링크 시작점에 커서', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a>two</p>');
    editor.commands.setTextSelection(1); // <p>|<a>one
    const mark = editingLinkMark(editor);
    expect(mark?.attrs.href).toBe('https://a.com');
    applyLinkValue(editor, 'new.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://new.com"');
    expect(html).not.toContain('href="https://a.com"');
  });
});

describe('Edge cases - Canvas autolink inclusive', () => {
  it('Canvas autolink: 오른쪽 경계에서 isActive(link) true여도 editingLinkMark는 null', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a></p>');
    editor.commands.setTextSelection(4); // 오른쪽 경계
    // isActive는 inclusive 때문에 true일 수 있으나 nodeAfter 검사는 null → 편집 아님
    expect(editor.isActive('link')).toBe(true);
    expect(editingLinkMark(editor)).toBe(null);
    // 빈 입력이어도 unsetLink 실행 안 됨(이전 링크 보존)
    applyLinkValue(editor, '');
    expect(editor.getHTML()).toContain('href="https://a.com"');
  });
});

describe('Edge cases - scoping with multiple attrs', () => {
  it('target/rel 포함 링크: href 스코핑으로 정확한 링크 선택', () => {
    editor = makeEditor('<p><a href="https://a.com" target="_blank">one</a><a href="https://b.com" rel="noopener">two</a></p>');
    editor.commands.setTextSelection(4); // 경계
    const mark = editingLinkMark(editor);
    expect(mark?.attrs.href).toBe('https://b.com');
    // extendMarkRange({href}) 호출: findMarkInSet가 href만 확인
    applyLinkValue(editor, 'c.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://a.com"');
    expect(html).toContain('href="https://c.com"');
    expect(html).not.toContain('href="https://b.com"');
  });
});
