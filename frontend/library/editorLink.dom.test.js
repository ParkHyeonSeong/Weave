// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { applyLinkValue, isEditingLink, editingLinkMark } from './editorLink.js';
import WeaveLink from '../components/Canvas/extensions/WeaveLink.js';
import { WEAVE_CORE_EXTENSION_OPTIONS } from './editorCoreOptions.js';

// Canvas의 최악 케이스(autolink:true → Link.inclusive:true)로 에디터를 만들어
// "삽입 직후 다음 입력이 링크로 이어짐"까지 잡는다. Scrum(autolink:false)은 더 안전한 부분집합.
function makeEditor(content = '<p></p>') {
  return new Editor({
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true } })],
    content,
  });
}

// 프로덕션 4표면(TaskDesc·Comment·Issue·Canvas)과 동일 구성: StarterKit link:false + WeaveLink.
// 모듈 스코프(형제 describe 재사용) + core guard(삭제+removeMark를 직접 검증하므로 Task 1이
// 막은 비동기 RangeError가 테스트에서 되살아나는 것 방지).
function makeWeaveLinkEditor(content = '<p></p>') {
  return new Editor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false }),
      WeaveLink.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    ],
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
  it('target/rel 포함 링크: 경계 편집은 대상 링크만 선택', () => {
    editor = makeEditor('<p><a href="https://a.com" target="_blank">one</a><a href="https://b.com" rel="noopener">two</a></p>');
    editor.commands.setTextSelection(4); // 경계
    const mark = editingLinkMark(editor);
    expect(mark?.attrs.href).toBe('https://b.com');
    applyLinkValue(editor, 'c.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://a.com"');
    expect(html).toContain('href="https://c.com"');
    expect(html).not.toContain('href="https://b.com"');
  });
});

describe('Edge cases - 선택 범위는 확장하지 않음(인접 링크)', () => {
  it('오른쪽 링크 텍스트만 선택해 편집하면 그 링크만 바뀐다(왼쪽 안 번짐)', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a><a href="https://b.com">two</a></p>');
    editor.commands.setTextSelection({ from: 4, to: 7 }); // 'two'(4-7)만 선택
    applyLinkValue(editor, 'c.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://a.com"');     // one 유지
    expect(html).toContain('href="https://c.com"');      // two만 변경
    expect(html).not.toContain('href="https://b.com"');
    expect(html).not.toMatch(/onetwo/);                  // 병합 안 됨
  });

  it('오른쪽 링크 텍스트만 선택 후 빈 입력은 그 링크만 해제한다', () => {
    editor = makeEditor('<p><a href="https://a.com">one</a><a href="https://b.com">two</a></p>');
    editor.commands.setTextSelection({ from: 4, to: 7 });
    applyLinkValue(editor, '');
    const html = editor.getHTML();
    expect(html).toContain('href="https://a.com"');      // one 유지
    expect(html).not.toContain('href="https://b.com"');  // two만 해제
  });
});

describe('Edge cases - 같은 href·다른 attrs 인접 링크(전체 attrs 스코프)', () => {
  it('href는 같고 title이 다른 인접 링크 경계 편집은 한쪽만 바꾼다', () => {
    editor = makeEditor('<p></p>');
    // title이 달라 coalesce되지 않는 별도 mark 2개를 명시적으로 삽입
    editor.chain().focus().insertContent([
      { type: 'text', text: 'left', marks: [{ type: 'link', attrs: { href: 'https://same.com', title: 'L' } }] },
      { type: 'text', text: 'right', marks: [{ type: 'link', attrs: { href: 'https://same.com', title: 'R' } }] },
    ]).run();
    editor.commands.setTextSelection(5); // left(1-5)|right 경계
    applyLinkValue(editor, 'new.com');
    const html = editor.getHTML();
    expect(html).toContain('href="https://new.com"');                          // 오른쪽만 변경
    expect((html.match(/href="https:\/\/same\.com"/g) || []).length).toBe(1);  // 왼쪽 유지
    expect((html.match(/<a /g) || []).length).toBe(2);                          // 병합 안 됨
  });
});

