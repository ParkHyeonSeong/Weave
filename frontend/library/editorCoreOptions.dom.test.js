// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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

const USE_EDITOR_MODULES = new Set(['@tiptap/react']);

// 가드 정본 파일의 절대경로. 상대 import는 **스캔 대상 파일 기준**으로 resolve해 이 파일과
// 일치할 때만 정본으로 인정한다 — 문자열 `./editorCoreOptions`를 무조건 정본으로 보던
// false-green(컴포넌트-로컬 동명 오모듈이 통과) 제거. `@/library/editorCoreOptions`(webpack/
// vitest alias)만 경로와 무관하게 정본으로 인정한다.
const CANONICAL_GUARD_FILE = resolve(__dirname, 'editorCoreOptions.js');
function isCanonicalGuardModule(sourceValue, filePath) {
  if (sourceValue === '@/library/editorCoreOptions') return true;
  if (!filePath || !sourceValue.startsWith('.')) return false; // 상대 아님/경로 미상 → 불인정
  let abs = resolve(dirname(filePath), sourceValue);
  if (!/\.[cm]?jsx?$/.test(abs)) abs += '.js';
  return abs === CANONICAL_GUARD_FILE;
}

// import 바인딩 수집: 지정 export의 로컬 이름들(별칭·중복 import 포함) + namespace import 로컬들
// (`import * as ns` → ns.export 멤버 접근용). moduleMatch는 Set(정확 일치) 또는 판별 함수.
function importedBindings(ast, moduleMatch, exportName) {
  const matches = typeof moduleMatch === 'function' ? moduleMatch : (v) => moduleMatch.has(v);
  const names = new Set();
  const namespaces = new Set();
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration' || !matches(node.source.value)) continue;
    for (const sp of node.specifiers) {
      if (sp.type === 'ImportSpecifier' && (sp.imported.name ?? sp.imported.value) === exportName) {
        names.add(sp.local.name);
      } else if (sp.type === 'ImportNamespaceSpecifier') {
        namespaces.add(sp.local.name);
      }
    }
  }
  return { names, namespaces, exportName };
}

// 바인딩 패턴이 도입하는 이름을 모두 수집한다 — Identifier + 구조분해(ObjectPattern·ArrayPattern·
// RestElement·AssignmentPattern) 재귀.
function collectPatternNames(node, set) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': set.add(node.name); break;
    case 'ObjectPattern':
      for (const p of node.properties) {
        if (p.type === 'RestElement') collectPatternNames(p.argument, set);
        else collectPatternNames(p.value, set);
      }
      break;
    case 'ArrayPattern':
      for (const el of node.elements) if (el) collectPatternNames(el, set);
      break;
    case 'AssignmentPattern': collectPatternNames(node.left, set); break;
    case 'RestElement': collectPatternNames(node.argument, set); break;
    default: break;
  }
}

// 함수 스코프로 hoist되는 var 이름 — 블록/루프/if는 관통하되 **중첩 함수로는 안 내려간다**.
// (let/const/class·function 선언은 블록 스코프라 여기서 안 모으고 각 블록 프레임이 담당한다.)
function collectVarNames(node, set) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression' || node.type === 'StaticBlock') return; // 별도 var 스코프
  if (node.type === 'VariableDeclaration') {
    if (node.kind === 'var') for (const d of node.declarations) collectPatternNames(d.id, set);
    return;
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => collectVarNames(c, set));
    else if (v && typeof v.type === 'string') collectVarNames(v, set);
  }
}

// 문장 배열의 **직접** block-scoped 선언(let/const/class/function decl) — 중첩 스코프로 안 내려간다
// (중첩 블록/함수/루프/스위치는 각자 프레임을 갖는다).
function collectDirectLexical(statements, set) {
  for (const st of statements || []) {
    if (!st) continue;
    if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
      for (const d of st.declarations) collectPatternNames(d.id, set);
    } else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) {
      set.add(st.id.name);
    }
  }
}

// 스코프 노드별 **자기 결속 프레임**(스코프 아니면 null). 블록/루프/스위치/캐치/함수/클래스식이
// 각각 독립 프레임을 가지므로, 한 스코프의 shadow가 형제 스코프의 호출에 새지 않는다.
// 함수는 walk에서 특수 처리한다(scopeFrame 대상 아님) — parameter/name 환경과 body-var 환경을
// **시점별로 분리**해야 하기 때문(비-simple parameter default initializer는 body var를 보지 않는다).
const isFunctionNode = (t) =>
  t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression';
