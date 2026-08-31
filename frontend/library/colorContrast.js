// 사용자 저장색의 렌더타임 대비 보정 — 순수 함수만. DOM·React를 모른다.
// 고정 비율을 쓰지 않는 이유와 color-mix()를 쓰지 않는 이유는 S7 계획 「변경 A — 임의 저장색」.

// 저장색 "지원 집합" — 정확히 `#` + 16진 6자리. 넓히지 않는다.
// 이 함수의 산출물은 팔레트 매칭 키가 아니라 **라이트에 그대로 실릴 선언의 재료**다.
// 3자리 확장·trim·`#` 생략을 허용하면 오늘 무효라 버려지던 `${color}${접미}`가 유효해져
// 없던 배경이 생긴다 — S7 계획 「저장색 입력 계약」 브라우저 실측표.
// (Task 5 `tiptapColorMap.js`의 `normalizeCssColor`는 닫힌 26값 **매칭 전용**이라
//  3자리·rgb()를 계속 흡수한다. 용도가 달라서 다른 함수다 — 합치지 마라.)
const STORED_HEX6 = /^#([0-9a-fA-F]{6})$/;

export const TINT_LADDER = [8, 12, 16, 20, 25, 32];
export const BADGE_MIN = 1.25;   // 배지가 표면과 구분되는 최소 대비
export const TEXT_MIN = 4.5;     // WCAG AA (본문 크기)
const TINT_LIFT_STEP = 4;        // 사다리 소진 시 대비극 혼합 스텝(%)
const TINT_LIFT_MAX = 12;        // 〃 최대 스텝 수 — 상한이 상수라 종료가 보장된다
const INK_STEP = 6;              // 글자 밝기 조정(%p)
const INK_MAX_STEPS = 16;        // 〃 최대 스텝 수

export function normalizeStoredColor(input) {
  if (typeof input !== 'string') return null;
  const m = input.match(STORED_HEX6);
  return m ? `#${m[1].toUpperCase()}` : null;
}

export function hexToRgb(hex) {
  const c = normalizeStoredColor(hex);
  if (!c) return null;
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return null;
  return `#${rgb.slice(0, 3)
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

const channelLinear = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channelLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// a를 b 위에 percent% 만큼 섞는다 (sRGB 정수 보간 — hex alpha 합성과 같은 수학).
export function mixSrgb(a, b, percent) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return null;
  const t = Math.min(100, Math.max(0, percent)) / 100;
  return rgbToHex([0, 1, 2].map((i) => A[i] * t + B[i] * (1 - t)));
}

function rgbToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  const i = Math.floor((((h % 360) + 360) % 360) / 60);
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  return rgbToHex(table[i].map((v) => (v + m) * 255));
}

// deltaPoints는 HSL lightness의 퍼센트 포인트(예: -6 → L을 6%p 낮춘다).
export function adjustLightness(hex, deltaPoints) {
  const hsl = rgbToHsl(hex);
  if (!hsl) return null;
  const [h, s, l] = hsl;
  return hslToHex(h, s, Math.min(100, Math.max(0, l + deltaPoints)));
}

// 배지 배경: 저장색을 표면에 섞어 "표면과 구분되는 첫 비율"을 고른다.
export function tintFor(color, surface, startRatio = TINT_LADDER[0]) {
  const c = normalizeStoredColor(color);
  const s = normalizeStoredColor(surface);
  if (!c || !s) return null;
  let from = TINT_LADDER.findIndex((r) => r >= startRatio);
  if (from < 0) from = TINT_LADDER.length - 1;
  for (let i = from; i < TINT_LADDER.length; i++) {
    const bg = mixSrgb(c, s, TINT_LADDER[i]);
    if (contrastRatio(bg, s) >= BADGE_MIN) return bg;
  }
  // 사다리를 다 써도 못 만족하는 경우 = 저장색이 표면색과 거의 같다.
  // 표면과 섞는 한 어떤 비율로도 1.25를 못 만드므로 표면의 대비극으로 민다.
  // 상한이 상수(TINT_LIFT_MAX)라 결정성과 종료는 유지된다.
  const base = mixSrgb(c, s, TINT_LADDER[TINT_LADDER.length - 1]);
  const pole = relativeLuminance(s) > 0.5 ? '#000000' : '#FFFFFF';
  for (let i = 1; i <= TINT_LIFT_MAX; i++) {
    const lifted = mixSrgb(pole, base, i * TINT_LIFT_STEP);
    if (contrastRatio(lifted, s) >= BADGE_MIN) return lifted;
  }
  return mixSrgb(pole, base, TINT_LIFT_MAX * TINT_LIFT_STEP);
}

// 배지 글자: 배경 위에서 AA를 만족하는 첫 값. 이미 만족하면 원색을 보존한다.
export function inkFor(color, background) {
  const c = normalizeStoredColor(color);
  const bg = normalizeStoredColor(background);
  if (!c || !bg) return null;
  if (contrastRatio(c, bg) >= TEXT_MIN) return c;
  const dir = relativeLuminance(bg) > 0.18 ? -1 : 1;   // 밝은 배경이면 어둡게
  for (let i = 1; i <= INK_MAX_STEPS; i++) {
    const cand = adjustLightness(c, dir * INK_STEP * i);
    if (contrastRatio(cand, bg) >= TEXT_MIN) return cand;
  }
  return dir < 0 ? '#000000' : '#FFFFFF';
}