describe('WeaveLink - inclusive를 autolink에서 분리 (WEAVE-37)', () => {
  it('업스트림 Link(autolink:true)는 끝 글자 삭제 후 재입력 시 link를 상속한다 — 버그 재현 핀', () => {
    // 이 테스트가 tiptap 업그레이드 후 깨지면 업스트림이 inclusive를 분리한 것 → WeaveLink 제거 검토 신호
    editor = makeEditor('<p><a href="https://a.com">one</a></p>'); // 기존 팩토리 = inclusive:true
    editor.commands.setTextSelection(4);                    // 'one' 끝
    editor.view.dispatch(editor.state.tr.delete(3, 4));     // 'e' 삭제 → 커서가 링크 오른쪽 경계(3)
    editor.view.dispatch(editor.state.tr.insertText('X'));  // 재입력
    expect(editor.getHTML()).toMatch(/onX<\/a>/);           // X가 링크 안으로 상속(잔존 버그)
  });

  it('WeaveLink: 링크 끝 글자 삭제 후 재입력 시 link mark를 상속하지 않는다', () => {
    editor = makeWeaveLinkEditor('<p><a href="https://a.com">one</a></p>');
    editor.commands.setTextSelection(4);
    editor.view.dispatch(editor.state.tr.delete(3, 4));
    editor.view.dispatch(editor.state.tr.insertText('X'));
    const html = editor.getHTML();
    expect(html).toMatch(/<\/a>X/);                          // X가 링크 밖
    expect(html).toContain('href="https://a.com"');          // 기존 링크는 유지
  });

  it('WeaveLink: autolink는 유지된다 (URL 타이핑 + 공백 → 자동 링크)', () => {
    editor = makeWeaveLinkEditor();
    editor.view.dispatch(editor.state.tr.insertText('visit example.com '));
    expect(editor.getHTML()).toMatch(/href="http:\/\/example\.com\/?"/);
  });

  it('WeaveLink 에디터에서도 applyLinkValue 삽입 직후 연속 입력이 차단된다 (editorLink.js:82와 상보)', () => {
    editor = makeWeaveLinkEditor();
    editor.commands.focus();
    applyLinkValue(editor, 'example.com');
    editor.view.dispatch(editor.state.tr.insertText('X'));
    expect(editor.getHTML()).toMatch(/<\/a>X/);
  });
});

