import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'sass';
import postcss from 'postcss';
import { THIRD_PARTY_OWNED } from './colorExceptions.js';
import { mermaidThemeFor } from '../components/Canvas/extensions/mermaidConfig.js';

const FE = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(FE, rel), 'utf8');

// ⚠️ 이 describe의 단정은 전부 **컴파일 산출 CSS**를 본다 — 소스 정규식만 보는 게이트는
//    셀렉터 안 @import(무음 no-op)를 통과시킨다. Sass가 .css를 plain-CSS @import
//    패스스루로 처리하고 셀렉터 안 @import는 CSS 스펙상 무시되므로, 빌드는 초록인데
//    다크 규칙이 하나도 안 붙는 갈래가 실재한다.
describe('highlight.js — 다크 테마가 html[data-theme=dark] 아래로 실제 인라인된다', () => {
  const css = compile(resolve(FE, 'styles/vendor/highlight-themes.scss')).css;
  const root = postcss.parse(css);

  const selectorsUnder = (pred) => {
    const out = [];
    root.walkRules((rule) => { rule.selectors.forEach((s) => { if (pred(s)) out.push(s); }); });
    return out;
  };

  // sass 1.97은 attribute selector의 불필요한 따옴표를 제거한다 → [data-theme=dark] 무따옴표.
  const DARK = 'html[data-theme=dark]';

  // ⚠️ 단위는 **selector**다(규칙 아님). 빌드 산출 grep은 규칙 단위라 기대값이 17로 다르다.
  it('다크 스코프 안의 .hljs selector가 43개 이상이다 (github-dark 전체가 인라인됐다는 증거)', () => {
    const hits = selectorsUnder((s) => s.startsWith(DARK) && s.includes('.hljs'));
    expect(hits.length).toBeGreaterThanOrEqual(43);
  });

  it('베이스·대표 토큰 셀렉터가 전부 다크 스코프에 존재한다', () => {
    const all = selectorsUnder(() => true);
    for (const suffix of ['.hljs', 'pre code.hljs', 'code.hljs', '.hljs-keyword', '.hljs-string', '.hljs-comment', '.hljs-title']) {
      expect(all, suffix).toContain(`${DARK} ${suffix}`);
    }
  });

  it('다크 토큰색이 라이트 토큰색과 실제로 다르다 (같은 CSS를 두 번 실은 게 아니다)', () => {
    const colorOf = (selector) => {
      let v = null;
      root.walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;
        rule.walkDecls('color', (d) => { v = d.value.trim().toLowerCase(); });
      });
      return v;
    };
    expect(colorOf(`${DARK} .hljs-string`)).toBe('#a5d6ff');   // github-dark
    expect(colorOf('.hljs-string')).toBe('#032f62');           // github(light)
  });

  it('라이트 테마는 무스코프로 남아 있다 (명시도상 다크가 이긴다)', () => {
    const light = selectorsUnder((s) => s === '.hljs-string');
    expect(light.length).toBe(1);
  });

  it('_app.js가 highlight 테마 CSS를 직접 전역 import하지 않는다', () => {
    expect(read('pages/_app.js')).not.toMatch(/highlight\.js\/styles/);
  });

  it('_app.js가 vendor SCSS를 import한다', () => {
    expect(read('pages/_app.js')).toMatch(/@\/styles\/vendor\/highlight-themes\.scss/);
  });

  it('vendor SCSS 소스 자체에는 색 리터럴이 0건이다 (색은 전부 node_modules 소유)', () => {
    const src = read('styles/vendor/highlight-themes.scss');
    const literals = src.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*[0-9.]|\bhsla?\(\s*[0-9.]/g) || [];
    expect(literals).toEqual([]);
  });
});

