import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'acorn';
import jsx from 'acorn-jsx';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SANITIZE_MODULE = resolve(ROOT, 'library/sanitize.js');
// sanitize.js가 내보내는 두 관문. 이름 문자열이 아니라 **import binding**으로 추적한다.
const SANITIZER_EXPORTS = { sanitizeHtml: 'html', sanitizeSvg: 'svg' };

// library/sanitize.js를 import 하는 파일 전수. 저장 경로 모듈이 새로 import 하면 RED,
// 반대로 예상 파일이 사라져도 RED다(정렬 후 완전 일치 — "포함" 검사가 아니다).
// 실측 11파일 = JSX sink 보유 10 + sink 0인 library/mathRender.js 1.
const SANITIZE_IMPORTERS = [
  'components/Branch/Tasks/CommentItem.js',
  'components/Branch/Tasks/TaskDetailPanel.js',
  'components/Branch/Tasks/TaskFullPage.js',
  'components/Branch/Tasks/TaskIssueDetail.js',
  'components/Canvas/AnnotationSidebar.js',
  'components/Canvas/CanvasOverview.js',
  'components/Canvas/CanvasPageView.js',
  'components/Canvas/RefPreviewPanel.js',
  'components/Canvas/TypstEditor.js',
  'components/Track/Detail/TrackItemDetail.js',
  'library/mathRender.js',                   // sanitizeSvg를 쓰지만 JSX sink는 0개
];
const NO_SINK_IMPORTERS = ['library/mathRender.js'];

// ⛔ 파일별 개수만 세면 **역할 맞교환**을 못 잡는다(실측: Typst↔본문을 통째로 바꿔도
//    total/html/svg 합계가 같다). site를 (file, className, occurrence)로 식별해
//    **어느 자리가 어느 관문을 지나는지**까지 고정한다.
const SINK_INVENTORY = [
  { file: 'components/Branch/Tasks/CommentItem.js', className: 'CommentItem__Content', occurrence: 0, kind: 'html' },
  { file: 'components/Branch/Tasks/TaskDetailPanel.js', className: 'TaskDescReadonly', occurrence: 0, kind: 'html' },
  { file: 'components/Branch/Tasks/TaskFullPage.js', className: 'TaskDescReadonly', occurrence: 0, kind: 'html' },
  { file: 'components/Branch/Tasks/TaskIssueDetail.js', className: 'TaskDescReadonly', occurrence: 0, kind: 'html' },
  { file: 'components/Branch/Tasks/TaskIssueDetail.js', className: 'TaskDescReadonly', occurrence: 1, kind: 'html' },
  { file: 'components/Canvas/AnnotationSidebar.js', className: 'AnnotationSidebar__ReplyContent', occurrence: 0, kind: 'html' },
  { file: 'components/Canvas/CanvasOverview.js', className: 'CanvasOverview__OverviewContent', occurrence: 0, kind: 'html' },
  { file: 'components/Canvas/CanvasPageView.js', className: 'CanvasPageView__TypstPage', occurrence: 0, kind: 'svg' },
  { file: 'components/Canvas/CanvasPageView.js', className: 'CanvasPageView__Content ProseMirror', occurrence: 0, kind: 'html' },
  { file: 'components/Canvas/RefPreviewPanel.js', className: 'RefPreviewPanel__HtmlContent RefPreviewPanel__HtmlContent--doc ProseMirror', occurrence: 0, kind: 'html' },
  { file: 'components/Canvas/RefPreviewPanel.js', className: 'RefPreviewPanel__HtmlContent', occurrence: 0, kind: 'html' },
  { file: 'components/Canvas/TypstEditor.js', className: 'TypstEditor__Page', occurrence: 0, kind: 'svg' },
  { file: 'components/Track/Detail/TrackItemDetail.js', className: 'TrackDetail__Description', occurrence: 0, kind: 'html' },
];
const SINK_FILES = [...new Set(SINK_INVENTORY.map((s) => s.file))];

const JsxParser = Parser.extend(jsx());
const parse = (src) => JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
    else if (child && typeof child.type === 'string') walk(child, visit);
  }
}

// ── module specifier 해석 ────────────────────────────────────────────────────
// ⛔ 문자열 prefix 비교 금지 — '@/library/sanitizer'·'./sanitizeHelper'가 걸린다.
function resolveSpecifier(spec, importerFile) {
  if (typeof spec !== 'string') return null;
  let base;
  if (spec.startsWith('@/')) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(importerFile), spec);
  else return null;                       // bare 패키지
  return /\.[a-zA-Z0-9]+$/.test(base) ? base : `${base}.js`;   // 확장자 유무 정규화
}

