import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass';
import postcss from 'postcss';
import { contrastRatio, inkFor, tintFor, relativeLuminance } from './colorContrast.js';
import {
  TIPTAP_COLOR_MAP, TEXT_COLORS, HIGHLIGHT_COLORS, CELL_BG_COLORS, TEXT_INK_BASE,
  normalizeCssColor, paletteClassFor, serializedForms, dataColorForm,
} from './tiptapColorMap.js';

const here = dirname(fileURLToPath(import.meta.url));

const TEXT_ENTRIES = TIPTAP_COLOR_MAP.filter((e) => e.kind === 'text');
const HL_ENTRIES = TIPTAP_COLOR_MAP.filter((e) => e.kind === 'highlight');
const CELL_ENTRIES = TIPTAP_COLOR_MAP.filter((e) => e.kind === 'cell');
const BG_ENTRIES = [...HL_ENTRIES, ...CELL_ENTRIES];

// 다크 토큰 실측값 — styles/_themes.scss:117-118. 편집/읽기 표면은 .Layout의
// $color-surface(#17181C)이고 #0E0F11은 그 바깥 페이지 배경이다(layout.scss:8).
const SURFACE_DARK = '#17181C';
const BG_DARK_TOKEN = '#0E0F11';
const TEXT_DARK_TOKEN = '#E6E8EB';

// 중립 4색은 inkFor 격자 산출이 아니라 제품 승인 ramp다. inkFor는 #000000과 #999999를
// 같은 점으로 수렴시켜 사용자가 고른 검정/회색을 다크에서 구분 불가로 만든다.
const NEUTRAL_DARK = {
  '#000000': '#E6E6E6', '#434343': '#D1D1D1', '#666666': '#BCBCBC', '#999999': '#A8A8A8',
};
const NEUTRAL_ORDER = ['#000000', '#434343', '#666666', '#999999'];

// 텍스트색이 실제로 얹힐 수 있는 배경. 툴바가 setColor / toggleHighlight / 셀 배경을
// 서로 독립으로 제공하므로 텍스트색 × 배경색 조합은 실제로 만들어진다.
const textBackgrounds = (bgs) => TEXT_ENTRIES.flatMap((t) => bgs.map((b) => ({
  text: t.light, ink: t.dark, on: b.label, bg: b.hex,
})));
const SURFACE_BGS = [
  { label: '--color-surface(#17181C)', hex: SURFACE_DARK },
  { label: '--color-bg(#0E0F11)', hex: BG_DARK_TOKEN },
];
const HL_BGS = HL_ENTRIES.map((e) => ({ label: `highlight ${e.light}`, hex: e.dark }));
const CELL_BGS = CELL_ENTRIES.map((e) => ({ label: `cell ${e.light}`, hex: e.dark }));

