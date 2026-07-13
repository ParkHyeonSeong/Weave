// @vitest-environment jsdom
// BookmarkPastePlugin의 Cmd+Shift+V 탈출구 + 실 등록 체인의 paste 플러그인 동작 회귀.
// 순서 독립(실측 2026-07-10): tiptap ExtensionManager.plugins는 확장 배열을 reverse해
// 수집하므로 빌더에서 나중에 등록된 markdownPaste가 bookmarkPaste보다 먼저 실행되지만,
// 양 플러그인 모두 자체 shift 가드를 보유해 실행 순서와 무관하게 결과가 동일하다.
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildCommentEditorExtensions } from '@/components/Branch/Tasks/commentEditorExtensions';
import { createBookmarkPastePlugin } from '@/components/Canvas/extensions/BookmarkPastePlugin';

function makePasteEvent(text) {
  return {
    clipboardData: { getData: (type) => (type === 'text/plain' ? text : '') },
    preventDefault() {},
  };
}

// jsdom origin은 vitest.config.mjs에서 https://weave.test 고정 — same-origin 내부 URL
const internalUrl = () => `${window.location.origin}/branch/1/task/2`;

const findTaskRef = (ed) => {
  let attrs = null;
  ed.state.doc.descendants((node) => {
    if (node.type.name === 'taskRef') attrs = node.attrs;
  });
  return attrs;
};

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('BookmarkPastePlugin shift 탈출구', () => {
  const plugin = createBookmarkPastePlugin();

  it('Shift 붙여넣기는 내부 URL을 칩으로 바꾸지 않는다 (플러그인 단독 — false 위임)', () => {
    editor = new Editor({ extensions: buildCommentEditorExtensions({ branchId: 1 }), content: '<p></p>' });
    editor.view.input.shiftKey = true;
    const handled = plugin.props.handlePaste(editor.view, makePasteEvent(internalUrl()));
    expect(handled).toBe(false); // 뒤의 markdownPaste shift 분기(또는 PM 기본 평문 paste)가 이어받는다
    expect(findTaskRef(editor)).toBeNull();
  });
});

describe('실 등록 체인 동작 회귀 (someProp 경유 — 순서 독립: 양 플러그인 모두 shift 가드 보유)', () => {
  it('Shift 붙여넣기: 내부 URL이 평문으로 남는다', () => {
    editor = new Editor({ extensions: buildCommentEditorExtensions({ branchId: 1 }), content: '<p></p>' });
    editor.view.input.shiftKey = true;
    const handled = editor.view.someProp('handlePaste', (f) => f(editor.view, makePasteEvent(internalUrl())) || undefined);
    expect(handled).toBe(true);
    expect(findTaskRef(editor)).toBeNull();
    expect(editor.getText()).toBe(internalUrl());
  });

  it('일반 붙여넣기: 내부 URL이 taskRef 칩으로 변환된다 (기존 동작 회귀)', () => {
    editor = new Editor({ extensions: buildCommentEditorExtensions({ branchId: 1 }), content: '<p></p>' });
    editor.view.input.shiftKey = false;
    const handled = editor.view.someProp('handlePaste', (f) => f(editor.view, makePasteEvent(internalUrl())) || undefined);
    expect(handled).toBe(true);
    expect(findTaskRef(editor)).toMatchObject({ branchId: 1, taskId: 2 });
  });
});