// 함수의 parameter/name 프레임: (named FunctionExpression) 자기이름 + parameter 결속.
function functionParamFrame(node) {
  const set = new Set();
  if (node.type === 'FunctionExpression' && node.id) set.add(node.id.name);
  for (const p of node.params || []) collectPatternNames(p, set);
  return set;
}
// 함수의 body-var 프레임: 몸통으로 hoist되는 var(중첩 함수/static block으로는 안 내려감).
function functionBodyVarFrame(node) {
  const set = new Set();
  if (node.body && node.body.type === 'BlockStatement') {
    for (const st of node.body.body) collectVarNames(st, set);
  }
  return set;
}

function scopeFrame(node) {
  const t = node.type;
  if (t === 'ClassExpression') { const set = new Set(); if (node.id) set.add(node.id.name); return set; } // named class expr 자기참조
  if (t === 'BlockStatement') { const set = new Set(); collectDirectLexical(node.body, set); return set; }
  if (t === 'StaticBlock') { // 정적 블록은 lexical + **자체 var 스코프**(var가 밖으로 새지 않음)
    const set = new Set();
    collectDirectLexical(node.body, set);
    for (const st of node.body || []) collectVarNames(st, set);
    return set;
  }
  if (t === 'CatchClause') { const set = new Set(); collectPatternNames(node.param, set); return set; }
  if (t === 'ForStatement' || t === 'ForInStatement' || t === 'ForOfStatement') {
    const set = new Set();
    const head = node.init ?? node.left;
    if (head && head.type === 'VariableDeclaration' && head.kind !== 'var') {
      for (const d of head.declarations) collectPatternNames(d.id, set);
    }
    return set;
  }
  if (t === 'SwitchStatement') {
    const set = new Set();
    for (const cs of node.cases || []) collectDirectLexical(cs.consequent, set); // 스위치 본문은 단일 블록 스코프
    return set;
  }
  return null;
}

// 소스 순서로 평가한 유효 coreExtensionOptions 값. { known, valueNode }.
// - 비computed Property 'coreExtensionOptions' → 그 값으로 갱신(뒤가 이기는 duplicate 규칙).
// - SpreadElement → coreExtensionOptions를 알 수 없게 덮을 수 있음 → known=false(fail-closed).
// - computed Property(동적 키) → 키가 런타임에 'coreExtensionOptions'일 수 있음 → known=false.
function effectiveCoreOption(objExpr) {
  let eff = { known: false, valueNode: null };
  for (const pr of objExpr.properties) {
    if (pr.type === 'SpreadElement') { eff = { known: false, valueNode: null }; continue; }
    if (pr.type !== 'Property') continue;
    if (pr.computed) { eff = { known: false, valueNode: null }; continue; }
    const keyName = pr.key.type === 'Identifier' ? pr.key.name
      : (pr.key.type === 'Literal' ? pr.key.value : undefined);
    if (keyName === 'coreExtensionOptions') eff = { known: true, valueNode: pr.value };
  }
  return eff;
}