describe('닫힌 팔레트 — 툴바 상수와 바이트 일치', () => {
  it('26값이고 종류별 개수가 맞다', () => {
    expect(TEXT_COLORS).toHaveLength(12);
    expect(HIGHLIGHT_COLORS).toHaveLength(6);
    expect(CELL_BG_COLORS).toHaveLength(8);
    expect(TIPTAP_COLOR_MAP).toHaveLength(26);
  });

  it('CanvasEditorToolbar.js의 팔레트와 값이 같다 (복사본 drift 방지)', () => {
    const src = readFileSync(resolve(here, '../components/Canvas/CanvasEditorToolbar.js'), 'utf8');
    const block = (name) => {
      const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
      expect(m, `${name} 블록을 못 찾았다`).toBeTruthy();
      return [...m[1].matchAll(/#[0-9A-Fa-f]{6}/g)].map((x) => x[0].toUpperCase());
    };
    expect(block('TEXT_COLORS')).toEqual(TEXT_COLORS);
    expect(block('HIGHLIGHT_COLORS')).toEqual(HIGHLIGHT_COLORS);
    expect(block('CELL_BG_COLORS')).toEqual(CELL_BG_COLORS);
  });

  it('TEXT 집합과 배경 집합은 교집합이 없다', () => {
    const bg = new Set([...HIGHLIGHT_COLORS, ...CELL_BG_COLORS]);
    expect(TEXT_COLORS.filter((c) => bg.has(c))).toEqual([]);
  });

  it('highlight와 cell은 light가 6쌍 겹쳐도 별개 엔트리로 남는다', () => {
    // Task 8의 exception tuple dedupe가 26 → 20으로 줄이는 자리다. 여기서 합치지 않는다.
    const shared = HIGHLIGHT_COLORS.filter((c) => CELL_BG_COLORS.includes(c));
    expect(shared).toHaveLength(6);
    expect(TIPTAP_COLOR_MAP).toHaveLength(26);
  });
});

describe('TIPTAP_COLOR_MAP shape — kind마다 prop·className이 결속된다', () => {
  const slug = (hex) => hex.slice(1).toLowerCase();
  const SHAPE = {
    text: { prop: 'color', prefix: 'wv-tc-', source: TEXT_COLORS },
    highlight: { prop: 'background-color', prefix: 'wv-hl-', source: HIGHLIGHT_COLORS },
    cell: { prop: 'background-color', prefix: 'wv-cell-', source: CELL_BG_COLORS },
  };

  it.each(TIPTAP_COLOR_MAP)('$className: kind=$kind의 prop·className 규칙을 지킨다', (e) => {
    const shape = SHAPE[e.kind];
    expect(shape, `알 수 없는 kind: ${e.kind}`).toBeTruthy();
    expect(e.prop, `${e.className}의 prop`).toBe(shape.prop);
    expect(e.className).toBe(`${shape.prefix}${slug(e.light)}`);
  });

  it.each(Object.entries(SHAPE))('%s kind의 light 집합이 원본 상수와 exact다', (kind, shape) => {
    expect(TIPTAP_COLOR_MAP.filter((e) => e.kind === kind).map((e) => e.light)).toEqual(shape.source);
  });

  it('kind는 정확히 3종이고 className 26개가 유일하다', () => {
    expect([...new Set(TIPTAP_COLOR_MAP.map((e) => e.kind))].sort()).toEqual(['cell', 'highlight', 'text']);
    const names = TIPTAP_COLOR_MAP.map((e) => e.className);
    expect(new Set(names).size).toBe(26);
    expect(names).toHaveLength(26);
  });
});

describe('다크 대응값 — 텍스트색 × 기본 표면', () => {
  it.each(textBackgrounds(SURFACE_BGS))(
    '$text 텍스트 다크값 $ink가 $on에서 AA를 넘는다', ({ ink, bg }) => {
      expect(contrastRatio(ink, bg)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('다크 대응값 — 텍스트색 × highlight 배경 (툴바가 독립 제공하므로 조합된다)', () => {
  it.each(textBackgrounds(HL_BGS))(
    '$text 텍스트 다크값 $ink가 $on 위에서 AA를 넘는다', ({ ink, bg }) => {
      expect(contrastRatio(ink, bg)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('다크 대응값 — 텍스트색 × cell 배경', () => {
  it.each(textBackgrounds(CELL_BGS))(
    '$text 텍스트 다크값 $ink가 $on 위에서 AA를 넘는다', ({ ink, bg }) => {
      expect(contrastRatio(ink, bg)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('다크 대응값 — 배경색 계약 (표면 분리 + 기본 본문색)', () => {
  it.each(BG_ENTRIES)(
    '$light 배경 다크값 위에서 --color-text(#E6E8EB)가 읽힌다', (e) => {
      expect(contrastRatio(TEXT_DARK_TOKEN, e.dark)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(e.dark, SURFACE_DARK)).toBeGreaterThanOrEqual(1.25);
      expect(contrastRatio(e.dark, BG_DARK_TOKEN)).toBeGreaterThanOrEqual(1.25);
    });
});

describe('텍스트 다크값의 고유성 — 사용자가 고른 색이 다크에서 합쳐지지 않는다', () => {
  it('TEXT 다크값 12개가 전부 유일하다', () => {
    const darks = TEXT_ENTRIES.map((e) => e.dark);
    expect(new Set(darks).size).toBe(12);
  });

  it.each(Object.entries(NEUTRAL_DARK))('중립색 %s의 다크값이 승인 ramp %s와 exact다', (light, dark) => {
    expect(TEXT_ENTRIES.find((e) => e.light === light).dark).toBe(dark);
  });

  it('중립 4색의 강조 순서가 유지된다 — #000000이 가장 밝고 #999999가 가장 약하다', () => {
    const lum = NEUTRAL_ORDER.map((l) => relativeLuminance(TEXT_ENTRIES.find((e) => e.light === l).dark));
    for (let i = 1; i < lum.length; i += 1) {
      expect(lum[i], `${NEUTRAL_ORDER[i]}는 ${NEUTRAL_ORDER[i - 1]}보다 약해야 한다`).toBeLessThan(lum[i - 1]);
    }
  });

  it('중립값은 inkFor 산출이 아니다 — 격자 수렴이 고유성 소실의 원인이었다', () => {
    expect(inkFor('#000000', TEXT_INK_BASE)).toBe(inkFor('#999999', TEXT_INK_BASE));
    expect(TEXT_ENTRIES.find((e) => e.light === '#000000').dark)
      .not.toBe(TEXT_ENTRIES.find((e) => e.light === '#999999').dark);
  });
});

describe('동결값이 colorContrast 산출과 exact — 임의 상수 치환 방지', () => {
  const CHROMATIC = TEXT_ENTRIES.filter((e) => !NEUTRAL_DARK[e.light]);

  it('중립 4 + 유채 8 = 텍스트 12, 배경 exact 대상 14다', () => {
    expect(Object.keys(NEUTRAL_DARK)).toHaveLength(4);
    expect(CHROMATIC).toHaveLength(8);
    expect(TEXT_ENTRIES).toHaveLength(12);
    expect(BG_ENTRIES).toHaveLength(14);
  });

  it('TEXT_INK_BASE는 배경 다크값 중 가장 밝은 값이다 (= 최악 조건)', () => {
    const darks = [...new Set(BG_ENTRIES.map((e) => e.dark))];
    const brightest = darks.reduce((a, b) => (relativeLuminance(b) > relativeLuminance(a) ? b : a));
    expect(TEXT_INK_BASE).toBe('#313337');
    expect(TEXT_INK_BASE).toBe(brightest);
  });

  it.each(CHROMATIC)(
    '유채색 $light의 다크값이 inkFor(light, "#313337") 산출과 같다', (e) => {
      expect(e.dark).toBe(inkFor(e.light, '#313337'));
    });

  it.each(BG_ENTRIES)(
    '$light 배경 다크값이 tintFor(light, "#17181C", 12) 산출과 같다', (e) => {
      expect(e.dark).toBe(tintFor(e.light, '#17181C', 12));
    });
});

describe('normalizeCssColor — 직렬화 변형 흡수', () => {
  it.each([
    ['#FEF08A', '#FEF08A'],
    ['#fef08a', '#FEF08A'],
    ['  #FeF08a  ', '#FEF08A'],
    ['#abc', '#AABBCC'],
    ['#ABC', '#AABBCC'],
    ['rgb(254, 240, 138)', '#FEF08A'],
    ['rgb(254,240,138)', '#FEF08A'],
    ['RGB( 254 , 240 , 138 )', '#FEF08A'],
    ['rgb(254 240 138)', '#FEF08A'],
    ['rgb( 254  240  138 )', '#FEF08A'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCssColor(input)).toBe(expected);
  });

  it.each(['inherit', 'transparent', 'currentColor', 'var(--x)', 'rgba(1,2,3,0.5)', '', null, undefined, 7])(
    '%s는 null이다', (bad) => {
      expect(normalizeCssColor(bad)).toBeNull();
    });

  // 콤마형과 공백형을 한 정규식으로 받으면 이 혼합 문법까지 통과한다. 브라우저·jsdom은
  // attribute 문자열은 남기지만 CSSOM은 그 선언을 버린다(style.color가 빈값).
  // 이 거부는 이 모듈의 **순수 parser API 계약**이다. 계획된 sanitizer는 CSSOM 정규화값을
  // 넘기지만, normalizeCssColor/dataColorForm은 외부에서 직접 호출 가능한 순수 함수라
  // "무효 CSS를 팔레트색으로 승격하지 않는다"가 API 자체의 불변식이다.
  it.each([
    'rgb(220, 38 38)',
    'rgb(220 38, 38)',
    'rgb(254, 240 138)',
    'rgb(254 240, 138)',
    'rgb(254,240 138)',
    'rgb(254 240,138)',
  ])('혼합 문법 %s는 null이다 (CSSOM이 버리는 값)', (bad) => {
    expect(normalizeCssColor(bad)).toBeNull();
  });

  it.each([
    'rgb(100%, 0%, 0%)',
    'rgb(100% 0% 0%)',
    'red',
    'rebeccapurple',
    'rgb(254 240 138 / 50%)',
    'rgb(254, 240, 138, 0.5)',
    'rgb(1234, 0, 0)',
    'rgb(300, 0, 0)',
    '#FEF08',
    'FEF08A',
  ])('기존 거부 계약 유지 — %s는 null이다', (bad) => {
    expect(normalizeCssColor(bad)).toBeNull();
  });
});

// CSS 공백은 space·tab·LF·FF·CR 다섯 뿐이다(CSS Syntax Level 3 §4.2). 정규식 `\s`는
// VT(U+000B)와 NBSP·EM SPACE 같은 유니코드 공백까지 포함해서, CSSOM이 버리는 선언을
// 유효색으로 되돌린다 — jsdom 실측으로 이 다섯 개만 style.color가 채워지는 것을 확인했다.
describe('normalizeCssColor — CSS 공백만 구분자로 인정한다', () => {
  const CSS_WS = [
    ['SPACE U+0020', '\u0020'], ['TAB U+0009', '\u0009'], ['LF U+000A', '\u000A'],
    ['FF U+000C', '\u000C'], ['CR U+000D', '\u000D'],
  ];
  const NON_CSS_WS = [
    ['VT U+000B', '\u000B'], ['NBSP U+00A0', '\u00A0'], ['EM SPACE U+2003', '\u2003'],
    ['THIN SPACE U+2009', '\u2009'], ['IDEOGRAPHIC SPACE U+3000', '\u3000'],
  ];

  it.each(CSS_WS)('%s는 comma형 구분자로 유효하다', (_name, ws) => {
    expect(normalizeCssColor(`rgb(220,${ws}38, 38)`)).toBe('#DC2626');
  });
  it.each(CSS_WS)('%s는 space형 구분자로 유효하다', (_name, ws) => {
    expect(normalizeCssColor(`rgb(220${ws}38 38)`)).toBe('#DC2626');
  });
  it.each(NON_CSS_WS)('%s는 comma형에서 null이다 (CSSOM 무효)', (_name, ws) => {
    expect(normalizeCssColor(`rgb(220,${ws}38, 38)`)).toBeNull();
  });
  it.each(NON_CSS_WS)('%s는 space형에서 null이다 (CSSOM 무효)', (_name, ws) => {
    expect(normalizeCssColor(`rgb(220${ws}38 38)`)).toBeNull();
  });
  it.each(NON_CSS_WS)('%s는 여는 괄호 뒤에서도 null이다', (_name, ws) => {
    expect(normalizeCssColor(`rgb(${ws}220, 38, 38)`)).toBeNull();
  });
});

describe('paletteClassFor — 요소 종류로 배경 맵을 가른다', () => {
  it('color는 항상 텍스트 맵', () => {
    expect(paletteClassFor('SPAN', 'color', '#DC2626')).toBe('wv-tc-dc2626');
    expect(paletteClassFor('TD', 'color', '#DC2626')).toBe('wv-tc-dc2626');
  });
  it('background-color는 TD/TH면 셀, 아니면 하이라이트', () => {
    expect(paletteClassFor('TD', 'background-color', '#FEF08A')).toBe('wv-cell-fef08a');
    expect(paletteClassFor('TH', 'background-color', 'rgb(254, 240, 138)')).toBe('wv-cell-fef08a');
    expect(paletteClassFor('MARK', 'background-color', '#FEF08A')).toBe('wv-hl-fef08a');
  });
  it('셀 전용 2색은 하이라이트 맵에 없다', () => {
    expect(paletteClassFor('TD', 'background-color', '#E0E7FF')).toBe('wv-cell-e0e7ff');
    expect(paletteClassFor('MARK', 'background-color', '#E0E7FF')).toBeNull();
  });
  it('팔레트 밖 색과 팔레트 밖 프로퍼티는 null이다', () => {
    expect(paletteClassFor('SPAN', 'color', '#123456')).toBeNull();
    expect(paletteClassFor('SPAN', 'border-color', '#DC2626')).toBeNull();
    expect(paletteClassFor('MARK', 'color', 'inherit')).toBeNull();
  });
  it('CSSOM이 버리는 문법은 클래스를 만들지 않는다', () => {
    expect(paletteClassFor('SPAN', 'color', 'rgb(220, 38 38)')).toBeNull();
    expect(paletteClassFor('TD', 'background-color', 'rgb(254 240, 138)')).toBeNull();
    expect(paletteClassFor('SPAN', 'color', 'rgb(220,\u00A038, 38)')).toBeNull();
  });
});

describe('serializedForms — 라이브 DOM의 style에 실제로 나타나는 형태', () => {
  it('rgb 형태 하나만 낸다 — style에 hex는 남지 않는다(§3 실측)', () => {
    expect(serializedForms('#FEF08A')).toEqual(['rgb(254, 240, 138)']);
  });
  it('hex 형태를 내면 dead 선택자가 생긴다 — 절대 포함하지 않는다', () => {
    for (const c of TIPTAP_COLOR_MAP) {
      expect(serializedForms(c.light).some((f) => f.includes('#'))).toBe(false);
    }
  });

  // 테스트가 impl을 재사용하지 않고 light hex에서 직접 채널을 뜯는다. 상수 하나를
  // 되돌려주는 구현은 26건 중 24건에서 즉시 RED가 된다.
  const independentRgb = (hex) => {
    const m = /^#(..)(..)(..)$/.exec(hex);
    return `rgb(${Number(`0x${m[1]}`)}, ${Number(`0x${m[2]}`)}, ${Number(`0x${m[3]}`)})`;
  };
  it.each(TIPTAP_COLOR_MAP)(
    '$className의 serializedForms가 $light의 독립 RGB 변환과 같다', (e) => {
      expect(serializedForms(e.light)).toEqual([independentRgb(e.light)]);
    });
});

describe('dataColorForm — hex가 살아남는 유일한 자리', () => {
  it('하이라이트 선택자용 대문자 hex를 낸다', () => {
    expect(dataColorForm('rgb(254, 240, 138)')).toBe('#FEF08A');
  });
  it.each(TIPTAP_COLOR_MAP)(
    '$className의 dataColorForm이 $light의 정규화값과 같다', (e) => {
      expect(dataColorForm(e.light)).toBe(e.light);
      expect(dataColorForm(e.light.toLowerCase())).toBe(e.light);
      expect(dataColorForm(serializedForms(e.light)[0])).toBe(e.light);
    });
});

describe('.ProseMirror 열거형 선택자 완전성', () => {
  const scss = readFileSync(resolve(here, '../styles/components/common/storedColor.scss'), 'utf8');
  const pm = scss.slice(scss.indexOf('.ProseMirror'));

  // 라이브 DOM의 style에는 rgb만 남는다(§3) → 매칭 문자열도 rgb형 하나뿐이다.
  // 선택자 문자열 존재만 보면 RHS가 통째로 틀려도 GREEN이므로 **선언 RHS까지 exact**로 본다.
  //
  // ⛔ 정규식으로 `:where(...)`를 통째로 매칭하지 마라. 선택자 안에 `rgb(…)`가 들어 있어
  //    `[^)]*` 류는 **첫 닫는 괄호에서 끊긴다**(실측: 26/26 전건 실패 = 언제나 RED인
  //    가짜 게이트). 선택자 문자열을 **exact로 찾고** 그 뒤 `{ … }`를 중괄호로 훑는다.
  const ruleBodyAfter = (css, selector) => {
    const i = css.indexOf(selector);
    if (i < 0) return null;
    const open = css.indexOf('{', i + selector.length);
    const close = css.indexOf('}', open);
    return open < 0 || close < 0 ? null : css.slice(open + 1, close);
  };
  const declValue = (body, prop) => {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*!important\\s*(?:;|$)`, 'i').exec(body);
    return m ? m[1].trim() : null;
  };

  it.each(TIPTAP_COLOR_MAP)('$light: 경계형 선택자가 있고 RHS가 e.dark와 exact다', (e) => {
    for (const form of serializedForms(e.light)) {
      const selector = `:where([style^='${e.prop}: ${form}'], [style*='; ${e.prop}: ${form}'])`;
      const body = ruleBodyAfter(pm, selector);
      expect(body, `${e.className} 규칙을 못 찾았다 / ${selector}`).not.toBeNull();
      expect(declValue(body, e.prop)?.toUpperCase(), `${e.className} RHS`).toBe(e.dark.toUpperCase());
    }
  });

  it('부분문자열 선택자를 쓰지 않는다 — 속성 경계가 고정돼야 한다', () => {
    // [style*='color: …']는 background-color/border-color/outline-color도 매칭한다.
    // 허용되는 [style*=…]는 반드시 '; '로 시작하는 경계형뿐이다.
    // ⚠️ 주석에 설명용으로 `[style*='color: …']`를 적어 두므로 주석을 먼저 걷어낸다 —
    //    안 걷으면 이 단정이 주석 한 줄 때문에 RED가 된다(실측).
    const code = pm.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const m of code.matchAll(/\[style\*=(['"])([^'"]+)\1\]/g)) {
      expect(m[2].startsWith('; '), `경계 없는 부분문자열 선택자: ${m[0]}`).toBe(true);
    }
    // 경계형 선택자는 정확히 20개다 — 텍스트 12 + 배경 8(하이라이트 6 ∪ 셀 8)
    expect([...code.matchAll(/:where\(\[style\^='[^']+'\], \[style\*='; [^']+'\]\)/g)]).toHaveLength(20);
  });

  it('하이라이트 6색은 mark[data-color=… i]로도 잡는다 — hex가 사는 유일한 자리', () => {
    for (const e of TIPTAP_COLOR_MAP.filter((x) => x.kind === 'highlight')) {
      expect(pm, e.className).toContain(`mark[data-color='${dataColorForm(e.light)}' i]`);
    }
  });

  it('dead 선택자를 만들지 않는다 — style 매칭에 hex를 쓰지 않는다', () => {
    // style에는 hex가 절대 없으므로 hex를 넣은 [style*=]는 영원히 매칭되지 않는다
    expect(pm).not.toMatch(/\[style\*=['"][^'"]*#[0-9a-fA-F]{3,8}/);
  });

  it('data-color 선택자는 대소문자 무시 플래그를 쓴다', () => {
    for (const m of pm.matchAll(/\[data-color=(['"])[^'"]+\1(\s*[a-zA-Z]?)\]/g)) {
      expect(m[2].trim(), m[0]).toBe('i');
    }
  });

  it('열거 선택자는 다크 스코프 안에만 있다', () => {
    const darkIdx = scss.indexOf("html[data-theme='dark']");
    expect(scss.slice(0, darkIdx)).not.toContain('[style*=');
    expect(scss.slice(0, darkIdx)).not.toContain('[data-color=');
  });
});

// ⛔ SCSS **소스 조각**만 세면 부모/스코프가 통째로 틀려도 GREEN이다(실측 2종):
//    ① `.ProseMirror {` → `.NotProseMirror {`  ② 블록을 다크 스코프 밖으로 이동
//    둘 다 boundary 20 / mark 6 / darkScopeLeak false로 현재 검사를 통과하지만,
//    컴파일 결과는 각각 "다른 부모"와 "라이트 전역 누출"이다. **컴파일된 전체 selector**를
//    exact로 잠근다.
describe('.ProseMirror 열거 선택자 — 컴파일된 전체 selector 결속', () => {
  const SCSS_PATH = resolve(here, '../styles/components/common/storedColor.scss');
  const PREFIX = 'html[data-theme=dark] .ProseMirror ';

  // 컴파일된 CSS에서 우리 열거 선택자(rule 단위)만 뽑는다.
  const enumeratedRules = (scssSource) => {
    const css = compileString(scssSource, { loadPaths: [resolve(here, '../styles')] }).css;
    const out = [];
    postcss.parse(css).walkRules((rule) => {
      if (!/\[style\^=|\[data-color=/.test(rule.selector)) return;
      const decls = [];
      rule.walkDecls((d) => decls.push({ prop: d.prop, value: d.value, important: d.important === true }));
      out.push({ selector: rule.selector, decls });
    });
    return out;
  };

  // 매핑표에서 기대 selector → 선언을 만든다. 손으로 쓰지 않는다.
  const expected = new Map();
  for (const e of TIPTAP_COLOR_MAP) {
    const form = serializedForms(e.light)[0];
    expected.set(`${PREFIX}:where([style^="${e.prop}: ${form}"], [style*="; ${e.prop}: ${form}"])`,
      { prop: e.prop, value: e.dark });
    if (e.kind === 'highlight') {
      expected.set(`${PREFIX}mark[data-color="${dataColorForm(e.light)}" i]`,
        { prop: 'background-color', value: e.dark });
    }
  }

  const actual = enumeratedRules(readFileSync(SCSS_PATH, 'utf8'));

  it('컴파일된 열거 선택자 집합이 매핑표 산출과 exact다 (26개)', () => {
    // 텍스트 12 + 배경 8 + mark 6 = 26. 하이라이트/셀이 공유하는 6쌍은 한 규칙이다.
    expect(expected.size, '기대 selector 수').toBe(26);
    expect(actual.map((r) => r.selector).sort()).toEqual([...expected.keys()].sort());
  });

  it('모든 열거 선택자가 html[data-theme=dark] .ProseMirror 접두를 갖는다', () => {
    const wrong = actual.map((r) => r.selector).filter((sel) => !sel.startsWith(PREFIX));
    expect(wrong, '부모/스코프가 틀린 선택자').toEqual([]);
    expect(actual).toHaveLength(26);
  });

  it.each([...expected.entries()])('%s — 선언이 !important로 매핑표 다크값과 exact다', (selector, want) => {
    const rule = actual.find((r) => r.selector === selector);
    expect(rule, `컴파일 결과에 없는 선택자: ${selector}`).toBeTruthy();
    expect(rule.decls).toHaveLength(1);
    expect(rule.decls[0].prop).toBe(want.prop);
    expect(rule.decls[0].value.toUpperCase()).toBe(want.value.toUpperCase());
    expect(rule.decls[0].important, '!important가 있어야 인라인을 이긴다').toBe(true);
  });

  // ── 부모/스코프 mutation은 in-memory로만 (제품 SCSS는 디스크에서 안 건드린다) ──
  it('부모가 .NotProseMirror로 바뀌면 RED다', () => {
    const src = readFileSync(SCSS_PATH, 'utf8');
    const mutated = src.replace('  .ProseMirror {', '  .NotProseMirror {');
    expect(mutated, '변이가 실제로 적용돼야 한다').not.toBe(src);
    const sels = enumeratedRules(mutated).map((r) => r.selector);
    expect(sels).toHaveLength(26);                                   // 개수는 그대로 — 개수만 세면 못 잡는다
    expect(sels.filter((s) => s.startsWith(PREFIX))).toEqual([]);    // 접두가 전부 깨진다
    expect(sels.sort()).not.toEqual([...expected.keys()].sort());
  });

  it('블록이 다크 스코프 밖으로 나가면 RED다 (라이트 누출)', () => {
    const src = readFileSync(SCSS_PATH, 'utf8');
    const lines = src.split('\n');
    const s0 = lines.findIndex((l) => l.trim().startsWith('// ── TipTap 라이브 에디터'));
    const e0 = lines.findIndex((l, i) => i > s0 && l === '  }');
    expect(s0 >= 0 && e0 > s0, '블록 경계를 찾아야 한다').toBe(true);
    const moved = [...lines.slice(0, s0), ...lines.slice(e0 + 1)].join('\n')
      + '\n' + lines.slice(s0, e0 + 1).map((l) => l.replace(/^ {2}/, '')).join('\n') + '\n';
    const sels = enumeratedRules(moved).map((r) => r.selector);
    expect(sels).toHaveLength(26);
    expect(sels.filter((s) => s.startsWith(PREFIX))).toEqual([]);    // 다크 접두가 사라진다
    expect(sels.some((s) => s.startsWith('.ProseMirror '))).toBe(true);   // 전역으로 샌다
  });
});