describe('WeaveLink 링크 무결성 플러그인 (WEAVE-37 잔존 경로)', () => {
  // R1 라이브 재현(2026-07-14): 더블클릭 부분선택 삭제 후 내부 타이핑이 옛 href로 전부 링크됨
  it('URL-미러 링크의 부분 삭제는 링크를 통째로 해제한다 (Rule B)', () => {
    editor = makeWeaveLinkEditor(
      '<p>start <a href="https://example.com">https://example.com</a> end</p>'
    );
    // 'example' 구간 삭제 → 텍스트 "https://.com" ≠ href
    // 실제 제스처: 선택 → Backspace → **현재 selection 위치**에 타이핑(14차 P2: 하드코딩 16은
    // 삭제 후 실제 caret(15)이 아니었고, 삽입된 NEW도 확인하지 않았다).
    editor.commands.setTextSelection({ from: 15, to: 22 });
    editor.commands.deleteSelection();
    const html = editor.getHTML();
    expect(html).not.toContain('<a ');           // mark 해제 → 잔존물이 평문화
    expect(html).toContain('https://.com');       // 텍스트 자체는 보존(사용자가 지우게)
    editor.commands.insertContent('NEW');         // 삭제 직후 caret에 타이핑(R1 재현 제스처)
    expect(editor.getText()).toContain('https://NEW.com');
    expect(editor.getHTML()).not.toContain('<a ');
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"'); // link mark 0개
  });

  it('라벨 링크의 라벨 부분 편집은 링크를 유지한다 (Rule B 비적용)', () => {
    editor = makeWeaveLinkEditor('<p><a href="https://x.com">click here</a></p>');
    editor.commands.deleteRange({ from: 6, to: 11 }); // ' here' 삭제 → 'click'
    expect(editor.getHTML()).toContain('href="https://x.com"');
    expect(editor.getHTML()).toContain('>click</a>');
  });

  it('공백만 남은 링크런은 mark만 제거하고 공백 텍스트는 남긴다 (Rule A — 17차 P2)', () => {
    editor = makeWeaveLinkEditor('<p><a href="https://x.com">a b</a></p>');
    editor.commands.deleteRange({ from: 3, to: 4 }); // 'b' 삭제
    editor.commands.deleteRange({ from: 1, to: 2 }); // 'a' 삭제 → marked ' '만 잔존
    expect(editor.getHTML()).not.toContain('<a ');
    expect(editor.getText()).toBe(' ');             // 공백 텍스트는 보존(mark만 제거)
  });

  it('storedMarks의 link는 즉시 제거된다 (Rule C — DOM-변이 삭제 주입 방어)', () => {
    editor = makeWeaveLinkEditor('<p><a href="https://x.com">x</a>y</p>');
    const { state } = editor;
    const link = state.schema.marks.link.create({ href: 'https://x.com' });
    editor.view.dispatch(state.tr.setStoredMarks([link]));
    expect(editor.state.storedMarks?.some((m) => m.type.name === 'link') ?? false).toBe(false);
  });

  it('Rule C는 link만 제거하고 bold 등 비링크 stored mark는 보존한다 (8차 P1)', () => {
    editor = makeWeaveLinkEditor('<p><a href="https://x.com">x</a>y</p>');
    const { state } = editor;
    const link = state.schema.marks.link.create({ href: 'https://x.com' });
    const bold = state.schema.marks.bold.create();
    editor.view.dispatch(state.tr.setStoredMarks([bold, link]));
    const names = (editor.state.storedMarks || []).map((m) => m.type.name);
    expect(names).toContain('bold');       // 보존
    expect(names).not.toContain('link');   // 제거
  });

  it('Rule A/B가 문서 link를 지우는 동시에 storedMarks=[bold]가 보존된다 (14·15차 P1 — 통합)', () => {
    // 15차 실측: setStoredMarks와 deleteRange를 **별도 dispatch**하면 삭제 tr의 ReplaceStep이
    // storedMarks를 null로 리셋해(실측 (A) → null) 플러그인 실행 시점엔 bold 정보가 이미 없다.
    // → 삭제와 stored mark 주입을 **같은 root transaction**으로 보내야 한다(실측 (B) → ['bold']).
    editor = makeWeaveLinkEditor(
      '<p>start <a href="https://example.com">https://example.com</a> end</p>'
    );
    editor.commands.setTextSelection({ from: 15, to: 22 });         // 'example' 선택
    const bold = editor.state.schema.marks.bold.create();
    editor.view.dispatch(
      editor.state.tr.deleteSelection().setStoredMarks([bold])      // delete step **뒤에** stored 설정
    );
    expect(editor.getHTML()).not.toContain('<a ');                  // 문서 link 해제(Rule B)
    expect((editor.state.storedMarks || []).map((m) => m.type.name)).toEqual(['bold']); // bold 보존
  });

  it('무관한 편집은 기존 링크를 건드리지 않는다', () => {
    editor = makeWeaveLinkEditor(
      '<p><a href="https://example.com">https://example.com</a> tail</p>'
    );
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, '!');
    expect(editor.getHTML()).toContain('>https://example.com</a>');
  });

  it('www 형태 미러(href에 프로토콜 보강됨)도 편집 시 해제된다 (Rule B 정규화)', () => {
    editor = makeWeaveLinkEditor('<p><a href="http://www.foo.com">www.foo.com</a></p>');
    editor.commands.deleteRange({ from: 5, to: 8 }); // 'foo' 삭제
    expect(editor.getHTML()).not.toContain('<a ');
  });

  it('email 미러(mailto: href)도 편집 시 해제된다 (Rule B — linkify 판정)', () => {
    editor = makeWeaveLinkEditor(
      '<p><a href="mailto:user@example.com">user@example.com</a></p>'
    );
    editor.commands.deleteRange({ from: 2, to: 6 }); // 'ser@' 삭제
    expect(editor.getHTML()).not.toContain('<a ');
  });

  it('스킴만 다른 라벨 링크(텍스트 https://x.com, href http://x.com)는 미러가 아니다 — 편집해도 링크 유지', () => {
    editor = makeWeaveLinkEditor('<p><a href="http://x.com">https://x.com</a>z</p>');
    editor.commands.deleteRange({ from: 9, to: 10 }); // 라벨 한 글자 삭제 — 라벨 편집
    expect(editor.getHTML()).toContain('href="http://x.com"');
  });

  it('preventAutolink 메타가 붙은 삭제여도 공백-only 잔존은 정리된다 (Rule A 무조건 실행)', () => {
    editor = makeWeaveLinkEditor('<p><a href="https://x.com">x  </a>y</p>');
    const { state } = editor;
    // 팝오버 unsetLink 계열이 남길 수 있는 잔존을 모사: x만 지우고 marked 공백 2개 잔존
    const tr = state.tr.delete(1, 2).setMeta('preventAutolink', true);
    editor.view.dispatch(tr);
    expect(editor.getHTML()).not.toContain('<a ');
  });

  it('툴바(applyLinkValue) 무스킴 bare-domain 링크도 미러다 — 부분삭제 시 해제 (2차 리뷰 P1)', () => {
    editor = makeWeaveLinkEditor('<p></p>');
    // 실제 생성 경로: 라벨 "example.com"(무스킴 원문) + href https://example.com
    // (normalizeLinkHref editorLink.js:33 → insertContent :80-83). linkify 기본 보강은
    // http://라 완전일치 비교로는 미러 인식 실패 — isUrlMirror의 무스킴 관용이 계약.
    applyLinkValue(editor, 'example.com');
    expect(editor.getHTML()).toContain('href="https://example.com"');
    editor.commands.deleteRange({ from: 2, to: 5 }); // 라벨 일부 삭제 → 미러 깨짐
    expect(editor.getHTML()).not.toContain('<a ');
  });

  it('로컬 팝오버로 미러의 href만 변경하면 링크가 유지된다 (preventAutolink Rule B 스킵 — 4차 정리 항목)', () => {
    editor = makeWeaveLinkEditor('<p><a href="https://example.com">https://example.com</a></p>');
    editor.commands.setTextSelection(3); // 링크 내부 커서 → applyLinkValue의 mark 분기
    applyLinkValue(editor, 'https://changed.com'); // extendMarkRange+setLink — preventAutolink 메타
    expect(editor.getHTML()).toContain('href="https://changed.com"');
    expect(editor.getHTML()).toContain('>https://example.com</a>'); // 라벨 유지·링크 생존
  });

  it('미러 앞의 비인접 같은-attrs 새 라벨 링크 삽입은 라벨을 보존한다 (overlap — 5차 P1)', () => {
    editor = makeWeaveLinkEditor('<p>x <a href="https://example.com">https://example.com</a></p>');
    editor.commands.insertContentAt(1, {
      type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    });
    expect(editor.getHTML()).toContain('>docs</a>');
    expect(editor.getHTML()).toContain('>https://example.com</a>');
  });

  it('미러 바로 앞(인접·경계)에 같은-href 라벨 링크를 삽입해도 둘 다 해제되지 않는다 (10차 P1)', () => {
    // 인접 삽입은 병합 run "docshttps://example.com"을 만든다 — old 미러의 부분수열이 아니라 보호.
    editor = makeWeaveLinkEditor('<p><a href="https://example.com">https://example.com</a></p>');
    editor.commands.insertContentAt(1, {
      type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    });
    expect(editor.getHTML()).toContain('<a ');                 // 링크 생존(전체 unlink 아님)
    expect(editor.getText()).toContain('docshttps://example.com');
  });

  it('부분수열이 되는 병합(.com+공백 삭제 → examplecom)에서도 옆 라벨이 보존된다 (12차 P1)', () => {
    // "https://example.com" 미러 + 공백 + 같은 href "com" 라벨. 미러의 ".com"과 공백을 삭제하면
    // "https://examplecom"으로 병합 — 이 텍스트는 미러의 부분수열이라 부분수열 가드는 뚫린다.
    // containment 가드는 투영이 old 미러 범위를 넘어(옆 라벨까지) 불간섭 → 라벨 생존.
    editor = makeWeaveLinkEditor(
      '<p><a href="https://example.com">https://example.com</a> <a href="https://example.com">com</a></p>'
    );
    const dotCom = 1 + 'https://example'.length;      // '.com' 시작
    editor.commands.deleteRange({ from: dotCom, to: dotCom + '.com'.length + 1 }); // '.com'+공백 삭제
    // anchor/mark 전수 검증(13차 P2): 병합 run이 통째로 해제되지 않고 링크 mark가 살아있어야 한다
    const marked = JSON.stringify(editor.getJSON()).match(/"type":"link"/g) || [];
    expect(marked.length).toBeGreaterThan(0);        // link mark 생존
    expect(editor.getText()).toContain('examplecom');
    expect(editor.getHTML()).toContain('href="https://example.com"');
  });

  it('KNOWN LIMIT(D6): 실제 backspace 연타로 미러+라벨이 점진 병합되면 최종 삭제에서 라벨까지 해제된다', () => {
    // 14차 P1: 두 개의 **같은 href** 링크(미러 + 라벨)가 공백 하나로 인접할 때, 커서를 라벨 앞에
    // 두고 오른쪽→왼쪽 backspace로 '.com'+공백을 지우면 트랜잭션마다 병합 run이 갱신되고, 어느
    // 순간 텍스트가 정확한 미러가 됐다가 마지막 삭제에서 containment를 통과해 병합 run 전체가 해제된다.
    // 단일 트랜잭션 삭제는 보호되지만(위 테스트), 다중 트랜잭션 병합은 provenance가 소실돼 못 막는다.
    // 이 테스트는 **현재(의도된) 동작을 고정**한다 — 개선(provenance 추적, D6-옵션B) 시 기대를 뒤집는다.
    editor = makeWeaveLinkEditor(
      '<p><a href="https://example.com">https://example.com</a> <a href="https://example.com">com</a></p>'
    );
    let caret = 1 + 'https://example.com'.length + 1; // 라벨 'com' 시작(공백 뒤)
    for (let i = 0; i < 5; i += 1) { editor.commands.deleteRange({ from: caret - 1, to: caret }); caret -= 1; }
    // 알려진 한계를 **실제로 고정**한다(14차 P1: 텍스트만 보면 무플러그인 main·제안 구현·Rule B
    // 삭제 mutation이 전부 통과해 아무것도 못 잡았다). 링크가 해제된다는 현재 동작을 anchor와
    // link mark 0개로 단언 — 동작이 바뀌면(예: D6=B provenance 추적 채택) 이 테스트가 먼저 깨진다.
    expect(editor.getText()).toContain('examplecom');
    expect(editor.getHTML()).not.toContain('<a ');
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"');
  });

  it('미러 텍스트를 선택-교체(삽입 포함)하면 링크가 유지된다 — 삭제-only 계약 (11차 P1)', () => {
    // 'example'을 선택해 'e'로 교체 → 결과 "https://e.com"은 old 미러의 부분수열이지만
    // 트랜잭션에 삽입이 있어 isDeletionOnly=false → Rule B 미적용(링크 유지).
    editor = makeWeaveLinkEditor('<p><a href="https://example.com">https://example.com</a></p>');
    const start = 1 + 'https://'.length;
    editor.commands.insertContentAt({ from: start, to: start + 'example'.length }, 'e');
    expect(editor.getHTML()).toContain('href="https://example.com"'); // 링크 생존
    expect(editor.getText()).toContain('https://e.com');
  });

  it('미러 바로 뒤(인접)에 같은-href 라벨을 삽입해도 해제되지 않는다 (10차 P1)', () => {
    editor = makeWeaveLinkEditor('<p><a href="https://example.com">https://example.com</a></p>');
    const end = 1 + 'https://example.com'.length;
    editor.commands.insertContentAt(end, {
      type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
    });
    expect(editor.getHTML()).toContain('<a ');
  });

  it('미러+공백+같은-href 라벨에서 공백 삭제로 두 링크가 병합돼도 링크가 해제되지 않는다 (8·9차 P1)', () => {
    // 공백 삭제 → 동일 attrs 두 링크가 하나로 coalesce: "https://example.comdocs".
    // 병합 run의 old 투영이 단일 미러 범위를 벗어나므로 Rule B 불간섭(정당 라벨 보호).
    // 이 테스트는 플러그인 없이도 통과하는 positive control(가드가 빠지면 실패) — 9차 정정.
    editor = makeWeaveLinkEditor(
      '<p><a href="https://example.com">https://example.com</a> <a href="https://example.com">docs</a></p>'
    );
    const spacePos = 1 + 'https://example.com'.length; // 문단 시작(1) + 미러 텍스트 끝 = 공백 위치
    editor.commands.deleteRange({ from: spacePos, to: spacePos + 1 });
    expect(editor.getHTML()).toContain('>https://example.comdocs</a>'); // 병합 링크 통째 생존
  });
});