// static import · side-effect import · dynamic import() · re-export 전부 본다.
// 주석 속 문자열은 AST에 없으므로 자동으로 제외된다.
function moduleSpecifiers(ast) {
  const out = [];
  walk(ast, (n) => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration'
         || n.type === 'ExportAllDeclaration') && n.source?.type === 'Literal') out.push(n.source.value);
    if (n.type === 'ImportExpression' && n.source?.type === 'Literal') out.push(n.source.value);
  });
  return out;
}

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walkFiles(full);
    else if (full.endsWith('.js')) yield full;
  }
}

function collectImporters() {
  const importers = [];
  for (const dir of ['components', 'pages', 'library']) {
    for (const full of walkFiles(resolve(ROOT, dir))) {
      const rel = relative(ROOT, full);
      if (rel.endsWith('.test.js') || rel === 'library/sanitize.js') continue;
      const hit = moduleSpecifiers(parse(readFileSync(full, 'utf8')))
        .some((s) => resolveSpecifier(s, full) === SANITIZE_MODULE);
      if (hit) importers.push(rel);
    }
  }
  return importers;
}

// ── lexical scope · binding identity ─────────────────────────────────────────
// ⛔ 재할당을 Set<string>으로 추적하지 마라 — 다른 scope의 동명 변수 write가 안전한
//    바깥 const까지 오염시킨다. binding **객체**마다 written을 단다.
// ⛔ scope/binding graph를 두 번 만들지 마라 — 첫 pass에서 written=true가 된 binding을
//    나중 검증이 새 객체로 재생성하면 write를 통째로 잊는다(실측: useMemo 콜백 안의
//    직접·destructuring·for-of/in write 4종이 전부 false-green).
const mkBinding = (kind, extra = {}) => ({ kind, written: false, ...extra });
const makeScope = (parent) => ({ parent, vars: new Map() });
const lookup = (scope, name) => {
  for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
  return null;
};
function declarePattern(pat, scope, mk) {
  if (!pat) return;
  if (pat.type === 'Identifier') scope.vars.set(pat.name, mk());
  else if (pat.type === 'ObjectPattern') pat.properties.forEach((p) => declarePattern(p.value ?? p.argument, scope, mk));
  else if (pat.type === 'ArrayPattern') pat.elements.forEach((e) => declarePattern(e, scope, mk));
  else if (pat.type === 'AssignmentPattern') declarePattern(pat.left, scope, mk);
  else if (pat.type === 'RestElement') declarePattern(pat.argument, scope, mk);
}
const opaque = () => mkBinding('opaque');

// let/const/function/class/import — block 단위
function hoistLexical(stmts, scope) {
  for (const st of stmts) {
    if (!st) continue;
    if (st.type === 'ImportDeclaration') st.specifiers.forEach((sp) => scope.vars.set(sp.local.name, opaque()));
    else if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
      for (const d of st.declarations) {
        if (d.id.type === 'Identifier') {
          scope.vars.set(d.id.name, mkBinding('value', { declKind: st.kind, init: d.init, scope }));
        } else declarePattern(d.id, scope, opaque);
      }
    } else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) {
      scope.vars.set(st.id.name, opaque());
    } else if (st.type === 'ExportNamedDeclaration' && st.declaration) hoistLexical([st.declaration], scope);
    else if (st.type === 'ExportDefaultDeclaration' && st.declaration?.id) scope.vars.set(st.declaration.id.name, opaque());
  }
}

const isFn = (n) => n?.type === 'FunctionDeclaration' || n?.type === 'FunctionExpression'
  || n?.type === 'ArrowFunctionExpression';

// var는 nearest function/module scope로 hoist된다. 중첩 함수 안의 var는 새지 않는다.
function hoistVars(stmts, fnScope) {
  const rec = (n) => {
    if (!n || typeof n.type !== 'string' || isFn(n)) return;
    if (n.type === 'VariableDeclaration' && n.kind === 'var') {
      for (const d of n.declarations) {
        if (d.id.type === 'Identifier') {
          fnScope.vars.set(d.id.name, mkBinding('value', { declKind: 'var', init: d.init, scope: fnScope }));
        } else declarePattern(d.id, fnScope, opaque);
      }
    }
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const c = n[key];
      if (Array.isArray(c)) c.forEach(rec);
      else if (c && typeof c.type === 'string') rec(c);
    }
  };
  stmts.forEach(rec);
}

