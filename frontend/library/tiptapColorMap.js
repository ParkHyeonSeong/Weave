// TipTap 저장 콘텐츠의 닫힌 색 팔레트 26값과 그 다크 대응값.
// 원본은 components/Canvas/CanvasEditorToolbar.js:18-37이고 여기로 복사한다 — 툴바는
// lucide·에디터 명령을 import 하는 컴포넌트라 node 테스트에 끌어오면 체인이 딸려온다.
// 복사본 drift는 tiptapColorMap.test.js의 "툴바 팔레트와 값이 같다"가 막는다.
//
// 다크 값의 출처(테스트가 산출과 exact 대조한다):
//   배경 14값 : tintFor(light, --color-surface 다크값, 12)
//   유채 8값  : inkFor(light, TEXT_INK_BASE)
//   중립 4값  : 제품 승인 ramp — TEXT_DARK 주석 참조
//
// 텍스트 잉크의 기준 배경이 페이지 배경 토큰이 아닌 이유 — 편집/읽기 표면은 .Layout의
// $color-surface(styles/_themes.scss:118, layout.scss:8)이고, 툴바가 setColor와
// toggleHighlight와 셀 배경을 서로 독립으로 제공해서 텍스트색이 highlight/cell 배경 위에
// 얹힌다. 그래서 잉크는 "실제로 깔릴 수 있는 배경 중 가장 밝은 것"에서 AA를 만족해야 하고,
// 그 최악값이 BG_DARK 중 최대 휘도인 아래 TEXT_INK_BASE다. 더 어두운 배경(표면 토큰·페이지
// 배경 토큰과 나머지 BG_DARK)은 자동으로 통과한다 — 테스트가 12 x 10 조합 전건을 단정한다.
export const TEXT_INK_BASE = '#313337';

export const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999',
  '#DC2626', '#EA580C', '#D97706', '#16A34A',
  '#2563EB', '#7C3AED', '#DB2777', '#0891B2',
];

export const HIGHLIGHT_COLORS = [
  '#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA', '#DDD6FE',
];

export const CELL_BG_COLORS = [
  '#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8',
  '#FED7AA', '#DDD6FE', '#E0E7FF', '#F1F5F9',
];

// 첫 줄 4색(중립)은 제품 승인 ramp이고, 나머지 8색(유채)은 inkFor(light, TEXT_INK_BASE)
// 산출이다. 중립까지 알고리즘에 맡기면 검정과 가장 밝은 회색이 HSL lightness 격자의 같은
// 점으로 수렴해 사용자가 고른 두 색이 다크에서 구분되지 않는다. ramp는 원본의 강조 순서를
// 그대로 뒤집어 유지한다 — 가장 어두운 원본이 다크에서 가장 밝다.
// 테스트가 12값 전부 유일함 · 중립 4값 exact · 중립 강조 순서 · 유채 8값 inkFor exact를
// 각각 단정하므로, 어느 쪽도 임의 상수로 바꿔치기할 수 없다.
const TEXT_DARK = {
  '#000000': '#E6E6E6', '#434343': '#D1D1D1', '#666666': '#BCBCBC', '#999999': '#A8A8A8',
  '#DC2626': '#ED8F8F', '#EA580C': '#F57D3E', '#D97706': '#F78707', '#16A34A': '#1ABE56',
  '#2563EB': '#799FF3', '#7C3AED': '#B48EF5', '#DB2777': '#E876A9', '#0891B2': '#09A9CF',
};

// tintFor(light, --color-surface 다크값, 12) 산출.
const BG_DARK = {
  '#FEF08A': '#333229', '#BBF7D0': '#2B3332', '#BFDBFE': '#2B2F37', '#FBCFE8': '#322E34',
  '#FED7AA': '#332F2D', '#DDD6FE': '#2F2F37', '#E0E7FF': '#2F3137', '#F1F5F9': '#313337',
};

const slug = (hex) => hex.slice(1).toLowerCase();

export const TIPTAP_COLOR_MAP = [
  ...TEXT_COLORS.map((light) => ({
    kind: 'text', prop: 'color', light, dark: TEXT_DARK[light], className: `wv-tc-${slug(light)}`,
  })),
  ...HIGHLIGHT_COLORS.map((light) => ({
    kind: 'highlight', prop: 'background-color', light, dark: BG_DARK[light], className: `wv-hl-${slug(light)}`,
  })),
  ...CELL_BG_COLORS.map((light) => ({
    kind: 'cell', prop: 'background-color', light, dark: BG_DARK[light], className: `wv-cell-${slug(light)}`,
  })),
];

const HEX6 = /^#([0-9a-fA-F]{6})$/;
const HEX3 = /^#([0-9a-fA-F]{3})$/;

