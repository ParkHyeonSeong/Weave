// @vitest-environment jsdom
// ScrumCell/Canvas 확장 계약 — WeaveLink 통일 + collab undoRedo:false + YUndoRedo 어댑터.
// Editor 생성이 필요해 jsdom pragma 필수, 파일은 library/(vitest include 제약).
import { it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { buildScrumCellExtensions } from '@/components/Scrum/scrumCellExtensions';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';
import { WEAVE_CORE_EXTENSION_OPTIONS } from './editorCoreOptions';

// 실패 안전 teardown: assertion이 실패해도 afterEach가 각 disposer를 독립 실행해 Editor를
// 끝까지 정리한다(테스트 본문 직접 destroy는 실패 시 건너뛰어 누수). 오류는 삼키지 않고
// 전부 정리 후 첫 오류(또는 AggregateError)를 rethrow하고 document.body는 항상 초기화한다.
let disposers = [];
afterEach(() => {
  const errors = [];
  for (const d of disposers) { try { d(); } catch (e) { errors.push(e); } }
  disposers = [];
  document.body.innerHTML = '';
  if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'teardown 실패');
});
const track = (editor) => { disposers.push(() => editor.destroy()); return editor; };

it('ScrumCell link mark는 WeaveLink(inclusive:false 상수)다', () => {
  const editor = track(new Editor({ extensions: buildScrumCellExtensions({}), content: '<p></p>' }));
  expect(editor.schema.marks.link.spec.inclusive).toBe(false);
});

it('ScrumCell은 StarterKit 번들 Link가 아니라 WeaveLink를 쓴다', () => {
  const exts = buildScrumCellExtensions({});
  const starterKit = exts.find((e) => e.name === 'starterKit');
  expect(starterKit.options.link).toBe(false);
  const linkExt = exts.find((e) => e.name === 'link');
  // stock Link도 name이 'link'라 존재 검사만으론 통과 — WeaveLink 정적 오버라이드(inclusive:false)까지.
  expect(linkExt.config.inclusive).toBe(false);
  expect(linkExt.options.autolink).toBe(false);   // 스크럼 기존 동작 보존
});

it('collab 표면 StarterKit은 undoRedo:false다 (v3 옵션명 — history는 무효 no-op)', () => {
  const scrum = buildScrumCellExtensions({}).find((e) => e.name === 'starterKit');
  expect(scrum.options.undoRedo).toBe(false);
  expect('history' in scrum.options).toBe(false);
  const canvas = buildCanvasEditorExtensions({}).find((e) => e.name === 'starterKit');
  expect(canvas.options.undoRedo).toBe(false);
  expect('history' in canvas.options).toBe(false);
});

it('collab 표면은 YUndoRedo 어댑터로 undo/redo 명령을 복원한다 (툴바 회귀 방지)', () => {
  // 여기선 ySyncPlugin/yUndoPlugin이 없어 undo가 실제 동작하지 않는다(undoManager 부재).
  // 그래서 명령 '등록'만 스모크로 확인하고, 실제 undo/redo·can()·DOM 키맵·툴바 클릭은
  // 같은 Task 3의 canvasToolbarUndo.collab.dom.test.js에서 검증한다.
  const canvasEd = track(new Editor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions: buildCanvasEditorExtensions({}), content: '<p>x</p>' }));
  expect(typeof canvasEd.commands.undo).toBe('function');
  expect(typeof canvasEd.commands.redo).toBe('function');
  const scrumEd = track(new Editor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions: buildScrumCellExtensions({}), content: '<p>x</p>' }));
  expect(typeof scrumEd.commands.undo).toBe('function');
});
