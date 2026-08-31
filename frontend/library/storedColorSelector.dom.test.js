// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass';
import postcss from 'postcss';
import { TIPTAP_COLOR_MAP, serializedForms, dataColorForm } from './tiptapColorMap.js';

const here = dirname(fileURLToPath(import.meta.url));
const scss = readFileSync(resolve(here, '../styles/components/common/storedColor.scss'), 'utf8');
// `.ProseMirror` 블록이 없으면 slice(-1)이 되어 아래 추출이 0건 → 존재 자체가 먼저 RED가 된다.
const pmIdx = scss.indexOf('.ProseMirror');
const pm = pmIdx < 0 ? '' : scss.slice(pmIdx);
// 주석에 설명용 선택자 예시를 적어 두므로 코드만 남긴다.
const code = pm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const TEXT = TIPTAP_COLOR_MAP.filter((e) => e.kind === 'text');
const HL = TIPTAP_COLOR_MAP.filter((e) => e.kind === 'highlight');
const BG_FORMS = [...new Map(TIPTAP_COLOR_MAP.filter((e) => e.kind !== 'text')
  .map((e) => [serializedForms(e.light)[0], e])).entries()];

// SCSS 소스에 적힌 그대로의 경계형 선택자. 문자열을 손으로 만들지 않고 파일에서 뽑는다.
const boundarySelectors = [...code.matchAll(/:where\(\[style\^='[^']+'\], \[style\*='; [^']+'\]\)/g)]
  .map((m) => m[0]);