// 대입 대상 이름. MemberExpression은 재바인딩이 아니라 []. 모르는 형태는 null(=fail-closed).
function assignedNames(target) {
  if (!target) return null;
  if (target.type === 'MemberExpression') return [];
  if (target.type === 'Identifier') return [target.name];
  if (target.type === 'ObjectPattern') {
    const out = [];
    for (const p of target.properties) {
      const inner = assignedNames(p.value ?? p.argument);
      if (inner === null) return null;
      out.push(...inner);
    }
    return out;
  }
  if (target.type === 'ArrayPattern') {
    const out = [];
    for (const e of target.elements) {
      if (!e) continue;
      const inner = assignedNames(e);
      if (inner === null) return null;
      out.push(...inner);
    }
    return out;
  }
  if (target.type === 'AssignmentPattern') return assignedNames(target.left);
  if (target.type === 'RestElement') return assignedNames(target.argument);
  return null;
}

// ── JSX spread ───────────────────────────────────────────────────────────────
const DYNAMIC = Symbol('dynamic-spread');
// spread가 실을 수 있는 key 집합. 정적으로 확정할 수 없으면 DYNAMIC.
function spreadKeys(node) {
  if (!node) return DYNAMIC;
  if (node.type === 'ObjectExpression') {
    const keys = new Set();
    for (const p of node.properties) {
      if (p.type === 'SpreadElement') {
        const inner = spreadKeys(p.argument);
        if (inner === DYNAMIC) return DYNAMIC;
        inner.forEach((k) => keys.add(k));
        continue;
      }
      if (p.type !== 'Property' || p.computed) return DYNAMIC;
      const k = p.key.type === 'Identifier' ? p.key.name : (p.key.type === 'Literal' ? p.key.value : null);
      if (k === null) return DYNAMIC;
      keys.add(k);
    }
    return keys;
  }
  if (node.type === 'LogicalExpression' || node.type === 'ConditionalExpression') {
    // `cond && {…}`는 right만, `a || b` · `a ?? b` · 삼항은 양쪽 다 실릴 수 있다.
    const parts = node.type === 'LogicalExpression'
      ? (node.operator === '&&' ? [node.right] : [node.left, node.right])
      : [node.consequent, node.alternate];
    const keys = new Set();
    for (const part of parts) {
      const inner = spreadKeys(part);
      if (inner === DYNAMIC) return DYNAMIC;
      inner.forEach((k) => keys.add(k));
    }
    return keys;
  }
  // falsy literal은 아무 key도 싣지 않는다
  if (node.type === 'Literal' && !node.value) return new Set();
  if (node.type === 'Identifier' && node.name === 'undefined') return new Set();
  return DYNAMIC;
}
// dangerouslySetInnerHTML은 host 요소에서만 효력이 있다. 대문자 컴포넌트로의 props 전달
// (`<Inner {...props} />`)까지 sink 후보로 보면 분석이 무의미해진다.
const isHostElement = (el) => el.name?.type === 'JSXIdentifier' && /^[a-z]/.test(el.name.name);

function elementFacts(el) {
  const attrs = el.attributes.filter((a) => a.type === 'JSXAttribute');
  const spreads = el.attributes.filter((a) => a.type === 'JSXSpreadAttribute');
  let dynamicSpread = false;
  const spreadKeySet = new Set();
  for (const s of spreads) {
    const k = spreadKeys(s.argument);
    if (k === DYNAMIC) dynamicSpread = true;
    else k.forEach((x) => spreadKeySet.add(x));
  }
  const dsih = attrs.filter((a) => a.name?.name === 'dangerouslySetInnerHTML');
  const classNames = attrs.filter((a) => a.name?.name === 'className');
  const host = isHostElement(el);
  const isSink = dsih.length > 0 || spreadKeySet.has('dangerouslySetInnerHTML') || (host && dynamicSpread);
  return { dsih, classNames, spreadKeySet, dynamicSpread, host, isSink };
}

/**
 * JSX의 dangerouslySetInnerHTML site를 **opening element 단위**로 전수 수집하고
 * (file, className, occurrence) identity + 관문 종류로 고정한다.
 * scope/binding graph는 **한 번만** 만들고 이후 판정은 그 graph를 조회만 한다.
 */