// CSS 공백은 정확히 다섯이다 — space · tab · LF · FF · CR (CSS Syntax Level 3). 정규식
// `\s`를 쓰면 VT(U+000B)와 NBSP(U+00A0) · EM SPACE(U+2003) 같은 유니코드 공백까지 포함해서,
// CSSOM이 버리는 선언을 유효색으로 되살린다(jsdom 실측: 이 다섯만 style.color가 채워진다).
const CSS_WS = '[ \\t\\n\\f\\r]';

// 콤마형과 공백형은 **각각** 완결된 문법이라 정규식을 따로 둔다. 하나로 합치면
// `rgb(R, G B)` / `rgb(R G, B)` 같은 혼합 문법까지 통과하는데, 이것도 CSSOM이 버리는 값이다
// (attribute 문자열에는 남지만 CSSOM은 그 선언을 폐기한다).
// 이 엄격함은 **이 모듈의 순수 parser API 계약**이다. 계획된 sanitizer는 CSSOM이 정규화한
// 값을 넘기므로 그 경로에서는 이 검사가 통과로 보장된다. 그래도 계약을 낮추지 않는 이유는
// `normalizeCssColor` / `dataColorForm`이 **외부에서 직접 호출 가능한 순수 함수**이기 때문이다 —
// 무효 CSS를 팔레트색으로 승격시키지 않는 것이 이 API 자체의 불변식이다.
// alpha가 붙은 rgba() · slash alpha · 퍼센트 채널 · named color는 팔레트 색이 아니라 받지 않는다.
const RGB_COMMA = new RegExp(
  `^rgb\\(${CSS_WS}*(\\d{1,3})${CSS_WS}*,${CSS_WS}*(\\d{1,3})${CSS_WS}*,${CSS_WS}*(\\d{1,3})${CSS_WS}*\\)$`, 'i');
const RGB_SPACE = new RegExp(
  `^rgb\\(${CSS_WS}*(\\d{1,3})${CSS_WS}+(\\d{1,3})${CSS_WS}+(\\d{1,3})${CSS_WS}*\\)$`, 'i');

/**
 * CSS 색 문자열을 '#RRGGBB' 대문자로 정규화. 팔레트 매칭 전용 — 알 수 없으면 null.
 * 값 **바깥**의 공백은 trim으로 흘린다. CSSOM은 선언 값을 감싼 공백에는 관대하고
 * (jsdom 실측: NBSP로 감싸도 style.color가 채워진다) 값 **안쪽** 구분자에만 엄격하다.
 */
export function normalizeCssColor(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const m6 = s.match(HEX6);
  if (m6) return `#${m6[1].toUpperCase()}`;
  const m3 = s.match(HEX3);
  if (m3) return `#${m3[1].split('').map((c) => c + c).join('').toUpperCase()}`;
  const rgb = s.match(RGB_COMMA) || s.match(RGB_SPACE);
  if (rgb) {
    const parts = rgb.slice(1, 4).map(Number);
    if (parts.some((v) => v > 255)) return null;
    return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  return null;
}

const BY_KIND = {
  text: new Map(TIPTAP_COLOR_MAP.filter((e) => e.kind === 'text').map((e) => [e.light, e])),
  highlight: new Map(TIPTAP_COLOR_MAP.filter((e) => e.kind === 'highlight').map((e) => [e.light, e])),
  cell: new Map(TIPTAP_COLOR_MAP.filter((e) => e.kind === 'cell').map((e) => [e.light, e])),
};

const CELL_TAGS = new Set(['TD', 'TH']);

/**
 * (요소 이름, CSS 프로퍼티, 값) → 시맨틱 클래스명. 팔레트 밖이면 null.
 * background-color는 요소로 갈린다: TD/TH는 셀 배경, 그 외는 하이라이트.
 */
export function paletteClassFor(nodeName, prop, value) {
  const hex = normalizeCssColor(value);
  if (!hex) return null;
  if (prop === 'color') return BY_KIND.text.get(hex)?.className ?? null;
  if (prop === 'background-color') {
    const map = CELL_TAGS.has(String(nodeName).toUpperCase()) ? BY_KIND.cell : BY_KIND.highlight;
    return map.get(hex)?.className ?? null;
  }
  return null;
}

/**
 * 라이브 DOM의 style 속성에 실제로 나타나는 직렬화 형태.
 * ProseMirror가 `dom.style.cssText = …`(prosemirror-model:3439)로 꽂기 때문에
 * CSSOM 직렬화(rgb)만 남는다 — hex 형태를 내면 dead 선택자가 된다.
 */
export function serializedForms(hex) {
  const c = normalizeCssColor(hex);
  if (!c) return [];
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return [`rgb(${r}, ${g}, ${b})`];
}

/** hex가 살아남는 유일한 자리(mark[data-color], setAttribute 경로)용 대문자 hex. */
export function dataColorForm(value) {
  return normalizeCssColor(value);
}
