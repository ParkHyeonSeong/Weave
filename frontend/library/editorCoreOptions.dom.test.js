// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import WeaveLink from '@/components/Canvas/extensions/WeaveLink';
import { WEAVE_CORE_EXTENSION_OPTIONS } from './editorCoreOptions';

// @tiptap/core Delete 확장(3.20.x)은 RemoveMarkStep 후처리에서 doc.nodeAt(newStart-1)을
// 호출한다(dist:4020). 앞선 스텝이 문서를 비워 newStart가 0으로 매핑되면 nodeAt(-1) →
// RangeError가 setTimeout 콜백(dist:4044)에서 unhandled로 터진다. 재현 트랜잭션:
// removeMark(1,2) 뒤 전체 삭제 — mapping.slice(1).map(1,-1) === 0.
function makeEditor(extraOptions = {}) {
  return new Editor({
    extensions: [StarterKit.configure({ link: false }), WeaveLink],
    content: '<p><a href="https://x.com">x</a>y</p>',
    ...extraOptions,
  });
}

function dispatchCrashTransaction(editor) {
  const { state } = editor;
  const linkType = state.schema.marks.link;
  const tr = state.tr.removeMark(1, 2, linkType);
  tr.delete(0, tr.doc.content.size);
  editor.view.dispatch(tr);
}

let editor;
afterEach(() => { vi.useRealTimers(); editor?.destroy(); editor = undefined; });

describe('Delete 확장 nodeAt(-1) 크래시', () => {
  it('업스트림 핀: 가드 없이는 RangeError가 터진다 (tiptap 업그레이드 감시)', () => {
    vi.useFakeTimers();
    editor = makeEditor();
    dispatchCrashTransaction(editor);
    expect(() => vi.runAllTimers()).toThrow(RangeError);
  });

  it('WEAVE_CORE_EXTENSION_OPTIONS 가드로 콜백이 스킵되어 안전하다', () => {
    vi.useFakeTimers();
    editor = makeEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS });
    dispatchCrashTransaction(editor);
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});

// ── 실제 5개 useEditor 배선 계약(AST 검사, 14·16·17·19·20차 P1) ────────────────
const JsxParser = Parser.extend(jsx());
const parseSrc = (src) => JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });

// suffix regex는 `@/wrong/editorCoreOptions`도 통과한다 → **정확 일치**만 인정.
const GUARD_MODULES = new Set(['@/library/editorCoreOptions', './editorCoreOptions']);
const USE_EDITOR_MODULES = new Set(['@tiptap/react']);

// import 바인딩으로 식별한다: 로컬 가짜 호출 제외, 별칭(as) 실호출 포함.
function importedBinding(ast, moduleNames, exportName) {
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || !moduleNames.has(node.source.value)) continue;
    const spec = node.specifiers.find((sp) =>
      sp.type === 'ImportSpecifier' && (sp.imported.name ?? sp.imported.value) === exportName);
    if (spec) return spec.local.name;
  }
  return null;
}

// 스코프에서 해당 이름이 재선언(shadow)되면 그 호출은 신뢰하지 않는다.
function isShadowed(ast, name) {
  let shadowed = false;
  (function walk(node, inFn) {
    if (!node || typeof node.type !== 'string' || shadowed) return;
    const declaresName = (n) =>
      (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === name)
      || (n.type === 'FunctionDeclaration' && n.id?.name === name)
      || (n.params || []).some((pp) => pp.type === 'Identifier' && pp.name === name);
    const entersFn = /Function/.test(node.type);
    if (declaresName(node)) { shadowed = true; return; }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, inFn || entersFn));
      else if (v && typeof v.type === 'string') walk(v, inFn || entersFn);
    }
  })(ast, false);
  return shadowed;
}

function findUseEditorCalls(src) {
  const ast = parseSrc(src);
  const binding = importedBinding(ast, USE_EDITOR_MODULES, 'useEditor');
  if (!binding || isShadowed(ast, binding)) return [];
  const calls = [];
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier'
        && node.callee.name === binding) calls.push(node);
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  return calls;
}

const guardBindingName = (ast) => {
  const name = importedBinding(ast, GUARD_MODULES, 'WEAVE_CORE_EXTENSION_OPTIONS');
  return name && !isShadowed(ast, name) ? name : null;
};

const isGuarded = (call, bindingName) => {
  if (!bindingName) return false;
  const arg0 = call.arguments[0];
  if (!arg0 || arg0.type !== 'ObjectExpression') return false;
  return arg0.properties.some((pr) =>
    pr.type === 'Property' && !pr.computed
    && (pr.key.name ?? pr.key.value) === 'coreExtensionOptions'
    && pr.value.type === 'Identifier' && pr.value.name === bindingName);
};