function analyzeSinks(src, filePath) {
  const ast = parse(src);

  const sanitizerLocals = new Map();   // local name -> 'html' | 'svg'
  const memoLocals = new Set();        // 실제 react 모듈의 useMemo local 전부(alias 복수 허용)
  for (const st of ast.body) {
    if (st.type !== 'ImportDeclaration') continue;
    if (resolveSpecifier(st.source.value, filePath) === SANITIZE_MODULE) {
      for (const sp of st.specifiers) {
        if (sp.type === 'ImportSpecifier' && SANITIZER_EXPORTS[sp.imported.name]) {
          sanitizerLocals.set(sp.local.name, SANITIZER_EXPORTS[sp.imported.name]);
        }
      }
    } else if (st.source.value === 'react') {
      for (const sp of st.specifiers) {
        if (sp.type === 'ImportSpecifier' && sp.imported.name === 'useMemo') memoLocals.add(sp.local.name);
      }
    }
  }

  let bail = false;
  const moduleScope = makeScope(null);
  hoistLexical(ast.body, moduleScope);
  for (const [local, which] of sanitizerLocals) moduleScope.vars.set(local, mkBinding('sanitizer', { which }));
  for (const local of memoLocals) moduleScope.vars.set(local, mkBinding('memo'));
  hoistVars(ast.body, moduleScope);   // 모듈 최상위 var가 import를 가리면 그쪽이 이긴다

  // ── 단일 pass: scope 생성 · binding 1회 생성 · write/return/sink 수집 ──────
  const returnsOf = new WeakMap();    // function node -> [{ arg, scope }]
  const writes = [];
  const rawSites = [];
  const fnStack = [];

  const visit = (node, scope) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'WithStatement') bail = true;

    if (node.type === 'AssignmentExpression') {
      const names = assignedNames(node.left);
      if (names === null) bail = true;
      else if (names.length) writes.push({ names, scope });
    } else if (node.type === 'UpdateExpression') {
      if (node.argument?.type === 'Identifier') writes.push({ names: [node.argument.name], scope });
      else if (node.argument?.type !== 'MemberExpression') bail = true;
    } else if (node.type === 'ReturnStatement') {
      const fn = fnStack[fnStack.length - 1];
      if (fn) returnsOf.get(fn).push({ arg: node.argument, scope });
    }

    if (isFn(node)) {
      const s = makeScope(scope);
      node.params.forEach((p) => declarePattern(p, s, opaque));
      returnsOf.set(node, []);
      fnStack.push(node);
      if (node.body.type === 'BlockStatement') {
        hoistVars(node.body.body, s);
        hoistLexical(node.body.body, s);
        node.body.body.forEach((x) => visit(x, s));
      } else {
        returnsOf.get(node).push({ arg: node.body, scope: s });   // 표현식 본문 = 암묵 return
        visit(node.body, s);
      }
      fnStack.pop();
      return;
    }
    if (node.type === 'BlockStatement') {
      const s = makeScope(scope);
      hoistLexical(node.body, s);
      node.body.forEach((x) => visit(x, s));
      return;
    }
    if (node.type === 'CatchClause') {
      const s = makeScope(scope);
      declarePattern(node.param, s, opaque);
      hoistLexical(node.body.body, s);
      node.body.body.forEach((x) => visit(x, s));
      return;
    }
    if (node.type === 'ForStatement' || node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
      const s = makeScope(scope);
      const head = node.init ?? node.left;
      if (head?.type === 'VariableDeclaration' && head.kind !== 'var') hoistLexical([head], s);
      // 선언이 아닌 for-of/in의 left는 **바깥 binding에 대한 write**다.
      if ((node.type === 'ForOfStatement' || node.type === 'ForInStatement')
          && node.left?.type !== 'VariableDeclaration') {
        const names = assignedNames(node.left);
        if (names === null) bail = true;
        else if (names.length) writes.push({ names, scope: s });
      }
      for (const k of ['init', 'test', 'update', 'left', 'right', 'body']) if (node[k]) visit(node[k], s);
      return;
    }
    if (node.type === 'SwitchStatement') {
      const s = makeScope(scope);
      node.cases.forEach((c) => hoistLexical(c.consequent, s));
      visit(node.discriminant, scope);
      node.cases.forEach((c) => {
        if (c.test) visit(c.test, s);
        c.consequent.forEach((st) => visit(st, s));
      });
      return;
    }
    if (node.type === 'JSXOpeningElement' && elementFacts(node).isSink) rawSites.push({ el: node, scope });

    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const c = node[key];
      if (Array.isArray(c)) c.forEach((x) => visit(x, scope));
      else if (c && typeof c.type === 'string') visit(c, scope);
    }
  };
  ast.body.forEach((st) => visit(st, moduleScope));

  // write는 **그 지점 scope에서 resolve한 바로 그 binding 객체**에 표시한다.
  for (const { names, scope } of writes) {
    for (const nm of names) {
      const b = lookup(scope, nm);
      if (b) b.written = true;
    }
  }

  const sanitizerCallOf = (n, scope) => {
    if (n?.type !== 'CallExpression' || n.callee?.type !== 'Identifier') return null;
    const b = lookup(scope, n.callee.name);
    return b?.kind === 'sanitizer' ? b.which : null;
  };
  // 값이 그대로 보존되는 fallback만 허용한다(문자열 리터럴 / 치환 없는 템플릿).
  const isSafeLiteral = (n) => (n?.type === 'Literal' && typeof n.value === 'string')
    || (n?.type === 'TemplateLiteral' && n.expressions.length === 0);

  const isSanitized = (node, scope, which, depth = 0) => {
    if (bail || !node || depth > 4) return false;
    if (sanitizerCallOf(node, scope) === which) return true;
    if (node.type === 'LogicalExpression' && (node.operator === '||' || node.operator === '??')) {
      return isSanitized(node.left, scope, which, depth) && isSafeLiteral(node.right);
    }
    if (node.type === 'Identifier') {
      const b = lookup(scope, node.name);
      // 재할당되지 않은 const binding만 따라간다(binding 객체 단위).
      if (!b || b.kind !== 'value' || b.declKind !== 'const' || !b.init || b.written) return false;
      return isSanitized(b.init, b.scope, which, depth + 1);
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier'
        && lookup(scope, node.callee.name)?.kind === 'memo') {
      const fn = node.arguments[0];
      if (!isFn(fn)) return false;
      // 첫 pass가 기록한 return과 **그 지점 scope**를 그대로 쓴다. 새 graph를 만들지 않는다.
      const rets = returnsOf.get(fn);
      if (!rets || rets.length === 0) return false;
      return rets.every((r) => isSanitized(r.arg, r.scope, which, depth + 1));
    }
    return false;   // SequenceExpression·ConditionalExpression 등은 값 보존을 보장하지 않는다
  };

  // sink element의 className은 정확히 하나의 static className이어야 identity가 된다.
  const classNameOf = (el) => {
    const attrs = el.attributes.filter((a) => a.type === 'JSXAttribute' && a.name?.name === 'className');
    if (attrs.length !== 1) return null;
    return attrs[0].value?.type === 'Literal' ? attrs[0].value.value : null;
  };

  const classify = ({ el, scope }) => {
    const f = elementFacts(el);
    if (f.dynamicSpread) return 'unsafe';                          // 안전을 증명할 수 없다
    if (f.spreadKeySet.has('dangerouslySetInnerHTML')) return 'unsafe';
    if (f.spreadKeySet.has('className')) return 'unsafe';          // identity를 덮어쓸 수 있다
    if (f.dsih.length !== 1 || f.classNames.length !== 1) return 'unsafe';
    if (classNameOf(el) === null) return 'unsafe';                 // 동적/중복 className
    const v = f.dsih[0].value;
    if (v?.type !== 'JSXExpressionContainer' || v.expression?.type !== 'ObjectExpression') return 'unsafe';
    const props = v.expression.properties;
    // 정확히 하나의 static·non-computed `__html` Property만 허용한다.
    // duplicate __html · spread · 추가 property · accessor/method가 전부 여기서 걸린다.
    if (props.length !== 1) return 'unsafe';
    const p = props[0];
    if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) return 'unsafe';
    const key = p.key.type === 'Identifier' ? p.key.name : (p.key.type === 'Literal' ? p.key.value : null);
    if (key !== '__html') return 'unsafe';
    if (isSanitized(p.value, scope, 'html')) return 'html';
    if (isSanitized(p.value, scope, 'svg')) return 'svg';
    return 'unsafe';
  };

  const seen = new Map();
  const sites = rawSites.map((s) => {
    const className = classNameOf(s.el);
    const occurrence = seen.get(className) ?? 0;
    seen.set(className, occurrence + 1);
    return { className, occurrence, kind: classify(s) };
  });

  return {
    sites,
    total: sites.length,
    html: sites.filter((s) => s.kind === 'html').length,
    svg: sites.filter((s) => s.kind === 'svg').length,
    unsafe: sites.filter((s) => s.kind === 'unsafe').length,
  };
}

