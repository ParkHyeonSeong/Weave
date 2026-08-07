// @vitest-environment jsdom
// Task 3 자기 게이트: YUndoRedo 어댑터의 전 계약을 여기서 검증한다(Task 2보다 먼저 실행되므로
// 후행 파일에 기대면 안 됨). 실제 CanvasEditorToolbar를 react-dom/client로 마운트해 버튼 클릭까지.
import { it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ySyncPlugin, yUndoPlugin, yUndoPluginKey } from 'y-prosemirror';
import WeaveLink from '@/components/Canvas/extensions/WeaveLink';
import YUndoRedo from '@/components/Canvas/extensions/YUndoRedo';
import CanvasEditorToolbar from '@/components/Canvas/CanvasEditorToolbar';
import { WEAVE_CORE_EXTENSION_OPTIONS } from './editorCoreOptions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((r) => setTimeout(r, 0));
const raf = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const yFrag = (ydoc) => ydoc.getXmlFragment('default').toString();
let cleanup = [];
afterEach(() => { cleanup.forEach((f) => f()); cleanup = []; document.body.innerHTML = ''; });

// 단일 에디터 + Yjs(ySync+yUndo) — 프로덕션 배선과 동일(coreExtensionOptions 포함).
function makeYEditor() {
  const ydoc = new Y.Doc();
  const editor = new Editor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,
    extensions: [
      StarterKit.configure({ link: false, undoRedo: false }),
      WeaveLink.configure({ openOnClick: false }),
      YUndoRedo,
      Extension.create({
        name: 'ySyncHarness',
        addProseMirrorPlugins() { return [ySyncPlugin(ydoc.getXmlFragment('default')), yUndoPlugin()]; },
      }),
    ],
  });
  document.body.appendChild(editor.view.dom);
  cleanup.push(() => { editor.destroy(); ydoc.destroy(); });
  return { editor, ydoc };
}

function mountEditorWithToolbar() {
  const { editor, ydoc } = makeYEditor();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => { root.render(<CanvasEditorToolbar editor={editor} rawModeEnabled={false} />); });
  cleanup.unshift(() => act(() => root.unmount()));   // root를 가장 먼저 정리
  const btn = (title) => host.querySelector(`button[title="${title}"]`);
  return { editor, ydoc, btn };
}

it('commands.undo/redo가 문서를 정확히 되돌린다 + can()/키맵 — PM·Y exact', async () => {
  const { editor: a, ydoc: docA } = makeYEditor();
  const um = yUndoPluginKey.getState(a.state).undoManager;
  a.view.focus();
  await raf();
  const empty = a.getHTML();
  const emptyY = yFrag(docA);
  a.commands.insertContent({ type: 'text', text: 'hello' });
  await flush();
  const withHello = a.getHTML();
  const changedY = yFrag(docA);
  um.stopCapturing();
  // 최초 호출 전에 캡처 후 can().undo() 1회 전후 비교(문서·양쪽 stack 불변)
  const undoLen = um.undoStack.length;
  const redoLen = um.redoStack.length;
  expect(a.can().undo()).toBe(true);
  expect(a.getHTML()).toBe(withHello);
  expect(yFrag(docA)).toBe(changedY);
  expect(um.undoStack.length).toBe(undoLen);
  expect(um.redoStack.length).toBe(redoLen);
  // 실제 undo(commands 경로)
  a.commands.undo();
  await raf();
  expect(a.getHTML()).toBe(empty);
  expect(yFrag(docA)).toBe(emptyY);
  // can().redo()는 redo 가능 시점(undo 직후)에 검사
  const undoLen2 = um.undoStack.length;
  const redoLen2 = um.redoStack.length;
  expect(a.can().redo()).toBe(true);
  expect(a.getHTML()).toBe(empty);
  expect(um.undoStack.length).toBe(undoLen2);
  expect(um.redoStack.length).toBe(redoLen2);
  a.commands.redo();
  await raf();
  expect(a.getHTML()).toBe(withHello);
  expect(yFrag(docA)).toBe(changedY);
});

it('DOM 키맵 Mod-z/Shift-Mod-z/Mod-y가 undo/redo를 수행한다 (jsdom Mod=Ctrl)', async () => {
  const { editor: a, ydoc: docA } = makeYEditor();
  const um = yUndoPluginKey.getState(a.state).undoManager;
  a.view.focus();
  await raf();
  const empty = a.getHTML();
  const emptyY = yFrag(docA);
  a.commands.insertContent({ type: 'text', text: 'hello' });
  await flush();
  const withHello = a.getHTML();
  const changedY = yFrag(docA);
  um.stopCapturing();
  const beforeStack = um.undoStack.length;
  // jsdom은 navigator.platform이 ''이라 prosemirror-keymap이 Mod를 Ctrl로 해석 → ctrlKey 사용.
  const key = (opts) => {
    const ev = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...opts });
    a.view.dom.dispatchEvent(ev);
    return ev;
  };
  const undoEv = key({});                        // Mod-z = undo
  await raf();
  expect(a.getHTML()).toBe(empty);
  expect(yFrag(docA)).toBe(emptyY);
  expect(um.undoStack.length).toBe(beforeStack - 1);
  expect(undoEv.defaultPrevented).toBe(true);
  const redoEv = key({ shiftKey: true });        // Shift-Mod-z = redo
  await raf();
  expect(a.getHTML()).toBe(withHello);
  expect(yFrag(docA)).toBe(changedY);
  expect(redoEv.defaultPrevented).toBe(true);
  key({});                                       // 두 번째 Mod-z = undo
  await raf();
  expect(a.getHTML()).toBe(empty);
  expect(yFrag(docA)).toBe(emptyY);
  const ev = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });
  a.view.dom.dispatchEvent(ev);                  // Mod-y = redo
  await raf();
  expect(a.getHTML()).toBe(withHello);
  expect(yFrag(docA)).toBe(changedY);
  expect(ev.defaultPrevented).toBe(true);
});

it('실제 툴바 Undo/Redo 버튼 클릭이 blur 상태에서도 문서·Y를 오염 없이 되돌린다', async () => {
  const { editor, ydoc, btn } = mountEditorWithToolbar();
  const um = yUndoPluginKey.getState(editor.state).undoManager;
  const initialPm = editor.getHTML();
  const initialY = yFrag(ydoc);
  editor.commands.insertContent({ type: 'text', text: 'hello' });
  await raf();
  const changedPm = editor.getHTML();
  const changedY = yFrag(ydoc);
  um.stopCapturing();
  editor.view.dom.blur();                         // 툴바 클릭 시점 = 에디터 blur
  await raf();
  act(() => btn('Undo').click());                 // 실제 버튼 클릭 — .focus() 재유입 시 여기서 오염
  await raf();
  expect(editor.getHTML()).toBe(initialPm);
  expect(yFrag(ydoc)).toBe(initialY);
  act(() => btn('Redo').click());
  await raf();
  expect(editor.getHTML()).toBe(changedPm);
  expect(yFrag(ydoc)).toBe(changedY);
});