const countUseEditorCalls = (src) => findUseEditorCalls(src).length;
const countGuardedUseEditorCalls = (src) => {
  const binding = guardBindingName(parseSrc(src));
  return findUseEditorCalls(src).filter((c) => isGuarded(c, binding)).length;
};

const SURFACES = [
  'components/Branch/Tasks/TaskDescriptionEditor.js',
  'components/Branch/Tasks/CommentEditor.js',
  'components/Branch/Tasks/IssueEditor.js',
  'components/Scrum/ScrumCell.js',
  'components/Canvas/CanvasCollabEditor.js',
];
const root = resolve(__dirname, '..');
const read = (f) => readFileSync(resolve(root, f), 'utf8');

// components/** 재귀 스캔(.test.js 제외), useEditor 호출이 1개 이상인 파일 집합
function scanUseEditorCallsites(dir) {
  const out = [];
  (function walk(abs) {
    for (const name of readdirSync(abs)) {
      const p = resolve(abs, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.js') || p.endsWith('.test.js')) continue;
      let src;
      try { src = readFileSync(p, 'utf8'); } catch { continue; }
      if (countUseEditorCalls(src) > 0) out.push(p.slice(root.length + 1));
    }
  })(resolve(dir, 'components'));
  return out;
}

describe('useEditor 표면 배선 계약 (AST)', () => {
  const HEAD = "import { useEditor } from '@tiptap/react';\n"
    + "import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';\n";

  it('AST 검사기가 주석·문자열·실제 중첩속성·2번째 무가드 호출을 정확히 구분한다', () => {
    const commented = HEAD + 'useEditor({\n  // coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,\n  extensions,\n});';
    expect(countUseEditorCalls(commented)).toBe(1);
    expect(countGuardedUseEditorCalls(commented)).toBe(0);
    const nested = HEAD + 'useEditor({ o: { coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS }, extensions });';
    expect(countUseEditorCalls(nested)).toBe(1);
    expect(countGuardedUseEditorCalls(nested)).toBe(0);
    const afterString = HEAD + 'const s = "a //"; useEditor({ extensions });';
    expect(countUseEditorCalls(afterString)).toBe(1);
    expect(countGuardedUseEditorCalls(afterString)).toBe(0);
    const two = HEAD + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\nuseEditor({ extensions });';
    expect(countUseEditorCalls(two)).toBe(2);
    expect(countGuardedUseEditorCalls(two)).toBe(1);
  });

  it('useEditor도 import binding 기준 — 로컬 가짜는 제외, 별칭 실호출은 포함', () => {
    const localFake = "import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';\n"
      + 'function useEditor(){}\nuseEditor({ extensions });';
    expect(countUseEditorCalls(localFake)).toBe(0);
    const aliased = "import { useEditor as useTiptapEditor } from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';\n"
      + 'useTiptapEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countUseEditorCalls(aliased)).toBe(1);
    expect(countGuardedUseEditorCalls(aliased)).toBe(1);
    const shadowed = HEAD + 'function f(WEAVE_CORE_EXTENSION_OPTIONS){\n'
      + '  useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countGuardedUseEditorCalls(shadowed)).toBe(0);
    const wrongPath = "import { useEditor } from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/wrong/editorCoreOptions';\n"
      + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countGuardedUseEditorCalls(wrongPath)).toBe(0);
  });

  it('import binding까지 검증한다 — 로컬 재정의·오모듈·미import는 guarded가 아니다', () => {
    const OK = HEAD + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countGuardedUseEditorCalls(OK)).toBe(1);
    const localEmpty = "import { useEditor } from '@tiptap/react';\n"
      + 'const WEAVE_CORE_EXTENSION_OPTIONS = {};\n'
      + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countGuardedUseEditorCalls(localEmpty)).toBe(0);
    const wrongImport = "import { useEditor } from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS } from './wrong.js';\n"
      + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countGuardedUseEditorCalls(wrongImport)).toBe(0);
    const noImport = "import { useEditor } from '@tiptap/react';\n"
      + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countGuardedUseEditorCalls(noImport)).toBe(0);
  });

  it('useEditor 표면 파일 집합이 정확히 5개다 — 새 표면 추가 시 배선 누락을 잡는다', () => {
    expect(scanUseEditorCallsites(root).sort()).toEqual([...SURFACES].sort());
  });

  it.each(SURFACES)('%s: 모든 useEditor 호출이 WEAVE_CORE_EXTENSION_OPTIONS로 guarded다', (f) => {
    const src = read(f);
    expect(src).toMatch(/WEAVE_CORE_EXTENSION_OPTIONS/);
    const callCount = countUseEditorCalls(src);
    expect(callCount).toBeGreaterThan(0);
    expect(countGuardedUseEditorCalls(src)).toBe(callCount);
  });
});