// 이 describe는 **매니페스트(THIRD_PARTY_OWNED)와 실제 배선이 어긋나는 것**을 잡는다.
// 색 리터럴 자체를 세는 게 아니라 "라이브러리가 색을 소유한다"는 전제가 계속 참인지 본다 —
// 전제가 깨지는 순간(우리 소스에 리터럴이 생김·배선이 끊김) RED가 된다.
describe('third-party 소유권 등록 — 배선과 매니페스트가 어긋나지 않는다', () => {
  const COLOR_LITERAL = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?)\(\s*[0-9.]/g;

  // ⚠️ length >= 5 는 false-green이었다 — 한 항목을 지우고 다른 항목을 복제하면
  //    길이가 5로 유지돼 통과한다. exact 집합 + 중복 금지 두 축으로 닫는다.
  const OWNED_FILES = [
    'components/Canvas/extensions/mermaidConfig.js',
    'components/common/IconPicker.js',
    'library/editorTheme.js',
    'node_modules/katex/dist/katex.min.css',
    'styles/vendor/highlight-themes.scss',
  ];

  it('등록 경로가 정확히 5개 unique 경로의 exact 집합이다', () => {
    const files = THIRD_PARTY_OWNED.map((e) => e.file);
    expect(THIRD_PARTY_OWNED.length).toBe(5);
    expect([...files].sort()).toEqual(OWNED_FILES);   // 삭제·추가·오타 전부 RED
    expect(new Set(files).size).toBe(5);              // 삭제+복제 mutation을 잡는 축
  });

  it('모든 항목이 category "third-party"이고 reason이 20자 이상이다', () => {
    for (const e of THIRD_PARTY_OWNED) {
      expect(e.category, e.file).toBe('third-party');
      expect(e.reason.length, e.file).toBeGreaterThanOrEqual(20);
      expect(typeof e.owner, e.file).toBe('string');
      expect(typeof e.mechanism, e.file).toBe('string');
    }
  });

  it('등록된 파일이 실제로 존재한다', () => {
    for (const e of THIRD_PARTY_OWNED) {
      expect(() => read(e.file), e.file).not.toThrow();
    }
  });

  // ⚠️ 이 목록은 **서드파티 배선 8파일**이다 — S8이 만지는 전체 파일 목록이 아니다.
  //    typstEditor.scss는 S8이 배경 1선언을 추가하지만 print-paper 예외(#fff 등)를
  //    정당하게 갖고 있어 여기 넣으면 안 된다. 그 파일은 아래 별도 describe가 본다.
  it('서드파티 배선 8파일에는 색 리터럴이 0건이다 (색은 전부 라이브러리 소유)', () => {
    const files = [
      'styles/vendor/highlight-themes.scss',
      'library/editorTheme.js',
      'library/mermaidRenderQueue.js',
      'components/Canvas/extensions/mermaidConfig.js',
      'components/Canvas/extensions/MermaidExtension.js',
      'components/common/IconPicker.js',
      'components/Canvas/TypstEditor.js',
      'components/common/RawMarkdownEditor.js',
    ];
    for (const f of files) {
      expect(read(f).match(COLOR_LITERAL) || [], f).toEqual([]);
    }
  });

  it('배선 drift — 각 서드파티가 실제로 테마에 연결돼 있다', () => {
    expect(read('components/common/IconPicker.js')).toMatch(/theme=\{resolved\}/);
    expect(read('components/common/IconPicker.js')).not.toMatch(/Theme\.AUTO|['"]auto['"]/);
    expect(read('components/Canvas/extensions/mermaidConfig.js')).not.toMatch(/theme:\s*['"]default['"]/);
    expect(read('components/Canvas/extensions/mermaidConfig.js')).toMatch(/securityLevel:\s*['"]strict['"]/);
    for (const f of ['components/Canvas/TypstEditor.js', 'components/common/RawMarkdownEditor.js']) {
      expect(read(f), f).toMatch(/createThemeBinding/);
      expect(read(f), f).toMatch(/theme-one-dark/);
      expect(read(f), f).toMatch(/reconfigure\(\)/);
    }
    // 공유 취소 ref 회귀 방지 — per-run 지역 플래그여야 한다
    const mx = read('components/Canvas/extensions/MermaidExtension.js');
    expect(mx).not.toMatch(/cancelledRef/);
    expect(mx).toMatch(/\}, \[source, resolved\]\);/);
  });

  // 위 배선 drift 테스트는 전부 **소스 문자열**만 본다 — `theme: 'default'`가 없다는 부정
  // 단정은 매핑이 실제로 무엇을 돌려주는지 한 글자도 검증하지 않는다(false-green).
  // 아래 두 테스트가 그 구멍을 닫는다: 하나는 매핑 함수를 직접 호출하고,
  // 다른 하나는 소비자가 '값'이 아니라 '실행 시점에 읽는 함수'를 넘긴다는 계약을 고정한다.
  it('mermaidThemeFor가 실제로 light→default / dark→dark / unknown→default를 돌려준다', () => {
    expect(mermaidThemeFor('light')).toBe('default');
    expect(mermaidThemeFor('dark')).toBe('dark');
    for (const bogus of [undefined, null, '', 'system', 'DARK', 0]) {
      expect(mermaidThemeFor(bogus), String(bogus)).toBe('default');
    }
  });

  it('renderMermaid 소비자가 실행 시점의 resolvedRef.current를 넘긴다 (상수 캡처 금지)', () => {
    const mx = read('components/Canvas/extensions/MermaidExtension.js');
    // 인자 1은 반드시 호출 시점에 최신값을 읽는 thunk여야 한다.
    // `renderMermaid('light', ...)`나 `renderMermaid(() => 'light', ...)`로 바꾸면 RED.
    expect(mx).toMatch(/renderMermaid\(\s*\(\)\s*=>\s*resolvedRef\.current\s*,/);
    // ref가 테마 변화를 실제로 따라가야 thunk가 의미를 갖는다.
    expect(mx).toMatch(/resolvedRef\.current\s*=\s*resolved;/);
    // renderMermaid 호출은 이 한 곳뿐 — 다른 호출부가 값을 직접 넘기면 잡는다.
    expect(mx.match(/renderMermaid\(/g) || []).toHaveLength(1);
  });
});

// Finding 1(대비 계약)의 좁은 회귀 핀. 새 validator를 만들지 않고 위 describe가 쓰는
// sass compile + postcss를 그대로 재사용한다.
//
// 고정하는 사실 하나: **Typst 편집기의 배경은 oneDark가 아니라 앱 토큰이 소유한다.**
// oneDark는 `&`(= .cm-editor)에 자기 배경을 칠하는데 그 위에서는 같은 oneDark 팔레트의
// stone·coral이 4.5:1 게이트를 통과하지 못한다(실측 3.86 / 4.38). $color-surface로
// 낮추면 팔레트 10색 최저가 4.90이 된다. 이 선언을 지우거나 다른 표면 토큰으로 되돌리면
// 다크 대비가 조용히 게이트 아래로 내려가므로 여기서 RED로 잡는다.
describe('CodeMirror 대비 계약 — Typst 편집기 배경은 앱 토큰이 소유한다', () => {
  const SELECTOR = '.TypstEditor__Code .cm-editor';
  const css = compile(resolve(FE, 'styles/components/canvas/typstEditor.scss')).css;
  const root = postcss.parse(css);

  const declsOf = (selector, prop) => {
    const out = [];
    root.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      rule.walkDecls(prop, (d) => out.push(d.value.trim()));
    });
    return out;
  };

  it(`${SELECTOR}의 background가 정확히 var(--color-surface)다`, () => {
    // 선언이 사라지면 [] → RED. 값이 바뀌면 값 불일치 → RED.
    expect(declsOf(SELECTOR, 'background')).toEqual(['var(--color-surface)']);
  });

  it('배경을 다른 토큰이나 리터럴로 되돌리지 않았다', () => {
    const all = declsOf(SELECTOR, 'background').concat(declsOf(SELECTOR, 'background-color'));
    expect(all).toHaveLength(1);
    // $color-bg 회귀(= .Layout 아래 표면) · oneDark 기본 배경 하드코딩 · 투명 위임 전부 RED
    for (const bad of ['var(--color-bg)', '#282c34', 'transparent', 'none']) {
      expect(all[0].toLowerCase(), bad).not.toBe(bad);
    }
    expect(all[0]).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);   // 리터럴 금지
  });

  // ⚠️ 이전 판은 `.cm-keyword`·`.cm-string` 같은 이름을 정규식으로 찾았는데, **CodeMirror 6에는
  //    그런 클래스가 없다** — oneDark의 HighlightStyle은 `.ͼp` 류의 생성 클래스를 쓴다. 그래서
  //    `.cm-content span { color: red }` 같은 광범위 전경 override가 그대로 통과했다(false-green).
  //    이름 목록을 늘리는 대신 **`.TypstEditor__Code` 아래 color 선언 전체를 exact allowlist로**
  //    고정한다 — 셀렉터 이름을 몰라도 "앱이 전경색을 덮는 곳은 정확히 이 둘뿐"이 단정된다.
  it('.TypstEditor__Code 아래 color 선언이 정확히 허용 목록 2건뿐이다 (구문 전경은 oneDark 소유)', () => {
    const norm = (x) => String(x).replace(/\s+/g, ' ').trim();
    const actual = [];
    root.walkRules((rule) => {
      rule.selectors.forEach((sel) => {
        if (!norm(sel).includes('.TypstEditor__Code')) return;
        rule.walkDecls('color', (d) => actual.push([norm(sel), norm(d.prop).toLowerCase(), norm(d.value)]));
      });
    });
    // 앱이 전경색을 소유하는 곳은 거터(보조 텍스트 토큰)와 협업 커서 라벨(고정 on-color) 둘뿐이다.
    // 구문 토큰 전경은 하나도 없어야 한다 — 있으면 oneDark 소유 기록과 어긋난다.
    const ALLOWED = [
      ['.TypstEditor__Code .cm-gutters', 'color', 'var(--color-text-tertiary)'],
      ['.TypstEditor__Code .yRemoteSelectionHead::after', 'color', '#fff'],
    ];
    const key = (t) => t.join(' | ');
    expect(actual.map(key).sort()).toEqual(ALLOWED.map(key).sort());
  });
});