// ── analyzer 자체 회귀 ───────────────────────────────────────────────────────
const FIXTURE_PATH = resolve(ROOT, 'components/__analyzerFixture.js');
const H = "import { sanitizeHtml, sanitizeSvg } from '@/library/sanitize';\n"
  + "import { useMemo } from 'react';\nconst raw = globalThis.raw;\n"
  + 'const flag = globalThis.flag;\nconst list = globalThis.list;\nconst obj = globalThis.obj;\n';
const sink = (expr, cls = 'X') => `<div className="${cls}" dangerouslySetInnerHTML={{ __html: ${expr} }} />`;
const render = (expr) => `${H}export default () => ${sink(expr)};\n`;
const wrap = (body) => `${H}export default () => { ${body} return ${sink('value')}; };\n`;
const memo = (inner) => wrap(`const value = useMemo(() => { ${inner} }, [raw]);`);
const shape = (src, path = FIXTURE_PATH) => analyzeSinks(src, path);

const POSITIVE = [
  ['직접 sanitizeHtml', render('sanitizeHtml(raw)'), { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['직접 sanitizeSvg', render('sanitizeSvg(raw)'), { total: 1, html: 0, svg: 1, unsafe: 0 }],
  ['안전한 literal fallback', render("sanitizeHtml(raw) || '<p>f</p>'"), { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['const alias 경유', wrap('const value = sanitizeHtml(raw);'), { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['실제 React useMemo가 sanitize 결과를 직접 return',
    wrap('const value = useMemo(() => sanitizeHtml(raw), [raw]);'), { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['useMemo block이 sanitize 결과를 return', memo('return sanitizeHtml(raw);'), { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['useMemo callback의 write 없는 const alias', memo('const clean = sanitizeHtml(raw); return clean;'),
    { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['다른 scope의 동명 binding write는 바깥 const를 오염시키지 않는다',
    `${H}function helper() { let value = raw; value = globalThis.other; return value; }\n`
    + `export default () => { const value = sanitizeHtml(raw); return ${sink('value')}; };\n`,
    { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['중첩 함수 안의 var는 바깥으로 새지 않는다',
    `${H}export default function C() { const inner = () => { var sanitizeHtml = (x) => x; return sanitizeHtml; };\n`
    + ` void inner; return ${sink('sanitizeHtml(raw)')}; }\n`, { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['onClick 전용 conditional spread는 sink가 아니다 (TaskDetailPanel 형태)',
    `${H}export default () => (<div className="Outer" {...(!raw && { onClick: () => {} })}>{${sink('sanitizeHtml(raw)')}}</div>);\n`,
    { total: 1, html: 1, svg: 0, unsafe: 0 }],
  ['대문자 컴포넌트로의 dynamic spread는 sink가 아니다 (TypstEditor 형태)',
    `${H}const Inner = () => null;\nexport default (props) => (<div className="Outer"><Inner {...props} />{${sink('sanitizeHtml(raw)')}}</div>);\n`,
    { total: 1, html: 1, svg: 0, unsafe: 0 }],
];

const NEGATIVE = [
  ['정상 sink 옆 raw sink 추가',
    `${H}export default () => <>${sink('sanitizeHtml(raw)', 'A')}${sink('raw', 'B')}</>;\n`,
    { total: 2, html: 1, unsafe: 1 }],
  ['JSX spread로 주입한 raw sink',
    `${H}export default () => <>${sink('sanitizeHtml(raw)', 'A')}`
    + '<div className="B" {...{ dangerouslySetInnerHTML: { __html: raw } }} /></>;\n',
    { total: 2, html: 1, unsafe: 1 }],
  ['host 요소의 dynamic spread는 fail-closed',
    `${H}export default (props) => <div className="A" {...props} />;\n`, { total: 1, html: 0, unsafe: 1 }],
  ['spread가 className을 덮어쓸 수 있으면 unsafe',
    `${H}export default () => <div className="A" {...{ className: 'B' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }} />;\n`,
    { total: 1, html: 0, unsafe: 1 }],
  ['duplicate className',
    `${H}export default () => <div className="A" className="B" dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }} />;\n`,
    { total: 1, html: 0, unsafe: 1 }],
  ['동적 className',
    `${H}export default () => <div className={raw} dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }} />;\n`,
    { total: 1, html: 0, unsafe: 1 }],
  ['useMemo callback 직접 assignment', memo('const clean = sanitizeHtml(raw); clean = raw; return clean;'),
    { total: 1, html: 0, unsafe: 1 }],
  ['useMemo callback destructuring assignment', memo('const clean = sanitizeHtml(raw); ({ clean } = obj); return clean;'),
    { total: 1, html: 0, unsafe: 1 }],
  ['useMemo callback for-of write', memo('const clean = sanitizeHtml(raw); for (clean of list) {} return clean;'),
    { total: 1, html: 0, unsafe: 1 }],
  ['useMemo callback for-in write', memo('const clean = sanitizeHtml(raw); for (clean in obj) {} return clean;'),
    { total: 1, html: 0, unsafe: 1 }],
  ['duplicate __html — safe 다음 raw', render('sanitizeHtml(raw), __html: raw'), { total: 1, html: 0, unsafe: 1 }],
  ['duplicate __html — raw 다음 safe', render('raw, __html: sanitizeHtml(raw)'), { total: 1, html: 0, unsafe: 1 }],
  ['computed __html key',
    `${H}export default () => <div className="A" dangerouslySetInnerHTML={{ ['__html']: sanitizeHtml(raw) }} />;\n`,
    { total: 1, html: 0, unsafe: 1 }],
  ['__html 객체에 spread가 섞임',
    `${H}export default () => <div className="A" dangerouslySetInnerHTML={{ ...obj, __html: sanitizeHtml(raw) }} />;\n`,
    { total: 1, html: 0, unsafe: 1 }],
  ['nested block var가 sanitizer를 shadow',
    `${H}export default function C() { if (flag) { var sanitizeHtml = (x) => x; }\n return ${sink('sanitizeHtml(raw)')}; }\n`,
    { total: 1, html: 0, unsafe: 1 }],
  ['for-var가 sanitizer를 shadow',
    `${H}export default function C() { for (var sanitizeHtml of list) { void sanitizeHtml; }\n return ${sink('sanitizeHtml(raw)')}; }\n`,
    { total: 1, html: 0, unsafe: 1 }],
  ['같은 binding 재할당 (let)', wrap('let value = sanitizeHtml(raw); value = raw;'), { total: 1, html: 0, unsafe: 1 }],
  ['같은 binding에 클로저 write', wrap('const value = sanitizeHtml(raw); globalThis.f = () => { value = raw; };'),
    { total: 1, html: 0, unsafe: 1 }],
  ['destructuring write', wrap('const value = sanitizeHtml(raw); [value] = [raw];'), { total: 1, html: 0, unsafe: 1 }],
  ['로컬 fake useMemo',
    "import { sanitizeHtml } from '@/library/sanitize';\nconst raw = globalThis.raw;\nconst useMemo = () => raw;\n"
    + `export default () => { const value = useMemo(() => sanitizeHtml(raw), []); return ${sink('value')}; };\n`,
    { total: 1, html: 0, unsafe: 1 }],
  ['callback 내부 block-shadow된 return',
    memo('{ const sanitizeHtml = (y) => y; return sanitizeHtml(raw); }'), { total: 1, html: 0, unsafe: 1 }],
  ['SequenceExpression 최종값이 raw', render('(sanitizeHtml(raw), raw)'), { total: 1, html: 0, unsafe: 1 }],
  ['Conditional의 한 분기가 raw', render('false ? sanitizeHtml(raw) : raw'), { total: 1, html: 0, unsafe: 1 }],
  ['dead sanitize call로 호출 수만 맞춤', wrap('sanitizeHtml(raw); const value = raw;'), { total: 1, html: 0, unsafe: 1 }],
  ['fallback이 literal이 아님', render('sanitizeHtml(raw) || raw'), { total: 1, html: 0, unsafe: 1 }],
  ['sanitize 모듈이 아닌 동명 함수',
    `const sanitizeHtml = (x) => x;\nconst raw = globalThis.raw;\nexport default () => ${sink('sanitizeHtml(raw)')};\n`,
    { total: 1, html: 0, unsafe: 1 }],
];

describe('analyzer — JSX sink 전수를 관문 종류로 가른다', () => {
  it.each(POSITIVE)('안전으로 인정: %s', (_label, src, want) => {
    expect(shape(src)).toMatchObject(want);
  });

  it.each(NEGATIVE)('거부: %s', (_label, src, want) => {
    expect(shape(src)).toMatchObject(want);
  });

  it('catch/for가 sanitizer 이름을 shadow해도 바깥 sink는 안전하다', () => {
    const inCatch = wrap('const value = sanitizeHtml(raw); try { globalThis.go(); } '
      + 'catch (sanitizeHtml) { sanitizeHtml(raw); }');
    expect(shape(inCatch)).toMatchObject({ total: 1, html: 1, unsafe: 0 });
    const inFor = wrap('const value = sanitizeHtml(raw); '
      + 'for (const sanitizeHtml of list) { sanitizeHtml(raw); }');
    expect(shape(inFor)).toMatchObject({ total: 1, html: 1, unsafe: 0 });
  });

  it('renamed import와 같은 모듈의 복수 alias를 모두 추적한다', () => {
    const renamed = "import { sanitizeHtml as clean, sanitizeSvg as cleanSvg } from '@/library/sanitize';\n"
      + "import { useMemo as memoA, useMemo as memoB } from 'react';\n"
      + 'const raw = globalThis.raw;\n'
      + `export default () => (<div className="Wrap">${sink('clean(raw)', 'A')}${sink('cleanSvg(raw)', 'B')}`
      + `{(() => { const v = memoA(() => clean(raw), []); return ${sink('v', 'C')}; })()}`
      + `{(() => { const w = memoB(() => clean(raw), []); return ${sink('w', 'D')}; })()}</div>);\n`;
    expect(shape(renamed)).toMatchObject({ total: 4, html: 3, svg: 1, unsafe: 0 });
  });

  // 제품 파일을 디스크에서 고치지 않고 in-memory로만 변형한다.
  it('CanvasPageView의 두 관문을 완전히 맞바꾸면 site identity가 RED다', () => {
    const p = resolve(ROOT, 'components/Canvas/CanvasPageView.js');
    const src = readFileSync(p, 'utf8');
    expect(shape(src, p).sites).toEqual([
      { className: 'CanvasPageView__TypstPage', occurrence: 0, kind: 'svg' },
      { className: 'CanvasPageView__Content ProseMirror', occurrence: 0, kind: 'html' },
    ]);
    const swapped = src
      .replace('__html: sanitizeSvg(typstSvg)', '__html: sanitizeHtml(typstSvg)')
      .replace('__html: sanitizeHtml(page.content)', '__html: sanitizeSvg(page.content)');
    expect(swapped, '맞교환이 실제로 적용돼야 한다').not.toBe(src);
    const after = shape(swapped, p);
    // 합계는 그대로다 — identity가 없으면 여기서 통과해 버린다.
    expect({ total: after.total, html: after.html, svg: after.svg }).toEqual({ total: 2, html: 1, svg: 1 });
    expect(after.sites).toEqual([
      { className: 'CanvasPageView__TypstPage', occurrence: 0, kind: 'html' },
      { className: 'CanvasPageView__Content ProseMirror', occurrence: 0, kind: 'svg' },
    ]);
  });

  it('TypstEditor의 sanitizeSvg를 벗기면 RED다', () => {
    const p = resolve(ROOT, 'components/Canvas/TypstEditor.js');
    const src = readFileSync(p, 'utf8');
    expect(shape(src, p).sites).toEqual([{ className: 'TypstEditor__Page', occurrence: 0, kind: 'svg' }]);
    const stripped = src.replace('__html: sanitizeSvg(svgContent)', '__html: svgContent');
    expect(stripped, '변형이 실제로 적용돼야 한다').not.toBe(src);
    expect(shape(stripped, p)).toMatchObject({ total: 1, html: 0, svg: 0, unsafe: 1 });
  });
});

describe('sanitizeHtml은 읽기 관문이다 — 저장 경로에 없다', () => {
  it('sanitize.js importer 집합이 프리즈된 목록과 정확히 같다', () => {
    // 정렬 후 완전 일치 — 늘어도 RED, 줄어도 RED.
    expect(collectImporters().slice().sort()).toEqual(SANITIZE_IMPORTERS.slice().sort());
  });

  it.each(SINK_FILES)('%s — sink identity와 관문 종류가 정본과 exact다', (file) => {
    const full = resolve(ROOT, file);
    const got = analyzeSinks(readFileSync(full, 'utf8'), full);
    const want = SINK_INVENTORY.filter((s) => s.file === file)
      .map(({ className, occurrence, kind }) => ({ className, occurrence, kind }));
    expect(got.sites, `${file} site inventory`).toEqual(want);
    expect(got.unsafe, `${file} 미보호 sink`).toBe(0);
  });

  it.each(NO_SINK_IMPORTERS)('%s — sanitize를 쓰지만 JSX sink는 0개다', (file) => {
    const full = resolve(ROOT, file);
    expect(analyzeSinks(readFileSync(full, 'utf8'), full).sites).toEqual([]);
  });

  it('importer 11 = sink 보유 10 + sink 0인 1이고, 전체 sink는 13 = html 11 + svg 2다', () => {
    expect(SINK_FILES).toHaveLength(10);
    expect(NO_SINK_IMPORTERS).toHaveLength(1);
    expect([...SINK_FILES, ...NO_SINK_IMPORTERS].slice().sort()).toEqual(SANITIZE_IMPORTERS.slice().sort());
    const all = SINK_FILES.flatMap((file) => {
      const full = resolve(ROOT, file);
      return analyzeSinks(readFileSync(full, 'utf8'), full).sites.map((s) => ({ file, ...s }));
    });
    expect(all).toHaveLength(13);
    expect(all.filter((s) => s.kind === 'html')).toHaveLength(11);
    expect(all.filter((s) => s.kind === 'svg')).toHaveLength(2);
    expect(all.filter((s) => s.kind === 'unsafe')).toHaveLength(0);
    expect(all).toEqual(SINK_INVENTORY);
  });
});