const markSelectors = [...code.matchAll(/mark\[data-color='[^']+' i\]/g)].map((m) => m[0]);

const selectorFor = (prop, form) => `:where([style^='${prop}: ${form}'], [style*='; ${prop}: ${form}'])`;

// ProseMirror와 같은 경로(`dom.style.cssText = …`)로 만들어 CSSOM 직렬화를 그대로 재현한다.
const mk = (css, tag = 'span') => {
  const el = document.createElement(tag);
  el.style.cssText = css;
  document.body.appendChild(el);
  return el;
};
const mkAttr = (attrs, tag = 'span') => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
};

describe('열거 선택자가 SCSS에 실제로 존재한다', () => {
  it('경계형 선택자 20개 · mark[data-color] 6개를 SCSS에서 뽑았다', () => {
    expect(boundarySelectors, '경계형 :where 선택자').toHaveLength(20);
    expect(markSelectors, 'mark[data-color] 선택자').toHaveLength(6);
  });
});

describe('텍스트 선택자는 진짜 color 선언만 잡는다', () => {
  it.each(TEXT)('$light — 단독 / 앞에 선언 / 뒤에 선언 3형태 모두 매칭', (e) => {
    const form = serializedForms(e.light)[0];
    const sel = selectorFor('color', form);
    expect(boundarySelectors, `${e.className} 선택자가 SCSS에 없다`).toContain(sel);
    for (const css of [
      `color: ${e.light}`,
      `font-weight: 700; color: ${e.light}`,
      `color: ${e.light}; font-weight: 700`,
    ]) {
      expect(mk(css).matches(sel), `${e.className} / ${css}`).toBe(true);
    }
  });

  it.each(TEXT)('$light — 같은 값의 background/border/outline-color는 미매칭', (e) => {
    const sel = selectorFor('color', serializedForms(e.light)[0]);
    for (const prop of ['background-color', 'border-color', 'outline-color']) {
      expect(mk(`${prop}: ${e.light}`).matches(sel), `${e.className} / ${prop}`).toBe(false);
    }
  });
});

describe('배경 선택자는 진짜 background-color 선언만 잡는다', () => {
  it.each(BG_FORMS)('%s — 진짜 background-color는 매칭, 같은 값의 color는 미매칭', (form, e) => {
    const sel = selectorFor('background-color', form);
    expect(boundarySelectors, `${e.light} 배경 선택자가 SCSS에 없다`).toContain(sel);
    expect(mk(`background-color: ${e.light}`).matches(sel)).toBe(true);
    expect(mk(`background-color: ${e.light}`, 'td').matches(sel)).toBe(true);
    expect(mk(`background-color: ${e.light}`, 'mark').matches(sel)).toBe(true);
    expect(mk(`color: ${e.light}`).matches(sel)).toBe(false);
  });
});

describe('두 속성이 함께 있어도 각 선택자가 자기 속성만 잡는다', () => {
  it.each(TEXT.slice(0, 4))('$light + 하이라이트 배경 동시', (e) => {
    const bg = HL[0];
    const el = mk(`background-color: ${bg.light}; color: ${e.light}`);
    const textSel = selectorFor('color', serializedForms(e.light)[0]);
    const bgSel = selectorFor('background-color', serializedForms(bg.light)[0]);
    expect(el.matches(textSel), 'text 선택자').toBe(true);
    expect(el.matches(bgSel), 'bg 선택자').toBe(true);
    // 서로의 값으로는 잡히지 않는다
    expect(el.matches(selectorFor('color', serializedForms(bg.light)[0]))).toBe(false);
    expect(el.matches(selectorFor('background-color', serializedForms(e.light)[0]))).toBe(false);
  });
});

describe('팔레트 밖 색은 어떤 열거 선택자에도 걸리지 않는다 (passthrough 불변)', () => {
  it.each([
    ['color: #123456'],
    ['background-color: #123456'],
    ['color: #123456; background-color: #654321'],
    ['border-color: #DC2626'],
  ])('%s', (css) => {
    const el = mk(css);
    for (const sel of boundarySelectors) expect(el.matches(sel), `${css} / ${sel}`).toBe(false);
  });
});

describe('mark[data-color]는 hex와 대소문자 변형을 흡수한다', () => {
  it.each(HL)('$light — 대문자·소문자 data-color 모두 매칭', (e) => {
    const hex = dataColorForm(e.light);
    const sel = `mark[data-color='${hex}' i]`;
    expect(markSelectors, `${e.className} mark 선택자가 SCSS에 없다`).toContain(sel);
    expect(mkAttr({ 'data-color': hex }, 'mark').matches(sel)).toBe(true);
    expect(mkAttr({ 'data-color': hex.toLowerCase() }, 'mark').matches(sel)).toBe(true);
  });

  it('다른 팔레트 색의 data-color는 잡지 않는다', () => {
    const [a, b] = HL;
    expect(mkAttr({ 'data-color': dataColorForm(b.light) }, 'mark')
      .matches(`mark[data-color='${dataColorForm(a.light)}' i]`)).toBe(false);
  });
});

// ── 컴파일된 전체 selector로 실제 DOM 적용을 확인한다 ─────────────────────────
// ⛔ 내부 `:where(...)` 조각만 걸어 보면 부모(.ProseMirror)와 스코프(html[data-theme=dark])가
//    통째로 틀려도 GREEN이다. 여기서는 **컴파일 결과 그대로의 selector**를 쓴다.
const PREFIX = 'html[data-theme=dark] .ProseMirror ';
const compiledSelectors = (() => {
  const css = compileString(scss, { loadPaths: [resolve(here, '../styles')] }).css;
  const out = [];
  postcss.parse(css).walkRules((rule) => {
    if (/\[style\^=|\[data-color=/.test(rule.selector)) out.push(rule.selector);
  });
  return out;
})();

const setTheme = (v) => {
  if (v === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', v);
};
// .ProseMirror 부모 아래에 실제로 자식으로 붙인다.
const mkInPm = (css, tag = 'span') => {
  const pm = document.createElement('div');
  pm.className = 'ProseMirror';
  document.body.appendChild(pm);
  const el = document.createElement(tag);
  el.style.cssText = css;
  pm.appendChild(el);
  return el;
};
const mkOutsidePm = (css, tag = 'span') => {
  const el = document.createElement(tag);
  el.style.cssText = css;
  document.body.appendChild(el);
  return el;
};
const compiledFor = (prop, form) =>
  `${PREFIX}:where([style^="${prop}: ${form}"], [style*="; ${prop}: ${form}"])`;
const compiledMark = (hex) => `${PREFIX}mark[data-color="${hex}" i]`;

describe('컴파일된 전체 selector가 다크에서만, .ProseMirror 안에서만 적용된다', () => {
  it('컴파일 selector 26개를 모두 뽑았고 전부 다크 스코프 접두를 갖는다', () => {
    expect(compiledSelectors).toHaveLength(26);
    expect(compiledSelectors.filter((s) => !s.startsWith(PREFIX))).toEqual([]);
  });

  it.each(TIPTAP_COLOR_MAP.filter((e) => e.kind === 'text'))(
    '$light — dark + .ProseMirror 안에서 매칭, light에서는 미매칭', (e) => {
      const sel = compiledFor('color', serializedForms(e.light)[0]);
      expect(compiledSelectors, `${e.className} 컴파일 selector 없음`).toContain(sel);
      const el = mkInPm(`color: ${e.light}`);
      setTheme('dark');
      expect(el.matches(sel), 'dark').toBe(true);
      setTheme('light');
      expect(el.matches(sel), 'light').toBe(false);
      setTheme(null);
      expect(el.matches(sel), 'data-theme 없음(시스템 기본)').toBe(false);
      setTheme('dark');
    });

  it.each([...new Map(TIPTAP_COLOR_MAP.filter((e) => e.kind !== 'text')
    .map((e) => [serializedForms(e.light)[0], e])).entries()])(
    '%s — 배경도 dark 스코프에서만 매칭', (form, e) => {
      const sel = compiledFor('background-color', form);
      expect(compiledSelectors).toContain(sel);
      const el = mkInPm(`background-color: ${e.light}`, 'td');
      setTheme('dark');
      expect(el.matches(sel), 'dark').toBe(true);
      setTheme('light');
      expect(el.matches(sel), 'light').toBe(false);
      setTheme('dark');
    });

  it.each(TIPTAP_COLOR_MAP.filter((e) => e.kind === 'highlight'))(
    '$light — mark[data-color]도 dark 스코프에서만 매칭', (e) => {
      const hex = dataColorForm(e.light);
      const sel = compiledMark(hex);
      expect(compiledSelectors).toContain(sel);
      const pm = document.createElement('div');
      pm.className = 'ProseMirror';
      document.body.appendChild(pm);
      const m = document.createElement('mark');
      m.setAttribute('data-color', hex.toLowerCase());
      pm.appendChild(m);
      setTheme('dark');
      expect(m.matches(sel), 'dark + 소문자').toBe(true);
      setTheme('light');
      expect(m.matches(sel), 'light').toBe(false);
      setTheme('dark');
    });

  it('.ProseMirror 밖의 같은 인라인 색은 dark에서도 매칭되지 않는다', () => {
    setTheme('dark');
    for (const e of TIPTAP_COLOR_MAP.filter((x) => x.kind === 'text')) {
      const sel = compiledFor('color', serializedForms(e.light)[0]);
      expect(mkOutsidePm(`color: ${e.light}`).matches(sel), e.className).toBe(false);
    }
  });

  it('팔레트 밖 색은 dark + .ProseMirror 안에서도 어떤 컴파일 selector에도 안 걸린다', () => {
    setTheme('dark');
    for (const css of ['color: #123456', 'background-color: #123456', 'border-color: #DC2626']) {
      const el = mkInPm(css);
      for (const sel of compiledSelectors) expect(el.matches(sel), `${css} / ${sel}`).toBe(false);
    }
  });
});