// 호출별 lexical scope 판정: 각 호출/가드 identifier가 그 위치에서 어떤 binding을 참조하는지
// 스코프 체인으로 추적한다. import binding은 모듈 스코프이므로 이름이 로컬 스코프 스택 어디에도
// 결속되지 않을 때만 import로 해석한다. 각 블록/루프/스위치/캐치/함수/클래스식이 독립 프레임이라
// (1) 형제 스코프 shadow가 실호출을 지우지 않고, (2) top-level 블록 shadow도 정확히 잡힌다.
function analyzeCalls(src, filePath) {
  const ast = parseSrc(src);
  const ue = importedBindings(ast, USE_EDITOR_MODULES, 'useEditor');
  const gb = importedBindings(ast, (v) => isCanonicalGuardModule(v, filePath), 'WEAVE_CORE_EXTENSION_OPTIONS');
  const stack = [];
  const locallyBound = (name) => stack.some((s) => s.has(name));
  const idIsImport = (name, b) => b.names.has(name) && !locallyBound(name);
  // 멤버 property 이름 — dot(ns.export) 또는 정적 문자열 computed(ns['export']). 동적 키는 null(불명).
  const memberPropName = (m) => {
    if (!m.computed && m.property.type === 'Identifier') return m.property.name;
    if (m.computed && m.property.type === 'Literal' && typeof m.property.value === 'string') return m.property.value;
    return null;
  };
  // `ns.export` / `ns['export']` 멤버 접근(namespace import). object는 ns 로컬(미shadow).
  const nsMemberIsImport = (m, b) =>
    m.type === 'MemberExpression'
    && m.object.type === 'Identifier'
    && memberPropName(m) === b.exportName
    && b.namespaces.has(m.object.name) && !locallyBound(m.object.name);
  const calleeIsUseEditor = (c) =>
    (c.type === 'Identifier' && idIsImport(c.name, ue)) || nsMemberIsImport(c, ue);
  const valueIsGuard = (v) =>
    (v.type === 'Identifier' && idIsImport(v.name, gb)) || nsMemberIsImport(v, gb);

  const isGuardedCall = (call) => {
    const arg0 = call.arguments[0];
    if (!arg0 || arg0.type !== 'ObjectExpression') return false;
    const eff = effectiveCoreOption(arg0);
    if (!eff.known || !eff.valueNode) return false;      // 값 불명 → fail-closed
    return valueIsGuard(eff.valueNode);                   // 최종 값이 정본 import(식별자/ns멤버)여야만 guarded
  };

  const calls = [];
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    // switch discriminant는 **바깥 스코프**에서 평가된다(case의 lexical을 못 본다) — 프레임 밖에서
    // 먼저 순회하고, switch 프레임은 cases에만 적용한다(프레임 push 타이밍으로 인한 실호출 증발 방지).
    if (node.type === 'SwitchStatement') {
      if (node.discriminant) walk(node.discriminant);
      const sf = scopeFrame(node);
      if (sf) stack.push(sf);
      for (const cs of node.cases || []) walk(cs);
      if (sf) stack.pop();
      return;
    }
    // 함수: parameter/name 환경과 body-var 환경을 **시점별로 분리**한다. 비-simple parameter의
    // default initializer는 body var 환경을 못 본다(spec) — param 프레임만 얹고 params를 먼저
    // 순회한 뒤, body-var 프레임을 얹고 body를 순회한다. (body의 let/const/class는 body
    // BlockStatement 프레임이 담당.)
    if (isFunctionNode(node.type)) {
      stack.push(functionParamFrame(node));
      for (const p of node.params || []) walk(p);          // default initializer는 param 프레임만 본다
      stack.push(functionBodyVarFrame(node));
      if (node.body) walk(node.body);                       // body는 param + body-var(+블록) 프레임을 본다
      stack.pop();                                          // body-var
      stack.pop();                                          // param/name
      return;
    }
    const frame = scopeFrame(node);
    if (frame) stack.push(frame);
    if (node.type === 'CallExpression' && node.callee && calleeIsUseEditor(node.callee)) {
      calls.push({ node, guarded: isGuardedCall(node) });
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
    if (frame) stack.pop();
  })(ast);
  return calls;
}

const countUseEditorCalls = (src) => analyzeCalls(src).length;
// filePath: 상대 가드 import를 정본 파일로 resolve하기 위한 스캔 대상 파일의 절대경로.
// (미지정 시 `@/library/editorCoreOptions` alias만 정본으로 인정)
const countGuardedUseEditorCalls = (src, filePath) =>
  analyzeCalls(src, filePath).filter((c) => c.guarded).length;

const SURFACES = [
  'components/Branch/Tasks/TaskDescriptionEditor.js',
  'components/Branch/Tasks/CommentEditor.js',
  'components/Branch/Tasks/IssueEditor.js',
  'components/Scrum/ScrumCell.js',
  'components/Canvas/CanvasCollabEditor.js',
];
const root = resolve(__dirname, '..');
const read = (f) => readFileSync(resolve(root, f), 'utf8');

// ── Discovery: 상세 call analyzer와 **독립**한 후보 표면 탐지(fail-closed) ──────────
// countUseEditorCalls는 로컬 alias(`const {useEditor: ue} = ns; ue()` / `const ue = ns.useEditor; ue()`
// / `const t = ns; t.useEditor()` / 동적 키 `ns[key]`)를 data-flow로 못 따라가 0을 낸다. 그걸 표면
// 판정에 쓰면 alias 표면이 inventory에서 통째로 사라진다. 그래서 discovery는 analyzer 결과와
// 무관하게 canonical @tiptap/react import 유무만으로 후보를 잡는다:
//  - named useEditor import가 있으면 → 후보.
//  - @tiptap/react namespace import(import * as ns)가 있으면 → **사용 방식과 무관하게** 후보.
//    namespace import는 상세 provenance를 완전 추적할 수 없으므로 fail-closed 후보로 처리한다.
//    useEditor를 사용하지 않는 컴포넌트는 named import를 사용한다(그래서 namespace import 자체가
//    useEditor 사용 정황으로 충분하다).
function isCandidateSurface(src) {
  let ast;
  try { ast = parseSrc(src); } catch { return false; }
  const ue = importedBindings(ast, USE_EDITOR_MODULES, 'useEditor');
  return ue.names.size > 0 || ue.namespaces.size > 0;
}

// {path, src} 목록에서 후보 표면 경로 집합(테스트에서 합성 6번째 표면을 섞어 exact-five RED 검증 가능).
function candidateSurfacesFrom(entries) {
  return entries.filter((e) => isCandidateSurface(e.src)).map((e) => e.path);
}

// components/** 재귀 스캔(.test.js 제외) → 후보 표면 파일 집합(discovery 기반, analyzer 독립).
function scanUseEditorCallsites(dir) {
  const entries = [];
  (function walk(abs) {
    for (const name of readdirSync(abs)) {
      const p = resolve(abs, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.js') || p.endsWith('.test.js')) continue;
      let src;
      try { src = readFileSync(p, 'utf8'); } catch { continue; }
      entries.push({ path: p.slice(root.length + 1), src });
    }
  })(resolve(dir, 'components'));
  return candidateSurfacesFrom(entries);
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

  it('최종 coreExtensionOptions 값만 인정한다 — duplicate/spread/computed는 fail-closed, spread 뒤 정본은 인정', () => {
    // isGuarded가 '정본 property 하나라도 있으면 통과'면 뒤에서 덮어써도 false-green이 된다.
    // 소스 순서로 평가한 **최종 유효값**이 정본 import일 때만 guarded여야 한다.
    // 1) duplicate: 정본 뒤 non-정본이 덮음 → 최종값이 정본 아님 → 0
    const dupOverride = HEAD + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, coreExtensionOptions: bad, extensions });';
    expect(countGuardedUseEditorCalls(dupOverride)).toBe(0);
    // 2) spread가 정본 뒤 → coreExtensionOptions를 알 수 없게 덮을 수 있음 → 0
    const spreadAfter = HEAD + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, ...runtimeOptions });';
    expect(countGuardedUseEditorCalls(spreadAfter)).toBe(0);
    // 3) 동적 computed가 정본 뒤 → 키가 런타임에 coreExtensionOptions일 수 있음 → 0
    const computedAfter = HEAD + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, [k]: v, extensions });';
    expect(countGuardedUseEditorCalls(computedAfter)).toBe(0);
    // 4) 대조군: spread 뒤에 정본이 다시 오면 최종값이 정본 → 1
    const spreadThenCanonical = HEAD + 'useEditor({ ...runtimeOptions, coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countGuardedUseEditorCalls(spreadThenCanonical)).toBe(1);
    // 호출 자체는 4건 모두 실제 import 호출로 계수(값 판정과 무관)
    for (const src of [dupOverride, spreadAfter, computedAfter, spreadThenCanonical]) {
      expect(countUseEditorCalls(src)).toBe(1);
    }
  });

  it('호출별 lexical scope로 판정한다 — decoy shadow가 형제 실호출을 지우거나 오판하지 않는다', () => {
    // 1) 무관 helper의 destructured useEditor param + 모듈 실호출(unguarded):
    //    파일 전체 shadow 방식이면 실호출이 사라져(count=0) 새 unguarded surface가 스캐너에서 증발.
    //    → 실호출은 count=1, guarded=0이어야 한다.
    const mixedUse = HEAD
      + 'function helper({ useEditor }) { return useEditor({ extensions }); }\n'
      + 'export default function Surface() { return useEditor({ extensions }); }';
    expect(countUseEditorCalls(mixedUse)).toBe(1);
    expect(countGuardedUseEditorCalls(mixedUse)).toBe(0);
    // 2) 무관 nested guard shadow + 실제 guarded 호출 → 실호출은 guarded=1이어야 한다.
    const mixedGuard = HEAD
      + 'function helper(WEAVE_CORE_EXTENSION_OPTIONS) { return WEAVE_CORE_EXTENSION_OPTIONS; }\n'
      + 'export default function Surface() { return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); }';
    expect(countUseEditorCalls(mixedGuard)).toBe(1);
    expect(countGuardedUseEditorCalls(mixedGuard)).toBe(1);
    // 3) named FunctionExpression 자기결속은 정본 가드가 아니다 — 몸통 안에서 함수 자신을 가리킨다.
    const namedFnExpr = HEAD
      + 'const fake = function WEAVE_CORE_EXTENSION_OPTIONS() {\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n};';
    expect(countUseEditorCalls(namedFnExpr)).toBe(1);
    expect(countGuardedUseEditorCalls(namedFnExpr)).toBe(0);
  });

  // ── 적대적 검증(4-에이전트)이 찾은 스코프 갭 회귀 고정 ──────────────────────────
  it('top-level 블록 스코프 shadow도 정확히 잡는다 — 함수/캐치만 프레임 두던 fail-open 제거', () => {
    // 모듈 top-level의 블록/루프/스위치/캐치-본문 const는 import를 합법 shadow한다(함수 밖이라
    // 옛 fold가 못 봤다). 각 블록이 독립 프레임을 가져 최종 가드 값이 로컬로 해석 → guarded=0.
    const cases = [
      HEAD + '{ const WEAVE_CORE_EXTENSION_OPTIONS = 1; useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); }',           // bare block
      HEAD + 'for (const WEAVE_CORE_EXTENSION_OPTIONS of list) { useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); }',  // for-of head
      HEAD + 'for (let WEAVE_CORE_EXTENSION_OPTIONS = 0; WEAVE_CORE_EXTENSION_OPTIONS < 1; WEAVE_CORE_EXTENSION_OPTIONS++) { useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); }', // classic for
      HEAD + 'try {} catch (e) { const WEAVE_CORE_EXTENSION_OPTIONS = 1; useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); }', // catch BODY
      HEAD + 'switch (x) { case 1: { const WEAVE_CORE_EXTENSION_OPTIONS = 1; useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); } }', // switch case block
      HEAD + 'lbl: { const WEAVE_CORE_EXTENSION_OPTIONS = 1; useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); }', // labeled block
    ];
    for (const src of cases) {
      expect(countUseEditorCalls(src)).toBe(1);          // 호출 자체는 실호출
      expect(countGuardedUseEditorCalls(src)).toBe(0);   // 가드 값은 블록-로컬 shadow → 정본 아님
    }
    // top-level 블록이 useEditor 자체를 shadow하면 그 호출은 tiptap 호출이 아니다(phantom 제거).
    const blockUE = HEAD + '{ const useEditor = () => {}; useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); }';
    expect(countUseEditorCalls(blockUE)).toBe(0);
  });

  it('형제/중첩 블록의 decoy shadow가 실호출·가드를 지우거나 오판하지 않는다 (블록별 독립 프레임)', () => {
    // decoy useEditor가 if-블록에 갇혀 있으면 함수 본문의 실호출은 그대로 계수·guarded여야 한다
    // (옛 fold는 형제 블록 shadow를 함수 전체에 접어 실호출을 증발시켰다 — scanner-disappearance).
    const siblingUE = HEAD
      + 'export default function Surface() {\n'
      + '  if (x) { const useEditor = () => {}; useEditor({ extensions }); }\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countUseEditorCalls(siblingUE)).toBe(1);
    expect(countGuardedUseEditorCalls(siblingUE)).toBe(1);
    // if-블록의 block-scoped class가 함수 본문 가드 값을 false-red로 만들면 안 된다.
    const siblingGuardClass = HEAD
      + 'export default function Surface() {\n'
      + '  if (x) { class WEAVE_CORE_EXTENSION_OPTIONS {} }\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countGuardedUseEditorCalls(siblingGuardClass)).toBe(1);
    // named ClassExpression 자기결속은 정본 가드가 아니다(메서드 본문에서 클래스 자신을 가리킴).
    const classExprGuard = HEAD
      + 'const C = class WEAVE_CORE_EXTENSION_OPTIONS { m() { return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); } };';
    expect(countUseEditorCalls(classExprGuard)).toBe(1);
    expect(countGuardedUseEditorCalls(classExprGuard)).toBe(0);
    const classExprUE = HEAD
      + 'const C = class useEditor { m() { return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); } };';
    expect(countUseEditorCalls(classExprUE)).toBe(0); // 콜리가 클래스 자기이름 → tiptap 호출 아님
  });

  it('namespace/중복 import 바인딩도 추적한다 — ns.useEditor·다중 alias 실호출이 증발하지 않는다', () => {
    // import * as ns → ns.useEditor(...) 멤버 호출도 실호출로 계수하고 가드도 판정한다.
    const nsGuarded = "import * as tiptap from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';\n"
      + 'tiptap.useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countUseEditorCalls(nsGuarded)).toBe(1);
    expect(countGuardedUseEditorCalls(nsGuarded)).toBe(1);
    const nsUnguarded = "import * as tiptap from '@tiptap/react';\ntiptap.useEditor({ extensions });";
    expect(countUseEditorCalls(nsUnguarded)).toBe(1);
    expect(countGuardedUseEditorCalls(nsUnguarded)).toBe(0);
    // 같은 export를 두 alias로 import → 두 바인딩 모두 실호출로 인정(첫 것만 보던 누락 제거).
    const doubleImport = "import { useEditor } from '@tiptap/react';\n"
      + "import { useEditor as ue2 } from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';\n"
      + 'useEditor({ extensions });\nue2({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    expect(countUseEditorCalls(doubleImport)).toBe(2);
    expect(countGuardedUseEditorCalls(doubleImport)).toBe(1);
    // 가드를 두 alias로 import하고 둘째를 써도 guarded로 인정(false-red 제거).
    const guardDoubleAlias = "import { useEditor } from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS as G1, WEAVE_CORE_EXTENSION_OPTIONS as G2 } from '@/library/editorCoreOptions';\n"
      + 'useEditor({ coreExtensionOptions: G2, extensions });';
    expect(countGuardedUseEditorCalls(guardDoubleAlias)).toBe(1);
  });

  it('2라운드 완결성 비평 갭 고정 — static block var 스코프·switch discriminant·정적 computed ns 멤버', () => {
    // static block은 자체 var 스코프 — 그 안 var가 import를 블록 내부에서 shadow한다(밖으로 안 샘).
    const sbGuard = HEAD + 'class C { static { var WEAVE_CORE_EXTENSION_OPTIONS = { fake: 1 }; useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); } }';
    expect(countUseEditorCalls(sbGuard)).toBe(1);
    expect(countGuardedUseEditorCalls(sbGuard)).toBe(0);
    const sbUE = HEAD + 'class C { static { var useEditor = () => {}; useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions }); } }';
    expect(countUseEditorCalls(sbUE)).toBe(0); // 콜리가 static-block var → tiptap 호출 아님
    // switch discriminant는 바깥 스코프에서 평가된다 — case의 const useEditor에 shadow되지 않는다.
    const swDisc = HEAD + 'switch (useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS })) { case 1: const useEditor = 1; break; }';
    expect(countUseEditorCalls(swDisc)).toBe(1);
    expect(countGuardedUseEditorCalls(swDisc)).toBe(1);
    // 정적 문자열 computed namespace 멤버 ns['useEditor'](...)도 실호출로 계수·판정한다.
    const nsComputed = "import * as tiptap from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';\n"
      + "tiptap['useEditor']({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });";
    expect(countUseEditorCalls(nsComputed)).toBe(1);
    expect(countGuardedUseEditorCalls(nsComputed)).toBe(1);
  });

  it('function default-parameter 스코프를 body-var와 분리한다 (P1-1) — default init은 body var를 못 본다', () => {
    // 비-simple parameter의 default initializer는 body의 var 환경을 보지 않는다(spec).
    // 따라서 default init 안의 useEditor/GUARD는 body의 var 선언에 shadow되지 않고 import로 해석된다.
    const defInitBodyVarUE = HEAD
      + 'function f(\n  x = useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions })\n) {\n  var useEditor;\n}';
    expect(countUseEditorCalls(defInitBodyVarUE)).toBe(1);   // body var useEditor는 default init을 못 가린다
    expect(countGuardedUseEditorCalls(defInitBodyVarUE)).toBe(1);
    const defInitBodyVarGuard = HEAD
      + 'function f(\n  x = useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions })\n) {\n  var WEAVE_CORE_EXTENSION_OPTIONS;\n}';
    expect(countUseEditorCalls(defInitBodyVarGuard)).toBe(1);
    expect(countGuardedUseEditorCalls(defInitBodyVarGuard)).toBe(1); // body var GUARD도 default init을 못 가린다
    // 반대로 함수 **body** 안에서는 기존 var shadow가 계속 적용된다.
    const bodyVarUE = HEAD + 'function f() {\n  var useEditor;\n  useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countUseEditorCalls(bodyVarUE)).toBe(0);          // body 호출은 body var useEditor에 shadow
    const bodyVarGuard = HEAD + 'function f() {\n  var WEAVE_CORE_EXTENSION_OPTIONS;\n  useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countUseEditorCalls(bodyVarGuard)).toBe(1);
    expect(countGuardedUseEditorCalls(bodyVarGuard)).toBe(0); // body var GUARD가 body 호출의 가드를 shadow
  });

  it('가드 import는 스캔 대상 파일 기준으로 resolve된다 — 컴포넌트-로컬 ./editorCoreOptions 오모듈은 불인정', () => {
    // 같은 소스라도 파일 위치에 따라 상대 import가 다른 파일을 가리킨다:
    const relImport = "import { useEditor } from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS } from './editorCoreOptions';\n"
      + 'useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });';
    // 컴포넌트 파일에서의 ./editorCoreOptions → components/Foo/editorCoreOptions.js(≠정본) → 불인정
    const compPath = resolve(root, 'components/Foo/Bar.js');
    expect(countGuardedUseEditorCalls(relImport, compPath)).toBe(0);
    // library/ 안 파일에서의 ./editorCoreOptions → 정본과 일치 → 인정(문자열이 아니라 경로 resolve임을 증명)
    const libPath = resolve(root, 'library/SomeEditor.js');
    expect(countGuardedUseEditorCalls(relImport, libPath)).toBe(1);
  });

  it('구조분해 shadow(param/local)를 잡는다 — WEAVE_CORE_EXTENSION_OPTIONS·useEditor 양쪽', () => {
    // WEAVE_CORE_EXTENSION_OPTIONS를 구조분해로 가린 뒤 그 이름으로 guard한 척 → 불인정
    const destructObjParam = HEAD + 'function f({ WEAVE_CORE_EXTENSION_OPTIONS }) {\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countGuardedUseEditorCalls(destructObjParam)).toBe(0);
    const destructArrParam = HEAD + 'function f([WEAVE_CORE_EXTENSION_OPTIONS]) {\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countGuardedUseEditorCalls(destructArrParam)).toBe(0);
    const restParam = HEAD + 'function f(...WEAVE_CORE_EXTENSION_OPTIONS) {\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countGuardedUseEditorCalls(restParam)).toBe(0);
    const defaultParam = HEAD + 'function f(WEAVE_CORE_EXTENSION_OPTIONS = {}) {\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countGuardedUseEditorCalls(defaultParam)).toBe(0);
    // 로컬 const 구조분해는 함수 스코프 안에 둔다(모듈 top-level은 import와 재선언 충돌).
    const destructLocal = HEAD + 'function f() {\n  const { WEAVE_CORE_EXTENSION_OPTIONS } = cfg;\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countGuardedUseEditorCalls(destructLocal)).toBe(0);
    // useEditor 자체를 구조분해로 가린 가짜 호출 → useEditor 호출로 세지 않는다
    const useEditorObjParam = HEAD + 'function f({ useEditor }) {\n'
      + '  return useEditor({ coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, extensions });\n}';
    expect(countUseEditorCalls(useEditorObjParam)).toBe(0);
    const useEditorLocal = HEAD + 'function f() {\n  const { useEditor } = lib;\n'
      + '  return useEditor({ extensions });\n}';
    expect(countUseEditorCalls(useEditorLocal)).toBe(0);
  });

  it('정본 가드의 별칭(as) 호출은 정상 guarded로 인정한다', () => {
    const guardAlias = "import { useEditor } from '@tiptap/react';\n"
      + "import { WEAVE_CORE_EXTENSION_OPTIONS as GUARD } from '@/library/editorCoreOptions';\n"
      + 'useEditor({ coreExtensionOptions: GUARD, extensions });';
    expect(countUseEditorCalls(guardAlias)).toBe(1);
    expect(countGuardedUseEditorCalls(guardAlias)).toBe(1);
  });

  it('useEditor 표면 파일 집합이 정확히 5개다 — 새 표면 추가 시 배선 누락을 잡는다', () => {
    expect(scanUseEditorCallsites(root).sort()).toEqual([...SURFACES].sort());
  });

  it('discovery는 상세 analyzer와 독립적으로 alias 표면을 잡는다 (P1-2) — 6번째 alias surface면 exact-five가 RED', () => {
    // countUseEditorCalls는 로컬 alias를 data-flow로 못 따라가 0을 낸다(상세 provenance 없음):
    const nsDestrAlias = "import * as tiptap from '@tiptap/react';\n"
      + 'const { useEditor: ue } = tiptap;\n'
      + 'export default function S() { return ue({ extensions }); }';
    const nsMemberAlias = "import * as tiptap from '@tiptap/react';\n"
      + 'const ue = tiptap.useEditor;\n'
      + 'export default function S() { return ue({ extensions }); }';
    // analyzer는 로컬 alias/namespace 재바인딩/동적 키를 data-flow로 못 따라가 0을 낸다.
    const nsAliasChain = "import * as tiptap from '@tiptap/react';\n"
      + 'const t = tiptap;\n'
      + 'export default function S() { return t.useEditor({ extensions }); }';
    const nsDynamicKey = "import * as tiptap from '@tiptap/react';\n"
      + "const key = 'useEditor';\n"
      + 'const ue = tiptap[key];\n'
      + 'export default function S() { return ue({ extensions }); }';
    for (const s of [nsDestrAlias, nsMemberAlias, nsAliasChain, nsDynamicKey]) {
      expect(countUseEditorCalls(s)).toBe(0); // analyzer는 놓친다(그래서 discovery가 필요)
    }
    // discovery는 @tiptap/react namespace import가 있으면 **사용 방식과 무관하게** 후보로 잡는다.
    expect(isCandidateSurface(nsDestrAlias)).toBe(true);
    expect(isCandidateSurface(nsMemberAlias)).toBe(true);
    expect(isCandidateSurface(nsAliasChain)).toBe(true);  // namespace 재바인딩(t = tiptap)
    expect(isCandidateSurface(nsDynamicKey)).toBe(true);  // 동적 멤버 키(tiptap[key])
    // 실제 5개는 discovery로도 그대로 5개.
    const realEntries = SURFACES.map((f) => ({ path: f, src: read(f) }));
    expect(candidateSurfacesFrom(realEntries).sort()).toEqual([...SURFACES].sort());
    // 6번째 alias 무가드 표면이 파일로 추가되면 inventory가 6개 → exact-five가 RED가 된다.
    const sixths = [
      { path: 'components/Fake/AliasDestr.js', src: nsDestrAlias },
      { path: 'components/Fake/AliasMember.js', src: nsMemberAlias },
      { path: 'components/Fake/AliasChain.js', src: nsAliasChain },
      { path: 'components/Fake/DynamicKey.js', src: nsDynamicKey },
    ];
    for (const sixth of sixths) {
      expect(candidateSurfacesFrom([...realEntries, sixth]).length).toBe(6);
    }
    // namespace import는 상세 provenance를 완전 추적할 수 없으므로 fail-closed 후보로 처리한다.
    // useEditor를 사용하지 않는 컴포넌트는 named import를 사용한다.
    const nsNoUse = "import * as tiptap from '@tiptap/react';\nconst x = tiptap.EditorContent;\n";
    expect(isCandidateSurface(nsNoUse)).toBe(true);
    // useEditor가 아닌 named import만 있는 파일은 후보 아님(named useEditor·namespace 둘 다 없음).
    const namedNoUseEditor = "import { EditorContent } from '@tiptap/react';\nexport default function S() { return null; }";
    expect(isCandidateSurface(namedNoUseEditor)).toBe(false);
  });

  it('기존 표면에서 가드 하나만 제거되면 per-surface 계약이 RED가 된다 (P1-2 회귀)', () => {
    // 실제 표면 소스에서 coreExtensionOptions 가드를 제거하면 guarded < callCount가 되어야 한다.
    const f = SURFACES[0];
    const src = read(f);
    const abs = resolve(root, f);
    const callCount = countUseEditorCalls(src);
    expect(countGuardedUseEditorCalls(src, abs)).toBe(callCount); // 원본은 전부 guarded
    // 가드 property(키:값)를 제거 — 다양한 포맷 대비 정규식으로 coreExtensionOptions 라인 제거.
    const stripped = src.replace(/coreExtensionOptions\s*:\s*WEAVE_CORE_EXTENSION_OPTIONS\s*,?/, '');
    expect(stripped).not.toBe(src);                              // 실제로 제거됐는지 확인
    expect(countUseEditorCalls(stripped)).toBe(callCount);       // 호출 수는 그대로
    expect(countGuardedUseEditorCalls(stripped, abs)).toBeLessThan(callCount); // 가드 하나 빠짐 → RED
  });

  it.each(SURFACES)('%s: 모든 useEditor 호출이 WEAVE_CORE_EXTENSION_OPTIONS로 guarded다', (f) => {
    const abs = resolve(root, f);
    const src = read(f);
    expect(src).toMatch(/WEAVE_CORE_EXTENSION_OPTIONS/);
    const callCount = countUseEditorCalls(src);
    expect(callCount).toBeGreaterThan(0);
    expect(countGuardedUseEditorCalls(src, abs)).toBe(callCount); // 상대 import도 정본 resolve
  });
});
