import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { compile, compileString } from 'sass';
import postcss from 'postcss';
import * as SPEC from './s4Spec.mjs';
import * as EV from './s4Evaluator.mjs';
import * as CANON from './s4Canonicalize.mjs';
import * as PIX from './s4PixelDiff.mjs';
import { PNG } from 'pngjs';                          // 픽셀 테스트용(ESM — require 금지)
import { execSync } from 'node:child_process';        // 기존 파일에 없으므로 신규 추가
import { pathToFileURL } from 'node:url';             // compileString에 실제 파일 URL을 줘야 상대 @use가 풀린다
const sha256 = (x) => createHash('sha256').update(x).digest('hex');
const REPO = resolve(__dirname, '../..');   // BASE 소스를 git에서 읽을 때 사용   // createHash는 기존 import 재사용
// SURFACE_NAMES: 24개 이름 exact manifest(순서 포함) — spec과 독립 정의라야 drift를 잡는다
const SURFACE_NAMES = ['canvas', 'canvas-toolbar-active', 'canvas-matpill-on', 'sourcepicker',
  'sourcepicker-branch-hover', 'sourcepicker-group-hover', 'sourcepicker-task-hover',
  'sourcepicker-unparticipate-hover', 'sourcepicker-search-focus', 'sourcepicker-addmenu-open',
  'detail', 'detail-originlink-hover', 'detail-trackchip-hover', 'timeline',
  'timeline-lane-hover', 'timeline-lane-selected', 'tree', 'tree-row-hover', 'tree-row-selected',
  'bulkadd', 'createtrack', 'createtrack-visopt-active', 'settings-branches-edit',
  'settings-general-swatch'];

// ─────────────────────────────────────────────────────────────────────────────
// I1(18R) — **CSS 공백 전용 정규화**. CSS 스펙의 whitespace는 정확히 5종(space·tab·LF·FF·CR)이다.
// JS `\s`와 `String#trim()`은 NBSP(U+00A0)·EM SPACE(U+2003)·ZWNBSP(U+FEFF)·vertical tab(U+000B)까지
// 공백으로 취급하는데, 이들은 CSS에서 공백이 **아니다**(앞 셋은 ident 문자, U+000B는 아예 불법 문자).
// 그래서 기존 `/\s+/`·`trim()` 정규화는 브라우저가 "다른 셀렉터" 또는 "무효 선언(계산값 none)"으로
// 보는 입력을 게이트가 **canonical로 고쳐서 통과**시켰다 — 손실 정규화형 false-green.
// 18R 선재현 실측(현행 HEAD): 4종 공백 × (셀렉터 / box-shadow 값 / border 값) = **12/12 false-green**
// (`.X<NBSP>`가 rulesFound=1로 핀에 수집, `inset<NBSP>0 0 0 1px var(…)`가 canonical/visible=true).
// 이후 이 파일의 모든 CSS 텍스트 정규화는 아래 두 헬퍼만 쓴다(JS `\s`·`trim()` 직접 사용 금지).
const CSS_WS_CLASS = ' \\t\\n\\f\\r';
const CSS_WS_RE = new RegExp(`[${CSS_WS_CLASS}]+`, 'g');
const CSS_WS_EDGE_RE = new RegExp(`^[${CSS_WS_CLASS}]+|[${CSS_WS_CLASS}]+$`, 'g');
const cssTrim = (s) => String(s).replace(CSS_WS_EDGE_RE, '');
const normalizeCssWhitespace = (s) => cssTrim(String(s).replace(CSS_WS_RE, ' '));
// "JS는 공백으로 보지만 CSS는 아닌" 코드포인트 — postcss의 `rule.selectors`(list.comma)가 각 파트에
// **JS trim**을 적용하므로 이 문자가 셀렉터 경계에 있으면 우리 손에 닿기 전에 이미 삭제된다(파서
// 레벨 손실 정규화). 따라서 정규화만 고쳐선 부족하고, 이런 코드포인트를 포함한 셀렉터는 매칭
// 후보에서 통째로 배제한다(fail-closed — 실제로 다른 셀렉터를 같은 것으로 오인할 여지를 없앤다).
const JS_ONLY_WS_RE = new RegExp(`[^\\S${CSS_WS_CLASS}]`);
// ─────────────────────────────────────────────────────────────────────────────

// _themes.scss 계약: 컴파일 결과에 flat 블록 3개 —
//   [0] :root(라이트) [1] html[data-theme='dark'](다크) [2] :root(테마불변 별칭)
// [0]/[1]의 --키 집합이 다르면 한쪽 테마에서 반대 테마 값이 상속 누출된다.
const css = compile(resolve(__dirname, '../styles/_themes.scss')).css;
// ⚠️ sass 1.97은 attribute selector의 불필요한 따옴표를 제거한다: html[data-theme=dark]
//    (따옴표 필수 매칭이면 별칭 블록을 dark로 오인 — 리뷰 재현 [52,5]) — unquoted 허용 필수.
// I1(20R) — 토큰 identity 디코딩 단일화. 이전엔 라이트/다크/별칭 키 집합을 이 **raw 정규식**
// (extractTokenKeys)으로 뽑았는데, shape 검사·baseline 추출은 decodeCssIdentifier로 escape를 디코딩해
// 읽어서 **같은 토큰이 두 표현으로 갈렸다**: 별칭 블록의 `-\-color-bg`(실이름 --color-bg)는 raw 텍스트에
// `--`가 연속으로 안 남아 별칭 키에서 빠져 배타성 검사를 통과했다(라이트 재정의 침묵 오염 = false-green).
// 이제 light/dark/aliases는 아래 decodedThemeKeySets(structuralGate 3블록 + buildBlockValues 디코딩)로
// **단일 파생**되고 — shape·대칭·배타성·baseline이 전부 한 키 맵을 공유한다 — extractTokenKeys는 그
// false-green을 대조하는 **선재현 witness 전용**으로만 남는다(파생 경로 아님). 공백은 CSS 5종만 허용한다
// (I1(18R)) — `--color-bg<NBSP>:`는 별개 토큰이라 키에서 빠진다.
function extractTokenKeys(blockBody) {
  return new Set([...String(blockBody).matchAll(new RegExp(`--([a-z0-9-]+)[${CSS_WS_CLASS}]*:`, 'g'))].map((k) => k[1]));
}
// ⚠️ light/dark/aliases 파생은 structuralGate/buildBlockValues 정의 이후로 이동했다(decodedThemeKeySets,
//    아래 buildDarkValues 직후). 이 describe들은 전부 deferred it() 안에서 참조하므로 전방 선언이어도 안전.

describe('_themes.scss 토큰 대칭', () => {
  it('라이트/다크 블록이 존재하고 비어있지 않다', () => {
    expect(light?.size).toBeGreaterThan(30);
    expect(dark?.size).toBeGreaterThan(30);
  });
  it('라이트에만 있는 키가 없다', () => {
    expect([...light].filter((k) => !dark.has(k))).toEqual([]);
  });
  it('다크에만 있는 키가 없다', () => {
    expect([...dark].filter((k) => !light.has(k))).toEqual([]);
  });
});

// setA 원소 중 setB에도 있는 것들 — 별칭·라이트 키 교집합 판정(P1)과 그 synthetic 단위 검증이 공유.
function keyIntersection(setA, setB) {
  return [...setA].filter((k) => setB.has(k));
}

describe('별칭 블록(3번째) 키가 라이트·다크 블록과 배타적이다 (P1 — specificity 재선언 침묵 방지)', () => {
  // 별칭 블록은 라이트와 동일하게 ':root' 단독 셀렉터라 specificity가 같다 — 별칭이 라이트 키를
  // 재선언하면 파일 순서상 후행인 별칭 값이 라이트 실렌더를 조용히 덮어써도 아무 에러도 안 난다.
  // 위 대칭 검사는 라이트/다크만 비교해 이 경로를 못 잡는다 — 내부 리뷰 P1 지적. 별칭 키 집합과
  // 라이트/다크 키 집합의 교집합이 비어 있어야 함을 직접 단정한다(현행 별칭 5토큰 전부 배타 — 즉시 통과).
  // I1(20R): aliases/light/dark가 이제 shape·baseline과 **동일한 디코딩 AST 키 맵**(decodedThemeKeySets)이라
  // escaped 선행하이픈(`-\-color-bg`)이 별칭에서 라이트 토큰을 덮어써도 실이름으로 복원돼 교집합에 잡힌다
  // (아래 'I1(20R)' describe가 선재현↔RED 대조 — 옛 raw 정규식 파생은 이 escape를 놓쳐 통과했다).
  it('별칭 키 ∩ 라이트 키 = ∅', () => {
    expect(keyIntersection(aliases, light)).toEqual([]);
  });
  it('별칭 키 ∩ 다크 키 = ∅', () => {
    expect(keyIntersection(aliases, dark)).toEqual([]);
  });
});

describe('I1(20R) — 토큰 identity 디코딩 단일화 (escaped 별칭 재정의 선재현↔RED)', () => {
  // 선재현(옛 raw 정규식 파생): 별칭 블록의 `-\-color-bg: red`는 실이름 `--color-bg`(라이트 재정의, 별칭이
  // 후행 :root라 동일 specificity에서 침묵 승리)인데, 배타성 검사가 raw 정규식 키(extractTokenKeys)를 봐서
  // 별칭 집합에서 빠졌다 → keyIntersection(aliases, light) === [] → 통과(false-green). shape 검사는 블록
  // 내부 중복만 봐서 못 잡았고, **두 경로가 다른 키 표현**을 봤다. Fix: 디코딩 AST 키 맵(decodedThemeKeySets)
  // 하나를 shape·대칭·배타성·baseline이 공유 → 별칭에 실이름 color-bg가 복원돼 교집합이 비지 않는다(RED).
  const mkThemes = (escapedName) => `
    :root { --color-bg: #FFFFFF; --color-selected-indicator: transparent; --shadow-xs: 0 1px 2px rgba(0,0,0,0.04); }
    html[data-theme=dark] { --color-bg: #0E0F11; --color-selected-indicator: #6B7280; --shadow-xs: 0 1px 2px rgba(0,0,0,0.4); }
    :root { --color-alias-ok: 0; ${escapedName}: red; }
  `;
  // 실이름이 전부 --color-bg로 복원되는 4가지 escape 표현(선행하이픈·선행백슬래시·hex 이중하이픈·hex+리터럴).
  const ESCAPED_BG = ['-\\-color-bg', '\\--color-bg', '\\2d\\2d color-bg', '\\2d-color-bg'];
  it.each(ESCAPED_BG.map((n) => [n, n]))(
    '별칭 %s(실이름 --color-bg) 재정의: 디코딩 AST 키 맵이 라이트와 교집합으로 잡는다(배타성 단정이면 RED)',
    (_l, name) => {
      const { light: L, aliases: A } = decodedThemeKeySets(mkThemes(name));
      expect(A.has('color-bg'), '별칭 디코딩 키에 color-bg 복원').toBe(true);
      expect(keyIntersection(A, L)).toContain('color-bg'); // 실 배타성 단정(∩=∅)이면 RED로 떨어진다
    });
  it('선재현 witness(실경로 재현): 옛 경로 `Sass compile → raw 정규식(extractTokenKeys)`은 컴파일 후에도 `--`가 연속으로 안 남는 escape만 놓쳤다', () => {
    // M2(21R) 정정: 옛 경로는 **컴파일된** CSS에 raw 정규식을 걸었다(미컴파일 문자열이 아니다). Sass가
    // 선행하이픈 escape를 재직렬화하므로 실제 누락 여부는 compileString 출력으로만 판정할 수 있다.
    //   `-\-color-bg`·`-\2d color-bg` → 둘 다 `-\-color-bg`로 직렬화(리터럴 `--` 없음) → 옛 regex 놓침(진짜 구멍)
    //   `\2d\2d color-bg`·`\2d-color-bg` → `\--color-bg`로 직렬화(리터럴 `--color-bg` 포함) → 옛 regex 검출(구멍 아님)
    const compiledKeys = (escapedName) =>
      [...extractTokenKeys(compileString(`:root { --color-alias-ok: 0; ${escapedName}: red; }`).css)];
    // 실제 누락형만 — 컴파일 후 `-\-color-bg`라 옛 regex가 놓친다(이 두 형태가 옛 게이트의 false-green 지점).
    for (const name of ['-\\-color-bg', '-\\2d color-bg']) {
      expect(compiledKeys(name), name).not.toContain('color-bg');
    }
    // 대조: 컴파일 후 리터럴 `--color-bg`/`\--color-bg`가 남는 형태는 옛 regex도 검출했다(구멍 아님) —
    // 이전 witness가 `\2d\2d …`·`\2d-…`를 "누락형"으로 쓴 건 **미컴파일 문자열**에만 성립하던 오재현이었다.
    for (const name of ['\\2d\\2d color-bg', '\\2d-color-bg', '\\--color-bg', '--color-bg']) {
      expect(compiledKeys(name), name).toContain('color-bg');
    }
  });
  it('실 _themes.scss 파생은 디코딩 키 맵으로 배타성을 만족한다(별칭 ∩ 라이트·다크 = ∅)', () => {
    expect(keyIntersection(aliases, light)).toEqual([]);
    expect(keyIntersection(aliases, dark)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I1(21R) — **전체 테마 값 manifest(단일 원천)**. 20R까진 값 계약이 부분 baseline(코어 팔레트 +
// shadow-xs)에 머물러, 라이트·다크 `--track-paper`를 둘 다 `transparent`로 바꿔도 452/452 통과했다
// (외부 검수 격리 실증: track.scss 다수 배경이 소비하는 토큰이 투명해지는 **제품 UI 회귀**를 게이트가
// 놓침 — 게이트 결함이 아니라 진짜 회귀를 놓치는 것이라 실질적으로 중요). 부분 baseline을 증설하는
// 대신, buildBlockValues()가 읽는 **light/dark/alias 전체 토큰의 {key,value}**(컴파일 결과)를 이 상수
// 하나로 고정하고 기존 LIGHT_BASELINE·SHADOW_XS_BASELINE을 이 원천에서 **파생**시켜 중복 리터럴을 없앤다.
//   · 값은 결정적(핀 8곳 고정 컴파일 결과)이라 리터럴 상수로 둔다 — 새 토큰 추가/값 변경 시 이 manifest도
//     갱신해야 아래 무결성 describe가 통과한다(의도된 무결성 잠금). 현행 값 그대로 고정이라 452는 GREEN 유지.
//   · 별칭 블록은 var() 참조값(`var(--color-primary)` 등)이라 리터럴 색이 아니다 — manifest가 그 **참조
//     문자열**을 값으로 고정한다(디코딩 후 — buildBlockValues가 실이름 복원해 읽는다).
//   · 판정은 **값 기준**(컴파일 결과)이지 소스 기준이 아니다: Sass 표현만 바뀌고 컴파일 값이 같으면 GREEN
//     (예: `#{$_l-surface}` vs `#F9FAFB`) — buildBlockValues가 컴파일 출력을 읽으므로 자연 성립(아래 mutation).
// ─────────────────────────────────────────────────────────────────────────────
const THEME_VALUE_MANIFEST = {
  light: {
    'color-bg': '#FFFFFF',
    'color-surface': '#F9FAFB',
    'color-surface-hover': '#F3F4F6',
    'color-primary': '#5E6AD2',
    'color-primary-hover': '#4F5BC0',
    'color-primary-subtle': 'rgba(94, 106, 210, 0.08)',
    'color-text': '#1C1C1C',
    'color-text-secondary': '#6B7280',
    'color-text-tertiary': '#6B7280',
    'color-text-inverse': '#FFFFFF',
    'color-border': '#E5E5E5',
    'color-border-hover': '#D1D5DB',
    'color-input-bg': '#FFFFFF',
    'color-input-border': '#E5E5E5',
    'color-input-border-hover': '#D1D5DB',
    'color-selected-indicator': 'transparent',
    'color-error': '#DC2626',
    'color-error-bg': '#FEF2F2',
    'color-success': '#16A34A',
    'color-success-bg': '#F0FDF4',
    'color-warning': '#D97706',
    'color-warning-bg': '#FFFBEB',
    'color-code-bg': '#F1F3F5',
    'color-code-text': '#EB5757',
    'color-code-block-bg': '#F6F8FA',
    'color-ref-doc': '#C2410C',
    'color-ref-doc-bg': '#FFF7ED',
    'color-ref-issue': '#8B5CF6',
    'color-ref-issue-bg': '#F5F3FF',
    'color-status-in-progress': '#1E40AF',
    'color-status-in-progress-bg': '#DBEAFE',
    'color-primary-strong': 'rgb(70.0844660194, 83.8669902913, 203.3155339806)',
    'color-primary-border-soft': 'rgb(233.5072815534, 235.109223301, 248.9927184466)',
    'color-primary-wash': 'rgb(230.85, 232.65, 248.25)',
    'color-error-strong': 'rgb(187.0333333333, 30.1666666667, 30.1666666667)',
    'color-warning-strong': 'rgb(187.2233183857, 102.6708520179, 5.1766816143)',
    'color-warning-ink': '#B45309',
    'color-warning-ink-deep': '#92400E',
    'color-warning-ink-strong': '#78350F',
    'color-surface-sunken': 'rgb(245.94, 247.45, 248.96)',
    'color-surface-raised': 'rgb(252.06, 252.55, 253.04)',
    'color-bg-sunken': 'rgb(252.45, 252.45, 252.45)',
    'color-text-soft': 'rgb(114.25, 114.25, 114.25)',
    'color-border-faint': 'rgb(236.65, 236.65, 236.65)',
    'color-accent-scrum': '#16A34A',
    'color-accent-scrum-subtle': 'rgb(202.3113513514, 247.8886486486, 219.12)',
    'color-accent-scrum-wash': 'rgb(184.3372972973, 245.4627027027, 206.88)',
    'color-accent-scrum-border': 'rgb(103.4540540541, 234.5459459459, 151.8)',
    'color-accent-scrum-border-soft': 'rgb(148.3891891892, 240.6108108108, 182.4)',
    'color-accent-scrum-ring': 'rgba(22, 163, 74, 0.3)',
    'color-retro-try': '#2563EB',
    'color-retro-try-bg': 'rgb(251.8857142857, 252.7714285714, 254.7142857143)',
    'color-retro-try-border': 'rgb(195.8285714286, 212.6571428571, 249.5714285714)',
    'color-error-border-soft': 'rgb(245.5, 196.1, 196.1)',
    'color-backdrop': 'rgba(28, 28, 28, 0.32)',
    'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.04)',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.06)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.08)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.12)',
    'track-paper': '#F9FAFB',
    'track-card': '#FFFFFF',
    'track-paper-edge': '#F3F4F6',
    'track-ink-soft': '#4B5563',
    'track-border-soft': 'rgb(241.75, 241.75, 241.75)',
    'track-paper-raised': 'rgb(252.06, 252.55, 253.04)',
    'track-paper-raised-05': 'rgb(250.53, 251.275, 252.02)',
    'track-paper-sunken-1': 'rgb(245.94, 247.45, 248.96)',
    'track-paper-sunken-15': 'rgb(244.41, 246.175, 247.94)',
    'track-paper-sunken-2': 'rgb(242.88, 244.9, 246.92)',
  },
  dark: {
    'color-bg': '#0E0F11',
    'color-surface': '#17181C',
    'color-surface-hover': '#1E2025',
    'color-primary': '#7C8AEA',
    'color-primary-hover': '#8B98F0',
    'color-primary-subtle': 'rgba(124, 138, 234, 0.08)',
    'color-text': '#E6E8EB',
    'color-text-secondary': '#9CA3AF',
    'color-text-tertiary': '#828A99',
    'color-text-inverse': '#0E0F11',
    'color-border': '#26282E',
    'color-border-hover': '#33363E',
    'color-input-bg': '#17181C',
    'color-input-border': '#6B7280',
    'color-input-border-hover': '#7A8290',
    'color-selected-indicator': '#6B7280',
    'color-error': '#F0666B',
    'color-error-bg': '#2A1518',
    'color-success': '#4CC38A',
    'color-success-bg': '#12281C',
    'color-warning': '#E5A54B',
    'color-warning-bg': '#2A2110',
    'color-code-bg': '#1E2126',
    'color-code-text': '#F07178',
    'color-code-block-bg': '#14161A',
    'color-ref-doc': '#E8845A',
    'color-ref-doc-bg': '#2A1D12',
    'color-ref-issue': '#A78BFA',
    'color-ref-issue-bg': '#201A2E',
    'color-status-in-progress': '#7EA6F4',
    'color-status-in-progress-bg': '#14213B',
    'color-primary-strong': '#6D7BE0',
    'color-primary-border-soft': '#3A4160',
    'color-primary-wash': '#1E2340',
    'color-error-strong': '#E0575C',
    'color-warning-strong': '#D19335',
    'color-warning-ink': '#E5A54B',
    'color-warning-ink-deep': '#EDBB72',
    'color-warning-ink-strong': '#F3CD94',
    'color-surface-sunken': '#131418',
    'color-surface-raised': '#1B1D22',
    'color-bg-sunken': '#0B0C0E',
    'color-text-soft': '#8B93A1',
    'color-border-faint': '#2C2E35',
    'color-accent-scrum': '#4CC38A',
    'color-accent-scrum-subtle': '#12281C',
    'color-accent-scrum-wash': '#173524',
    'color-accent-scrum-border': '#3E7A5C',
    'color-accent-scrum-border-soft': '#2E5240',
    'color-accent-scrum-ring': 'rgba(76, 195, 138, 0.55)',
    'color-retro-try': '#7EA6F4',
    'color-retro-try-bg': '#14213B',
    'color-retro-try-border': '#34496E',
    'color-error-border-soft': '#A05259',
    'color-backdrop': 'rgba(0, 0, 0, 0.5)',
    'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.4)',
    'shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.5)',
    'shadow-md': '0 4px 12px rgba(0, 0, 0, 0.55)',
    'shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.65)',
    'track-paper': '#17181C',
    'track-card': '#1B1D22',
    'track-paper-edge': '#1E2025',
    'track-ink-soft': '#A8B0BC',
    'track-border-soft': '#2C2E35',
    'track-paper-raised': '#1B1D22',
    'track-paper-raised-05': '#191B1F',
    'track-paper-sunken-1': '#141518',
    'track-paper-sunken-15': '#121316',
    'track-paper-sunken-2': '#101114',
  },
  aliases: {
    'color-border-focus': 'var(--color-primary)',
    'shadow-focus': '0 0 0 3px var(--color-primary-subtle)',
    'track-ink': 'var(--color-text)',
    'track-ink-mute': 'var(--color-text-tertiary)',
    'track-border': 'var(--color-border)',
  },
};

// 라이트 무변화(핵심 수용 기준)의 코어 팔레트 뷰 — **manifest의 부분집합**(중복 리터럴 제거, 값은 위
// 단일 원천에서 파생). 파생 rgb() 토큰 앞의 원본 리터럴 팔레트만 골라 코어 팔레트 오타에 집중된 신호를
// 유지한다(전체 값 고정은 아래 '전체 테마 값 manifest' describe가 담당).
const LIGHT_BASELINE_KEYS = [
  'color-bg', 'color-surface', 'color-surface-hover',
  'color-primary', 'color-primary-hover', 'color-primary-subtle',
  'color-text', 'color-text-secondary', 'color-text-tertiary', 'color-text-inverse',
  'color-border', 'color-border-hover',
  'color-input-bg', 'color-input-border', 'color-input-border-hover',
  'color-selected-indicator',
  'color-error', 'color-error-bg', 'color-success', 'color-success-bg',
  'color-warning', 'color-warning-bg',
  'color-code-bg', 'color-code-text', 'color-code-block-bg',
  'color-ref-doc', 'color-ref-doc-bg', 'color-ref-issue', 'color-ref-issue-bg',
  'color-status-in-progress', 'color-status-in-progress-bg',
];
const LIGHT_BASELINE = Object.fromEntries(
  LIGHT_BASELINE_KEYS.map((k) => [k, THEME_VALUE_MANIFEST.light[k]]),
);

describe('라이트 값 무변화 — 컴파일된 :root 값이 현행 팔레트와 동일', () => {
  it('코어 30토큰 값 일치', () => {
    // I1(19R): 이전엔 raw css 정규식 + Object.fromEntries(후행 승리)로 읽어 라이트 블록의 중복·!important를
    // 못 봤다(cascade winner 미반영). 이제 shape contract가 강제된 buildLightValues(유일 선언 AST 값)로 읽는다.
    const values = buildLightValues(css);
    for (const [k, v] of Object.entries(LIGHT_BASELINE)) {
      expect(values[k], `--${k}`).toBe(v);
    }
  });
});

describe('브리지 커버리지 — _variables.scss가 참조하는 var는 전부 정의돼 있어야 한다', () => {
  // Task 5 플립 전에는 참조 0개라 공허 통과, 플립 후부터 실효.
  // _variables에 토큰이 추가되는데 _themes에 빠지면(예: warning-bg 사후 추가) 여기서 잡힌다.
  it('미정의 참조 없음', () => {
    const bridge = readFileSync(resolve(__dirname, '../styles/_variables.scss'), 'utf8');
    const refs = [...bridge.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]);
    const defined = new Set([...light, ...aliases]);
    expect([...new Set(refs)].filter((r) => !defined.has(r))).toEqual([]);
  });
});

describe('브리지 완전성 — 모든 $color-*/$shadow-* 선언이 동일명 var()여야 한다', () => {
  // 새 토큰이 리터럴로 추가되면(브리지 우회) 여기서 잡힌다 — warning-bg 사후 추가 재발 방지.
  it('리터럴 잔존 없음', () => {
    const bridge = readFileSync(resolve(__dirname, '../styles/_variables.scss'), 'utf8');
    // I1(18R): 값 비교 trim도 CSS 공백 전용 — `var(--color-x)<NBSP>`는 Sass가 NBSP를 포함한 별개
    // 문자열로 내보내 브리지가 조용히 깨지는데 JS trim은 정상으로 둔갑시켰다(같은 손실 정규화 클래스).
    const decls = [...bridge.matchAll(new RegExp(`^\\$((?:color|shadow)-[a-z0-9-]+)[${CSS_WS_CLASS}]*:[${CSS_WS_CLASS}]*([^;]+);`, 'gm'))];
    expect(decls.length).toBeGreaterThan(30);
    const bad = decls.filter((m) => cssTrim(m[2]) !== `var(--${m[1]})`)
      .map((m) => `${m[1]} = ${cssTrim(m[2])}`);
    expect(bad).toEqual([]);
  });
});

describe('사이트 SCSS의 sass 색함수 $변수 입력 금지 (컴파일 의존 재유입 차단)', () => {
  it('rgba($…)/color.adjust($…)/color.scale($…) 잔존 없음', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const files = readdirSync(stylesDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.scss') && !f.endsWith('_themes.scss'));
    const offenders = [];
    for (const f of files) {
      readFileSync(resolve(stylesDir, f), 'utf8').split('\n').forEach((line, i) => {
        const code = line.split('//')[0]; // 주석 제외
        if (/(?:rgba|color\.adjust|color\.scale)\(\s*\$/.test(code)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('전 SCSS var(--…) 참조 커버리지', () => {
  // 테마 정의 ∪ 불변 별칭 ∪ 런타임 JS 주입 ∪ S5 이행 예정(context-menu 폴백 소비)만 허용.
  const RUNTIME_INJECTED = ['branch-color', 'status-color', 'accent', 'sticky-header-h'];
  // 예외는 경로+개수까지 고정 — 번지거나 늘어나면 즉시 검출, 이관(S4/S5)하면 목록·개수 갱신 신호.
  // S4 stage 3에서 track.scss 6건 이관 완료 — 미정의 var(--text-secondary/--text-tertiary)라
  //   폴백만 렌더되고 테마를 따라가지 않던 죽은 참조였고, 정의된 --color-text-* 토큰으로 교체했다.
  //   라이트 영향은 두 갈래다: tertiary 5건은 폴백 #9ca3af → --color-text-tertiary #6B7280 로
  //   **색이 바뀌는 교정**(allow #13~#17), secondary 1건(구 1207행)은 폴백이 이미 #6b7280이라
  //   **라이트 동치**이고 다크 추종만 복구된다. 사이트별 판정은 s4Spec CONVERSIONS에 있다.
  // S5: context-menu.scss의 미정의 var 폴백 소비 2건.
  const PENDING = {
    'common/context-menu.scss': { 'color-hover': 1, 'color-border-subtle': 1 },
  };
  it('미정의 var 참조 없음 (예외는 경로·개수 고정)', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const defined = new Set([...light, ...aliases, ...RUNTIME_INJECTED]);
    const offenders = [];
    const seen = {}; // 예외 사용 실측 tally
    for (const f of readdirSync(stylesDir, { recursive: true }).map(String)
        .filter((f) => f.endsWith('.scss') && !f.endsWith('_themes.scss'))) {
      const src = readFileSync(resolve(stylesDir, f), 'utf8');
      const pendingFile = Object.keys(PENDING).find((sfx) => f.endsWith(sfx));
      for (const m of src.matchAll(/var\(--([a-z0-9-]+)/g)) {
        if (defined.has(m[1])) continue;
        if (pendingFile && PENDING[pendingFile][m[1]] != null) {
          seen[pendingFile] = seen[pendingFile] || {};
          seen[pendingFile][m[1]] = (seen[pendingFile][m[1]] || 0) + 1;
          continue;
        }
        offenders.push(`${f}: --${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(seen).toEqual(PENDING); // 개수가 줄어도(이관 완료) 알림 — 목록 갱신
  });
});

describe('track 로컬 별칭 완전성 — $track-x는 동일명 var(--track-x)', () => {
  it('별칭 잔존/오기 없음', () => {
    const src = readFileSync(resolve(__dirname, '../styles/components/track/track.scss'), 'utf8');
    const decls = [...src.matchAll(new RegExp(`^\\$track-([a-z0-9-]+)[${CSS_WS_CLASS}]*:[${CSS_WS_CLASS}]*([^;]+);`, 'gm'))];
    expect(decls.length).toBe(7);
    const bad = decls.filter((m) => cssTrim(m[2]) !== `var(--track-${m[1]})`); // I1: CSS 공백 전용 trim
    expect(bad.map((m) => `track-${m[1]} = ${cssTrim(m[2])}`)).toEqual([]);
  });
});

const scssCompileCache = new Map();
function compiledSiteCss(relPath) {
  if (!scssCompileCache.has(relPath)) {
    scssCompileCache.set(relPath, compile(resolve(__dirname, '../styles', relPath)).css);
  }
  return scssCompileCache.get(relPath);
}

// postcss Rule#selectors(list.comma 기반)로 "최상위 콤마"만 분리한다. 이전 selector.split(',')는
// 무조건 모든 콤마를 끊어 `:is(.Decoy, .Target, .Other):hover`처럼 함수형 의사클래스 **안쪽**
// 콤마까지 쪼갰다 — 그러면 ".Target" 파트가 진짜 타겟과 완전 동일 문자열로 오매치된다(외부 검수
// 실증, o시나리오: 실제로는 :is(...):hover 전체가 하나의 셀렉터라 진짜 타겟과 다름). rule.selectors는
// postcss 자체 셀렉터 리스트 파서라 괄호 안 콤마를 보존해 이 오매치를 구조적으로 막는다.
// 각 파트는 공백 정규화 후 완전 동일 문자열로만 비교한다 — 부분/접두 매칭·의사클래스 연속
// (`:hover` 등)·자손 결합자 전부 불허(`SELECTOR:hover` != `SELECTOR`).
// I1(18R) — 공백 정규화를 CSS 공백 5종 전용으로 교체하고, 그 위에 파서-레벨 손실까지 막는 가드를 둔다.
// postcss `rule.selectors`는 내부적으로 각 콤마 파트에 **JS trim**을 걸어 NBSP/EM SPACE/ZWNBSP/VT를
// 경계에서 지운다 — 즉 `.X<NBSP>`가 `.X`로 도착한다. 정규화 함수만 고쳐도 이 손실은 남으므로,
// 셀렉터 원문에 CSS-비공백 JS-공백 코드포인트가 하나라도 있으면 매칭 자체를 거부한다(fail-closed).
function selectorMatches(rule, targetSelectors) {
  if (JS_ONLY_WS_RE.test(rule.selector)) return false;
  const targets = new Set(Array.isArray(targetSelectors) ? targetSelectors : [targetSelectors]);
  return rule.selectors.some((part) => targets.has(normalizeCssWhitespace(part)));
}

// target 셀렉터를 가진 "root 직속" 규칙만 postcss AST로 찾는다. rule.parent.type이 'root'가
// 아니면(즉 @media/@supports 등 안쪽이면) 애초에 후보에서 제외 — 외부 검수가 실증한 "@media 안
// 두 번째 이후 규칙이 최상위처럼 추출됨" 구멍을 이 한 줄이 구조적으로 닫는다. 매치가 0건이면
// "셀렉터 자체가 사라짐(@media 이동 포함)"과 "선언 불일치"를 구분해 호출부가 각각 다르게 보고한다.
// 동일 셀렉터로 반복되는 규칙(예: 승격핀 뒤에 다시 나오는 override 블록)은 전부 배열에 담아
// 반환한다 — 최종 유효값 판정(effectiveValue)이 문서 순서 그대로 cascade를 재현하려면 규칙
// 하나만 골라선 안 되고 매치되는 규칙 전부가 필요하다.
function findRootRules(root, targetSelectors) {
  const rules = [];
  root.walkRules((rule) => {
    if (rule.parent.type === 'root' && selectorMatches(rule, targetSelectors)) rules.push(rule);
  });
  return rules;
}

// 일치 규칙들(문서 순서)을 walkDecls로 훑어 prop별 "최종 유효 선언 하나"를 CSS cascade 규칙대로
// 합성하는 공용 리듀서. !important는 non-important를 무조건 이기고, 같은 중요도끼리는 후행이 이긴다
// (custom property도 일반 프로퍼티와 동일한 cascade 규칙을 따른다 — `--x: A !important; --x: B;`의
// 계산값은 여전히 A. 외부 검수 7라운드째 실증: darkValues가 이 규칙 없이 "무조건 후행 승리"만 쓰던
// 시절엔 `--color-selected-indicator: rgba(107,114,128,0) !important;` 뒤에 `#6B7280;`이 오는
// 케이스에서 브라우저는 투명인데 테스트는 #6B7280을 읽어 false-green을 냈다). predicate로 대상
// decl만 골라 effectiveValue(prop 화이트리스트)와 darkValues 수집(전체 --커스텀 프로퍼티) 양쪽이
// 이 로직을 공유한다 — 로직 중복·drift 방지. 반환값은 `{ [prop]: { value, important } }`.
//
// prop 정규화(Minor 2, 8라운드 외부 검수 실증) — 표준 CSS 프로퍼티명은 스펙상 ASCII
// case-insensitive라 `BORDER: none;` 뒤에 오는 `border: 1px solid red;`는 같은 프로퍼티의 후행
// 재정의여야 한다. 정규화 없이 decl.prop을 그대로 키로 쓰면 대소문자만 다른 두 선언이 서로 다른
// state 엔트리로 남아 override를 놓친다. 커스텀 프로퍼티(`--`로 시작)는 스펙상 case-sensitive이므로
// 그대로 보존한다(`--Foo`와 `--foo`는 별개 토큰). predicate는 (decl, normalizedProp) 둘 다 받는다 —
// 화이트리스트 비교(effectiveValue)도 정규화된 prop 기준이어야 대소문자 변형을 놓치지 않는다.
// 12R F5(내부 리뷰 실증, 12라운드 리뷰 실증분) — decodeCssIdentifier를 먼저 통과시킨 뒤 기존 로직을
// 적용한다. 이전엔 원문 decl.prop을 그대로 판정해 escaped 선언(`\--color-x`, `\42order` 등)이 cascade
// predicate·state 키·BORDER_PROP_RE 매칭에서 전부 미매치로 실종됐다(hasProtectedPrefix만 자체
// 디코딩해 이 구멍 밖이었다). decodeCssIdentifier는 이 파일 내 유일한 decode 지점으로 normalizeProp
// 진입부에 단일화돼 있다 — hasProtectedPrefix는 별도 입력(raw decl.prop)에 독립 호출하므로 이중
// 디코딩 경로가 아니다(멱등성은 아래 12R F5 synthetic이 직접 단정).
function normalizeProp(prop) {
  const decoded = decodeCssIdentifier(prop);
  return decoded.startsWith('--') ? decoded : decoded.toLowerCase();
}
function reduceEffectiveDecls(rules, predicate) {
  const state = {};
  rules.forEach((rule) => {
    rule.walkDecls((decl) => {
      const prop = normalizeProp(decl.prop);
      if (!predicate(decl, prop)) return;
      const cur = state[prop];
      if (cur && cur.important && !decl.important) return; // important가 후행 non-important를 이김
      // I1(18R): JS trim은 NBSP 등 CSS ident 문자를 값 경계에서 지워 `#6B7280<NBSP>`(브라우저에선
      // 무효 → 토큰 미적용)를 정상 hex로 둔갑시켰다 — CSS 공백 전용 trim으로 교체(fail-closed).
      state[prop] = { value: cssTrim(decl.value), important: !!decl.important };
    });
  });
  return state;
}

// 이전의 "일치 규칙 전체를 some()으로 훑어 하나라도 있으면 통과"식 판정은 뒤에 오는 override(승격핀
// 뒤 동일 selector의 `border: none`, indicator핀 뒤 `box-shadow: none` 등)를 놓치고 stale 값으로
// GREEN 처리했다(외부 검수 실증, l시나리오). 호출부는 "최종값 하나"만 검사해야 하며(some() 폐기),
// 여기 없는 prop은 그 selector 조합에서 한 번도 선언되지 않았다는 뜻이다.
function effectiveValue(rules, props) {
  return reduceEffectiveDecls(rules, (decl, prop) => props.has(prop));
}

// ─────────────────────────────────────────────────────────────────────────────
// 17R 아키텍처 전환 — **브라우저 시뮬레이터 → canonical 구조 게이트**(2층)
//
// 왜 전환하는가(외부 검수 진단, 전면 수용): 16라운드까지 이 파일은 CSS value grammar·deferred
// validation·shorthand cascade·!important·invalid-declaration fallback을 **자체 구현**하고 그 모델을
// **정답 판정기(oracle)** 로 삼았다. 그래서 모델이 틀려도 319개가 서로 일관되게 GREEN이 될 수 있었다 —
// 매 라운드 새 false-green이 나온 진짜 원인이다(env(--x)·if()·hypot·-webkit-link·RGB(1 2 3 4)·
// RGB(foo(1) 2 3)·color-mix 구분자 오용 전부 우회 실증). 15·16R의 "근본 대책"(whitelist 반전·fuzz)도
// 같은 모델 **안에서의** 반전이라 같은 방식으로 뚫렸다.
//
// 결론: 게이트가 브라우저를 흉내 내는 일을 중단한다.
//   · 층 1(구조 게이트) — PINNED selector의 **relevant 선언**(border 계열·border-image 계열·box-shadow·
//     all)은 **CANONICAL_DECLS와 구조적으로 정확히 일치할 때만** 통과한다. 그 외 모든 형태는 유효/무효/
//     미지를 **추론하지 않고 무조건 RED**. `env(--x)`든 `hypot()`든 `RGB(1 2 3 4)`든 canonical이 아니면
//     RED — 이 층에는 CSS 유효성 판단 코드 경로가 **존재하지 않는다**.
//   · 층 2(제한 evaluator) — 층 1을 통과한 canonical 선언 + CSS-wide 키워드(initial/unset/inherit/
//     revert/revert-layer)·`all`만 계산한다. **무효 CSS를 폐기하고 이전 핀을 살리는 fallback 동작은
//     제거**했다(정적 회귀 게이트에서 non-canonical CSS는 그 자체로 실패다) — "이전 유효 선언 부활"
//     클래스가 소멸한다.
//
// 결과(문구 축소, 18R): 이 게이트가 보장하는 것은 **"exact selector + 정적 styles 인벤토리 범위
// 내에서" canonical 외 전부 RED로 수렴한다**는 것뿐이다. 17R 주석의 "false-green이 원리적으로
// 불가능"은 과대 주장이었다 — 18R 선재현이 그 주석 아래에서 손실 정규화(I1)·과대 허용(I2)·이름
// 비대칭(I3)·inventory 누락(I4) 네 부류의 false-green을 실측했다. **범위 밖 = 명시 예외**이며
// 전수는 아래 "명시 예외 전수" describe가 단정과 함께 고정한다:
//   ① 셀렉터 동치성(`.a.b` 대 `.b.a`, `:is()` 표기 변형) — selector 의미론 모델 없음
//   ② 타 셀렉터·타 파일에서 오는 cascade(더 높은 specificity의 override)
//   ③ 로컬 custom property 재정의 — 핀 게이트 단독으론 GREEN, P4 보호 네임스페이스 스윕과의 **합성**에 의존
//   ④ JS 런타임 `CSS.registerProperty()` — 정적 styles 인벤토리 밖(@property at-rule은 I4로 폐쇄됨)
// false-RED는 늘지만 회귀 게이트로선 올바른 방향이다 — 실제 코드가 canonical을 벗어나면 개발자가
// 알아야 한다. 수렴 선언은 하지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

// 층 1 원자 — 전부 "정확한 리터럴 형태"만 인정하는 anchored whitelist. 부분 매칭·문자열 분해가 없으므로
// (전체 값 하나를 anchored 정규식으로 판정) 토크나이저 재구현이 필요 없고 우회할 틈도 없다.
//   · 길이: `0`(단위 없는 0) 또는 소수 포함 양수 + px|rem|em. 핀 실측은 `0`과 `1px`뿐 — 그 밖의 단위
//     (lh·dvw·cqw…)·부호·계산식(calc/min/clamp)·백분율은 전부 **비-canonical(RED)** 이다.
//   · 토큰 참조: 정확히 `var(--name)`. fallback(`var(--x, #ccc)`)·대문자 `VAR()`·escape·내부 공백은
//     전부 비-canonical(RED) — 값 쪽 escape 디코더·<dashed-ident> 모델이 통째로 불필요해진다.
//   · 스타일: 가시 border-style 키워드만. `none`/`hidden`은 의도적으로 canonical 밖(RED)이다.
const CANON_VISIBLE_BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'];
const CANON_LEN_SRC = '(?:0|[0-9]+(?:\\.[0-9]+)?(?:px|rem|em))';
const CANON_STYLE_SRC = `(?:${CANON_VISIBLE_BORDER_STYLES.join('|')})`;
// **needle 파서 전용** 매처(판정기 아님) — PINNED 표의 `needle: 'var(--token)'` 문자열에서 토큰 이름을
// 뽑는 데만 쓴다. 선언 값이 canonical인지 여부는 오직 CANONICAL_DECLS.re가 결정한다.
const CANON_VAR_REF_RE = /^var\(--([a-z0-9-]+)\)$/;

// ─── I2(18R) — box-shadow canonical을 **실측 전체 문자열**로 좁힌다 ─────────────────────────────
// 이전 형태는 opaque layer를 `var(--<아무 이름>)`으로, 전체 값을 "canonical 레이어의 임의 콤마 나열"로
// 허용하고, 최종 판정은 "기대 inset layer 하나 존재"만 봤다. 그 결과 참조 토큰의 **의미가 전혀
// 검증되지 않았다**(선재현 실측, 현행 HEAD):
//   · `var(--does-not-exist), inset 0 0 0 1px var(--color-selected-indicator)` → visible=true
//     (브라우저는 첫 레이어가 무효라 **선언 전체를 폐기** — 실렌더 box-shadow: none)
//   · `var(--shadow-md), inset …` → visible=true (핀이 쓰지 않는 토큰인데 통과)
//   · `_themes.scss`에서 `--shadow-xs: none`으로 바꾸면 실 CSS가 `none, inset …` = **계산값 none**인데
//     선언 문자열은 그대로라 296/296 GREEN
// 처방은 문법 모델 추가가 **아니라** 실측값으로 좁히기다. 넓은 패턴을 하나라도 남기면 whitelist가
// 다시 작은 CSS 문법이 되고, 그 문법의 오차가 곧 다음 라운드의 false-green이 된다.
//   · 허용 opaque layer: 정확히 `var(--shadow-xs)` 하나
//   · 허용 indicator layer: 정확히 `inset 0 0 0 1px var(--color-selected-indicator)` 하나
//   · 허용 전체 값: 위 두 레이어로 만들어지는 **실핀 2가지 전체 문자열**뿐(레이어 조합·순서 포함)
// `var(--shadow-xs)`가 opaque layer로 성립한다는 전제(=완전 그림자로 확장되는 유효 값)는 아래
// "--shadow-xs exact baseline" describe가 라이트·다크 값 자체를 고정해 지킨다 — 토큰 값이 `none`
// 이나 무효 값으로 바뀌면 그 describe가 RED가 된다.
const CANON_SHADOW_OPAQUE_LAYER = 'var(--shadow-xs)';
const CANON_SHADOW_INDICATOR_LAYER = 'inset 0 0 0 1px var(--color-selected-indicator)';
const CANON_SHADOW_VALUES = [
  CANON_SHADOW_INDICATOR_LAYER,                                          // .MyTasks__ScopeBtn--active
  `${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`,       // .HomeTabs__Tab.is-on
];
// 실측 값에 대응하는 레이어 모델(층 2 가시성 계산 입력). 상수이므로 매번 사본을 낸다.
const SHADOW_OPAQUE_LAYER_MODEL = () => ({ kind: 'opaque-var', token: 'shadow-xs' });
const SHADOW_INDICATOR_LAYER_MODEL = () =>
  ({ kind: 'inset', offsetX: 0, offsetY: 0, blur: 0, spread: 1, token: 'color-selected-indicator' });
// 리터럴 전체 문자열 → anchored exact 정규식(정규식 메타문자 이스케이프). 패턴 확장 여지 0.
const exactValueRe = (literal) => new RegExp(`^${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

// CANONICAL_DECLS — **핀 8곳의 실제 컴파일 값에서 도출**한 canonical 형태 집합이자 층 1의 **유일한
// 판정 테이블**이다. M1(18R): 이전엔 classifyRelevantDecl()이 이 배열을 조회하지 않고 별도 regex를
// 썼기 때문에 entry의 prop/re를 망가뜨려도 결과가 그대로였다 — 즉 "single source"라는 주석이 사실이
// 아니었다. 이제 classifier가 이 배열을 직접 dispatch한다(아래 mutation 테스트가 그 단일화를 증명).
// 각 항목의 `pins`가 도출 근거이고, 아래 "CANONICAL_DECLS 도출 근거 고정" describe가 실파일로 재검증한다.
// 여기 없는 형태는 전부 비-canonical이며 게이트는 그 유효성을 **판단하지 않는다**.
const CANONICAL_DECLS = [
  {
    id: 'border-shorthand',
    level: 'value', // 선언 값 전체가 이 형태여야 한다
    prop: 'border',
    form: 'border: <length> <visible-style> var(--<token>)',
    re: new RegExp(`^(${CANON_LEN_SRC}) (${CANON_STYLE_SRC}) var\\(--([a-z0-9-]+)\\)$`),
    build: (m) => ({ form: 'border', border: { width: parseFloat(m[1]), style: m[2], token: m[3] } }),
    // 근거(실측 컴파일 값, 전부 `1px solid var(--color-input-border)`). 색 자리 토큰은 층 2가
    // contract.token과 대조하므로(=핀별 기대 토큰) 임의 토큰이 통과하지 않는다.
    pins: ['.CanvasEditor', '.CanvasEditorToolbar__ColorSwatch', '.FilterBuilder__OpToggle',
      '.MyTasks__ScopeToggle', '.HomeTabs', '.BrowseBranches__JoinBtn--joined'],
  },
  {
    id: 'box-shadow-indicator-only',
    level: 'value',
    prop: 'box-shadow',
    form: CANON_SHADOW_VALUES[0], // 실측 전체 문자열(패턴 아님)
    re: exactValueRe(CANON_SHADOW_VALUES[0]),
    build: () => ({ form: 'box-shadow', layers: [SHADOW_INDICATOR_LAYER_MODEL()] }),
    pins: ['.MyTasks__ScopeBtn--active'],
  },
  {
    id: 'box-shadow-opaque-then-indicator',
    level: 'value',
    prop: 'box-shadow',
    form: CANON_SHADOW_VALUES[1], // 실측 전체 문자열(레이어 조합·순서 포함)
    re: exactValueRe(CANON_SHADOW_VALUES[1]),
    build: () => ({ form: 'box-shadow', layers: [SHADOW_OPAQUE_LAYER_MODEL(), SHADOW_INDICATOR_LAYER_MODEL()] }),
    pins: ['.HomeTabs__Tab.is-on'],
  },
];

// CSS-wide 키워드 — 층 2가 계산하는 유일한 non-canonical-form 입력. 정확히 소문자 단독일 때만 인정한다
// (명시 예외: `INITIAL` 같은 대문자 변형은 스펙상 유효하지만 여기선 비-canonical=RED로 fail-closed).
const CANON_CSS_WIDE_RE = /^(?:initial|inherit|unset|revert|revert-layer)$/;
const MODELED_RESET_KEYWORDS = new Set(['initial', 'unset']); // 비상속 속성이라 두 키워드는 동치
const BORDER_IMAGE_PROP_RE = /^border-image(?:-(?:source|slice|width|outset|repeat))?$/;

// relevant 선언 판정 — **프로퍼티 이름만** 본다(값 유효성 추론 없음). border로 시작하는 프로퍼티는
// 경계 무관이 확실한 것(radius/collapse/spacing)만 제외하고 전부 relevant다 — 논리 프로퍼티
// (border-inline-*/border-block-*)·border-image 계열·미지의 `border-*` 신설 프로퍼티까지 자동으로
// relevant에 들어와 canonical이 아니면 RED가 된다(15R "논리 프로퍼티 fail-closed" 계약의 일반화).
//
// 벤더 프리픽스 정규화(내부 리뷰 실증, 17R 이후) — 진입부에서 먼저 `-webkit-`/`-moz-`/`-ms-`/`-o-` 등
// (`/^-[a-z]+-/`)을 벗긴 뒤 판정한다. 벗기기 전엔 `-webkit-border-image`/`-webkit-box-shadow` 같은
// alias가 `prop.startsWith('border')`/`=== 'box-shadow'`에 안 걸려 relevant 밖으로 새 나갔다 —
// **층 1 자체가 무력화되는 수집 누락**(선언을 relevant로 못 보면 canonical 판정이 실행되지 않아
// 항상 GREEN). 커스텀 프로퍼티(`--foo`)는 두 번째 문자가 `-`라 `/^-[a-z]+-/`에 애초에 안 걸려 안전
// (deprefix 무영향). 호출부는 normalizeProp(decode → lowercase)을 먼저 거친 prop을 넘기므로 파이프라인
// 순서는 decode → lowercase → deprefix. 15R의 동명 아이디어(함수명용 VENDOR_PREFIX_RE/unprefixedFn,
// <image> 문법 판정용)가 17R 삭제분에 함께 사라졌던 것과 별개로, 여기는 **프로퍼티 이름**용이다.
const IRRELEVANT_BORDER_PROP_RE = /^border-(?:collapse|spacing)$|-radius$/;
const PROP_VENDOR_PREFIX_RE = /^-[a-z]+-/;
function isRelevantProp(prop) {
  const deprefixed = prop.replace(PROP_VENDOR_PREFIX_RE, '');
  if (deprefixed === 'box-shadow' || deprefixed === 'all') return true;
  if (!deprefixed.startsWith('border')) return false;
  return !IRRELEVANT_BORDER_PROP_RE.test(deprefixed);
}

// 값 정규화 — **CSS 공백**(5종) 축약/trim만 한다(소문자화·escape 디코딩·토큰 분해 전부 없음). 대소문자와
// escape가 canonical 판정에 그대로 노출되므로 `VAR(--x)`·`tr\61 nsparent` 류는 자동으로 RED다.
// I1(18R): 이전엔 JS `\s`/`trim()`이라 NBSP·EM SPACE·ZWNBSP·VT를 ASCII space로 **바꿔서** 통과시켰다.
function normalizeDeclValue(value) {
  return normalizeCssWhitespace(value);
}

// box-shadow canonical 값 → 레이어 모델 배열. 판정은 classifyRelevantDecl(=CANONICAL_DECLS dispatch)
// 하나로 단일화돼 있으므로 여기서 별도 분해·별도 정규식을 두지 않는다(M1: 판정 경로 이중화 금지).
function canonicalShadowLayers(value) {
  const cls = classifyRelevantDecl('box-shadow', value);
  return cls.syntax === 'canonical' && cls.form === 'box-shadow' ? cls.layers : null;
}

// 층 1 판정기 — relevant 선언 하나를 `canonical`(+form) 또는 `non-canonical`로 **이분**한다.
// 상태 모델(층 2 내부에서만 의미를 갖는다): syntax = canonical | non-canonical.
// non-canonical은 어느 분기에서든 RED이고 **어떤 부작용도 내지 않는다**(border-image reset 금지 포함 —
// 검수 finding 3의 `border: RGB(foo(1) 2 3)` 케이스가 이걸로 닫힌다).
//
// I3(18R) — **벤더 프리픽스 relevant 선언은 무조건 non-canonical**. 이전엔 isRelevantProp()만 deprefix해
// 수집하고 classifier에는 raw `-webkit-box-shadow`가 전달돼 **이름 비대칭**이 생겼다: `initial`/`unset`이
// CSS-wide canonical로 인정된 뒤 `prop === 'box-shadow'`에 미매치 → 마지막 분기에서 shadow가 아닌
// **border 셀을 초기화**해, 인디케이터 핀은 기존 shadow가 그대로 남아 GREEN이었다(선재현 실측:
// `-webkit-box-shadow: initial !important`·`-webkit-box-shadow: unset` 둘 다 visible=true).
// 실핀이 쓰지 않는 형태이므로 alias 의미를 계산할 이유가 없다 — 존재 자체를 RED로 접는다(fail-closed).
// M1(18R) — 아래 루프가 CANONICAL_DECLS를 **직접** dispatch하는 유일 판정 경로다. 배열 entry의
// prop/re를 훼손하면 판정 결과가 즉시 달라진다(= 배열이 진짜 single source임을 mutation으로 증명 가능).
function classifyRelevantDecl(prop, rawValue) {
  const value = normalizeDeclValue(rawValue);
  if (PROP_VENDOR_PREFIX_RE.test(prop)) return { syntax: 'non-canonical', prop, value };
  if (CANON_CSS_WIDE_RE.test(value)) return { syntax: 'canonical', form: 'css-wide', keyword: value, value };
  for (const entry of CANONICAL_DECLS) {
    if (entry.prop !== prop) continue;
    const m = entry.re.exec(value);
    if (m) return { syntax: 'canonical', id: entry.id, value, ...entry.build(m) };
  }
  return { syntax: 'non-canonical', prop, value };
}

// PINNED selector 규칙 수집. root 직속 규칙만 cascade에 참여시키고, **조건부 문맥(@media/@supports 등)
// 안의 동일 selector 규칙**은 별도로 반환한다 — 이전 구조는 이들을 조용히 무시했다(모델 불가를
// "없는 것"으로 취급 = 수집 누락 구멍). 이제 그 안에 relevant 선언이 하나라도 있으면 fail-closed RED다.
function collectPinnedRules(root, targetSelectors) {
  const rootRules = [];
  const conditionalRules = [];
  root.walkRules((rule) => {
    if (!selectorMatches(rule, targetSelectors)) return;
    (rule.parent.type === 'root' ? rootRules : conditionalRules).push(rule);
  });
  return { rootRules, conditionalRules };
}

// ─────────────────────────────────────────────────────────────────────────────
// 층 2 — 제한된 cascade evaluator. 다루는 입력은 canonical 선언 + CSS-wide 키워드·`all`뿐이라 범위가
// 극적으로 축소됐다. 모델링 대상은 선언 순서·!important·(canonical 폼 사이의) 도메인 관계뿐이다.
// **무효 CSS fallback(이전 핀 부활) 동작은 없다** — non-canonical이 하나라도 있으면 그 자체가 실패다.
// ─────────────────────────────────────────────────────────────────────────────
function evaluateCanonicalContract(rootRules, conditionalRules, contract) {
  const nonCanonical = [];
  const unmodelable = [];
  const border = { model: null, important: false }; // model=null → border initial(비가시)
  const shadow = { model: null, important: false }; // model=null → box-shadow initial(none)
  const applyCell = (cell, model, important) => {
    if (cell.important && !important) return; // important가 후행 non-important를 이김
    cell.model = model;
    cell.important = important;
  };

  conditionalRules.forEach((rule) => {
    rule.walkDecls((decl) => {
      if (!isRelevantProp(normalizeProp(decl.prop))) return;
      // 조건부 적용(뷰포트·기능 질의)은 정적 게이트가 계산할 수 없다 → 모델 불가로 표면화.
      unmodelable.push(`조건부 문맥 ${describeLocation(rule)} { ${decl.prop}: ${normalizeDeclValue(decl.value)} }`);
    });
  });

  rootRules.forEach((rule) => {
    rule.walkDecls((decl) => {
      const prop = normalizeProp(decl.prop); // escaped 식별자(\42order 등)는 여기서 실이름으로 복원된다
      if (!isRelevantProp(prop)) return;
      const cls = classifyRelevantDecl(prop, decl.value);
      const important = !!decl.important;
      if (cls.syntax === 'non-canonical') {
        nonCanonical.push(`${decl.prop}: ${cls.value}${important ? ' !important' : ''}`);
        return; // 부작용 금지 — 리셋도 설정도 하지 않는다
      }
      if (cls.form === 'border') { applyCell(border, cls.border, important); return; }
      if (cls.form === 'box-shadow') { applyCell(shadow, cls.layers, important); return; }
      // css-wide
      if (!MODELED_RESET_KEYWORDS.has(cls.keyword)) {
        unmodelable.push(`${decl.prop}: ${cls.keyword}`); // inherit/revert/revert-layer — 모델 불가(sticky)
        return;
      }
      if (prop === 'all') { applyCell(border, null, important); applyCell(shadow, null, important); return; }
      if (prop === 'box-shadow') { applyCell(shadow, null, important); return; }
      if (BORDER_IMAGE_PROP_RE.test(prop)) return; // border-image initial/unset = 도장 없음(경계 계약 무영향)
      applyCell(border, null, important); // 그 밖 border 계열 initial/unset
    });
  });

  const blocked = nonCanonical.length > 0 || unmodelable.length > 0;
  if (contract.kind === 'indicator') {
    const layers = shadow.model;
    const layer = layers ? layers.find((l) => l.kind === 'inset' && l.token === contract.token && l.spread > 0) : null;
    return { visible: !blocked && !!layer, nonCanonical, unmodelable, layers, layer };
  }
  const m = border.model;
  const visible = !blocked && !!m && m.width > 0 && m.token === contract.token;
  return { visible, nonCanonical, unmodelable, border: m };
}

// PINNED 본문과 모든 mutation synthetic이 통과하는 **단일 진입점**(계약 유지 — 13R I5).
function evaluatePinnedContract(cssText, selector, contract) {
  const root = postcss.parse(cssText);
  const { rootRules, conditionalRules } = collectPinnedRules(root, selector);
  if (rootRules.length === 0 && conditionalRules.length === 0) {
    return { visible: false, rulesFound: 0, reason: `${selector} 규칙(셀렉터 완전일치) 미발견` };
  }
  return { rulesFound: rootRules.length, ...evaluateCanonicalContract(rootRules, conditionalRules, contract) };
}
// synthetic 진입점 — SCSS는 PINNED과 동일하게 Sass compile을 거치고, Sass가 선-거부/선-접기 하는
// 벡터(명시 예외)는 raw CSS를 직접 태운다(P4 스윕이 raw .css도 훑으므로 실제 입력 경로다).
const evalBorderScss = (scss, token = 'color-input-border') =>
  evaluatePinnedContract(compileString(scss).css, '.X', { kind: 'border', token });
const evalIndicatorScss = (scss, token) =>
  evaluatePinnedContract(compileString(scss).css, '.X', { kind: 'indicator', token });
const evalBorderCss = (cssText, token = 'color-input-border') =>
  evaluatePinnedContract(cssText, '.X', { kind: 'border', token });
const evalIndicatorCss = (cssText, token) =>
  evaluatePinnedContract(cssText, '.X', { kind: 'indicator', token });
// needle(`var(--token)`)을 토큰명으로 바꾼다 — 별도 파서 없이 CANON_VAR_REF_RE 하나만 쓴다.
// ⚠️ 이 매처는 **needle 파싱 전용**이며 canonical 판정에는 관여하지 않는다(I2: 선언 값 쪽 opaque
// layer는 `var(--shadow-xs)` 정확일치뿐 — 여기의 일반형 `var(--name)`과 혼동 금지).
function canonicalNeedleToken(needle) {
  const m = CANON_VAR_REF_RE.exec(normalizeDeclValue(needle));
  if (!m) throw new Error(`PINNED needle이 canonical var(--token) 형태가 아님: ${needle}`);
  return m[1];
}

describe('컨트롤 보더/인디케이터 재분류 고정 — canonical 구조 게이트 (17R 아키텍처 전환)', () => {
  // 가변 fill 등으로 보더가 유일한 형상 단서인 컨트롤들 — 전수 재감사(2026-07-15)에서 승격 확정.
  // 대표: canvasEditor ColorSwatch(검정 프리셋이 다크 bg 대비 1.1:1이라 보더 없으면 소실).
  //
  // 6~16라운드에 걸쳐 이 핀 파이프라인이 닫아 온 우회들은 **이제 전부 층 1이 구조적으로 흡수**한다
  // (개별 grammar 판정을 없애고 "canonical이 아니면 RED"로 수렴시켰기 때문). 기록 목적의 대응표:
  //  ① `/* border: … */` 블록주석 — postcss Comment 노드라 walkDecls 미방문(유지).
  //  ② `--dead-border`/`border-radius`/`content:"border:…"` — isRelevantProp의 프로퍼티 이름 판정에서
  //     제외(값 유효성 추론 없음). 반대로 `border-*` 신설/논리 프로퍼티는 relevant로 들어와 RED가 된다.
  //  ③ `:hover`에만 남김 — selectorMatches의 완전 동일 문자열 비교(유지).
  //  ④ `@media` 안 규칙 — 이전엔 조용히 **무시**됐다(수집 누락). 이제 collectPinnedRules가 조건부 문맥
  //     규칙을 따로 모아 relevant 선언이 있으면 모델 불가(fail-closed RED)로 표면화한다.
  //  ⑤ 후행 override(`border:none`·`box-shadow:none`) — 층 2 cascade가 최종 셀 하나만 본다. 게다가
  //     `none`은 canonical이 아니므로 그 선언의 존재 자체가 RED다.
  //  ⑥ fallback 안 토큰 텍스트(`var(--a, var(--b))`) — canonical `var(--name)`은 fallback을 불허(RED).
  //  ⑦⑧⑨ 가시성(spread 0·width 0·style 없음·네 면 소실·calc width) — 층 2가 canonical 모델에서
  //     width>0 / spread>0 / 토큰 일치를 직접 계산하고, 그 밖의 형태는 애초에 canonical이 아니다.
  const PINNED = [
    { label: 'canvasEditor .CanvasEditor', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditor', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'canvasEditor ColorSwatch(Toolbar)', file: 'components/canvas/canvasEditor.scss', selector: '.CanvasEditorToolbar__ColorSwatch', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'taskList FilterBuilder OpToggle', file: 'components/branch/taskList.scss', selector: '.FilterBuilder__OpToggle', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'myTasks ScopeToggle', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeToggle', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'home-shared HomeTabs', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs', kind: 'border', needle: 'var(--color-input-border)' },
    { label: 'browseBranches JoinBtn--joined', file: 'components/browse/browseBranches.scss', selector: '.BrowseBranches__JoinBtn--joined', kind: 'border', needle: 'var(--color-input-border)' },
    // 선택 상태 인디케이터(수정 1, SC 1.4.11) — active 셀렉터가 토큰을 실제로 소비하는지만 여기서 고정.
    // 다크 값 자체의 시맨틱(투명 회귀 방지)은 아래 별도 describe에서 대비비로 고정한다.
    { label: 'home-shared HomeTabs__Tab.is-on', file: 'components/home/shared/home-shared.scss', selector: '.HomeTabs__Tab.is-on', kind: 'indicator', needle: 'var(--color-selected-indicator)' },
    { label: 'myTasks ScopeBtn--active', file: 'components/myTasks/myTasks.scss', selector: '.MyTasks__ScopeBtn--active', kind: 'indicator', needle: 'var(--color-selected-indicator)' },
  ];
  it.each(PINNED)('$label 의 relevant 선언이 전부 canonical이고 기대 토큰이 시각적으로 유효하다', ({ file, selector, kind, needle }) => {
    const expectedToken = canonicalNeedleToken(needle);
    const res = evaluatePinnedContract(compiledSiteCss(file), selector, { kind, token: expectedToken });
    expect(res.rulesFound, `${selector} 규칙(root 직속·셀렉터 완전일치)을 컴파일된 ${file}에서 찾지 못함`).toBeGreaterThan(0);
    expect(
      res.visible,
      `${selector} ${kind} 계약 위반(기대 토큰 "${expectedToken}") — ${JSON.stringify(res)}`,
    ).toBe(true);
  });

  // CANONICAL_DECLS의 **도출 근거**를 실파일로 재검증한다 — 상수의 pins 목록이 실제 컴파일 값과
  // 어긋나면(핀이 canonical을 벗어나거나 상수가 낡으면) 여기서 즉시 드러난다.
  it('CANONICAL_DECLS 도출 근거 고정 — 핀 8곳의 relevant 선언이 전부 canonical로 분류된다', () => {
    const seen = [];
    for (const { selector, file } of PINNED) {
      const root = postcss.parse(compiledSiteCss(file));
      const { rootRules, conditionalRules } = collectPinnedRules(root, selector);
      expect(conditionalRules, `${selector}: 조건부 문맥(@media 등) 규칙이 새로 생김 — 모델 불가`).toEqual([]);
      rootRules.forEach((rule) => rule.walkDecls((decl) => {
        const prop = normalizeProp(decl.prop);
        if (!isRelevantProp(prop)) return;
        const cls = classifyRelevantDecl(prop, decl.value);
        expect(cls.syntax, `${selector} { ${decl.prop}: ${decl.value} }`).toBe('canonical');
        seen.push(`${selector}|${decl.prop}: ${cls.value}`);
      }));
    }
    // 실측 고정(도출 근거 스냅샷): border 핀 6곳 + 인디케이터 핀 2곳 = relevant 선언 정확히 8개.
    expect(seen).toEqual([
      '.CanvasEditor|border: 1px solid var(--color-input-border)',
      '.CanvasEditorToolbar__ColorSwatch|border: 1px solid var(--color-input-border)',
      '.FilterBuilder__OpToggle|border: 1px solid var(--color-input-border)',
      '.MyTasks__ScopeToggle|border: 1px solid var(--color-input-border)',
      '.HomeTabs|border: 1px solid var(--color-input-border)',
      '.BrowseBranches__JoinBtn--joined|border: 1px solid var(--color-input-border)',
      '.HomeTabs__Tab.is-on|box-shadow: var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)',
      '.MyTasks__ScopeBtn--active|box-shadow: inset 0 0 0 1px var(--color-selected-indicator)',
    ]);
  });

  it('CANONICAL_DECLS 항목별 근거(pins)가 비어 있지 않다 — 근거 없는 canonical 확장 금지', () => {
    expect(CANONICAL_DECLS).toHaveLength(3);
    for (const entry of CANONICAL_DECLS) {
      expect(entry.pins.length, entry.id).toBeGreaterThan(0);
      expect(typeof entry.form, entry.id).toBe('string');
    }
  });

  // M3(19R) — pins를 분류 결과에 **연결**한다(제거 대신 load-bearing화). 이전엔 pins가 순수 메타데이터라
  // 두 shadow entry의 pins를 서로 바꿔도 372 통과했다(=기능 없는 주석). 이제 각 핀 셀렉터의 relevant
  // 선언을 실제로 분류해 얻은 cls.id로 {id → [selector]} 맵을 역구성하고, CANONICAL_DECLS[].pins가 그것과
  // 정확히 일치함을 단정한다 — pins를 swap하면 여기서 RED가 난다.
  it('M3(19R): CANONICAL_DECLS[].pins ↔ 실제 분류 결과 정합 (핀 셀렉터의 cls.id = 그 셀렉터를 담은 entry.id, swap 시 RED)', () => {
    const selectorToId = {};
    for (const { selector, file } of PINNED) {
      const root = postcss.parse(compiledSiteCss(file));
      const { rootRules } = collectPinnedRules(root, selector);
      const ids = [];
      rootRules.forEach((rule) => rule.walkDecls((decl) => {
        const prop = normalizeProp(decl.prop);
        if (!isRelevantProp(prop)) return;
        const cls = classifyRelevantDecl(prop, decl.value);
        expect(cls.syntax, `${selector} { ${decl.prop}: ${decl.value} }`).toBe('canonical');
        ids.push(cls.id);
      }));
      expect(ids, `${selector}: relevant 선언 정확히 1개(도출 근거 describe가 보장)`).toHaveLength(1);
      selectorToId[selector] = ids[0];
    }
    // 분류 실측 → {id: [정렬된 selector]} 역구성
    const pinsFromClassification = {};
    for (const [selector, id] of Object.entries(selectorToId)) (pinsFromClassification[id] ||= []).push(selector);
    for (const id of Object.keys(pinsFromClassification)) pinsFromClassification[id].sort();
    // 메타데이터 → 동형
    const pinsFromMetadata = {};
    for (const entry of CANONICAL_DECLS) pinsFromMetadata[entry.id] = [...entry.pins].sort();
    expect(pinsFromClassification).toEqual(pinsFromMetadata);
  });
});

describe('핀 대상 컴포넌트 5파일 — 보호 토큰 네임스페이스 "선언" 전면 금지 (조상 스코프 오염 차단, 9라운드)', () => {
  // 위 PINNED가 이미 컴파일 중인 5파일(canvasEditor·taskList·myTasks·home-shared·browseBranches)은
  // var(--color-x) 같은 소비만 정상이다. `.Foo { --color-x: … }`처럼 어떤 selector에서든 보호
  // 네임스페이스를 재선언하면 그 조상 스코프 서브트리 전체의 캐스케이드 값을 오염시킨다 —
  // structuralGate와 동일한 판정(findProtectedDeclarations)을 컴파일된 사이트 CSS 전체에 적용해
  // 선언 자체의 존재를 금지한다(소비=var() 참조는 --접두 prop이 아니므로 애초에 안 걸린다).
  const PINNED_FILES = [
    'components/canvas/canvasEditor.scss',
    'components/branch/taskList.scss',
    'components/myTasks/myTasks.scss',
    'components/home/shared/home-shared.scss',
    'components/browse/browseBranches.scss',
  ];
  it.each(PINNED_FILES)('%s는 --color-/--track-/--shadow- 를 선언하지 않는다(소비만)', (file) => {
    const offenders = findProtectedDeclarations(compiledSiteCss(file));
    expect(offenders, `${file}에서 보호 토큰 선언 발견: ${offenders.join('; ')}`).toEqual([]);
  });
});

// .css 원문 정규화(Minor, 11라운드) — raw postcss 파싱은 escaped custom-property 이름
// (`--\63 olor-selected-indicator` = 유효 CSS, 실이름 --color-selected-indicator)을 리터럴 prop으로
// 남겨 hasProtectedPrefix(startsWith '--color-')를 우회시켰다(외부 검수 실증). Sass CSS-syntax 컴파일로
// 식별자 escape를 정규화한다 — 부분 hex 정규식·escape 수동 재구현 없이 파서에 위임한다. custom
// property는 스펙상 case-sensitive라 --Color-x는 그대로 보존되고(≠--color-x), var() 소비는 값이라 decl.prop
// 검사에 안 걸리며, `/* */` 블록주석은 Comment 노드로 분리돼 오검출되지 않는다. 컴파일 실패는 조용히
// 넘기지 않고 상위 sweepFileForProtectedDeclarations의 try/catch가 offender로 표면화해 RED로 떨어뜨린다.
function normalizeRawCss(source) {
  return compileString(String(source), { syntax: 'css' }).css;
}

// styles/ 아래 임의 파일(.scss는 컴파일, .css는 CSS-syntax 정규화)을 CSS 텍스트로 반환한다.
// scssCompileCache를 그대로 재사용해(relPath 키 공간이 겹치지 않으므로 안전) 핀 5파일과 캐시를
// 공유한다 — Important 1 수정 지시("컴파일 결과는 모듈 스코프 캐시(핀 5파일과 공유)로 1회만").
function siteCssText(relPath) {
  if (relPath.endsWith('.css')) {
    if (!scssCompileCache.has(relPath)) {
      scssCompileCache.set(relPath, normalizeRawCss(readFileSync(resolve(__dirname, '../styles', relPath), 'utf8')));
    }
    return scssCompileCache.get(relPath);
  }
  return compiledSiteCss(relPath);
}

// P4(Important 1, 외부 검수 10라운드) — 원문 스윕은 소스 정규식("같은 줄에서 이름:" 매칭) + .scss만
// 봐서 두 우회를 놓쳤다(외부 검수 실증): ① fonts.css(_app에서 _themes **뒤** import — 실측 확인,
// pages/_app.js: _themes.scss → globals.scss → fonts.css 순)에 보호 토큰 override를 넣어도 .css는
// 스윕 대상이 아니라 안 걸렸다. ② `--color-x`\n`: red;`처럼 콜론을 다음 줄로 보내면(유효 SCSS,
// 컴파일 결과는 동일) 같은-줄 정규식이 매치 실패했다. 컴파일(.scss) 또는 그대로(.css) → postcss AST
// walkDecls로 전환하면 원본 포맷(멀티라인·주석·중첩)과 무관하게 최종 선언만 보므로 두 우회 모두
// 구조적으로 막힌다 — findProtectedDeclarations(핀 5파일이 이미 쓰는 동일 판정 로직)를 styles/ 전체로
// 확장해 재사용한다(로직 중복·drift 방지). 고아 파일(_app 미import, 예: createIssue.scss)도 스윕
// 대상에 포함되지만 무해하다 — 선언 금지는 파일 로드 여부와 무관한 전역 계약이다. sass.compile
// 실패는 조용히 건너뛰지 않고(offender로 표면화) expect([]).toEqual([])를 RED로 떨어뜨린다.
// I1(24R): 같은 siteCssText(compile/normalize)→postcss AST 파이프라인에 property 하나(color-scheme) 금지를
// 더 얹는다 — findColorSchemeDeclarations(비-custom 전역 스위치)를 findProtectedDeclarations(보호 custom
// property)와 같은 텍스트에 병렬로 태워 offender를 합친다(새 파이프라인 없음).
function sweepFileForProtectedDeclarations(relPath) {
  try {
    const text = siteCssText(relPath);
    return [...findProtectedDeclarations(text), ...findColorSchemeDeclarations(text)].map((o) => `${relPath}: ${o}`);
  } catch (e) {
    return [`${relPath}: 컴파일/파싱 실패(FAIL로 표면화, 침묵 스킵 금지) — ${String((e && e.message) || e).split('\n')[0]}`];
  }
}

// P4 스윕 대상 판정(Important 2, 11라운드) — pure helper. 보호 토큰 선언 금지 계약의 대상 파일인가?
// 이전 필터는 `f.endsWith('_themes.scss')`로 예외를 걸어 루트 정본뿐 아니라 중첩 `components/example/
// _themes.scss`·접미 우연 일치 `components/rogue_themes.scss`까지 잘못 제외했다(외부 검수 실증). SCSS
// 예외는 루트 상대경로 exact '_themes.scss' **하나뿐**이어야 한다(endsWith 금지). .scss는 컴파일, .css는
// 정규화 후 AST 스윕 대상이며, 그 외 확장자는 대상이 아니다. 새 .scss/.css는 자동으로 포함된다.
function isProtectedSweepTarget(relPath) {
  if (relPath === '_themes.scss') return false; // 유일 예외: 토큰의 정본 거처(라이트/다크/별칭 3블록)
  return relPath.endsWith('.scss') || relPath.endsWith('.css');
}

describe('styles/ 전체 컴파일/AST 스윕 — 비핀 파일 보호 토큰 선언 금지 (P4, 컴파일 기반)', () => {
  const stylesDir = resolve(__dirname, '../styles');
  const allFiles = readdirSync(stylesDir, { recursive: true }).map(String);
  const targetFiles = allFiles.filter(isProtectedSweepTarget);

  // 확장자 커버리지를 "총개수 하한"으로 대체하지 않는다(Important 2) — 아래 exact 제외목록·역방향
  // 포함 단정이 실제 커버리지를 고정한다. 개수는 극단적 축소만 잡는 보조 신호로만 남긴다.
  it('스윕 대상 파일이 90개를 넘는다(극단 축소 보조 신호 — .scss 92 + .css 1 실측 기준)', () => {
    expect(targetFiles.length).toBeGreaterThan(90);
  });

  it('제외되는 .scss는 루트 정본 _themes.scss 하나뿐 (endsWith 우회 방지 — 중첩/접미 _themes.scss는 대상)', () => {
    const excludedScss = allFiles.filter((f) => f.endsWith('.scss') && !isProtectedSweepTarget(f));
    expect(excludedScss).toEqual(['_themes.scss']);
  });

  it('styles/**/*.css 전부가 스윕 대상에 포함된다 + fonts.css 직접 고정 (.css 분기 삭제 재발 검출)', () => {
    const allCss = allFiles.filter((f) => f.endsWith('.css'));
    expect(allCss.length, 'styles/ 아래 .css가 하나도 없다면 인벤토리 전제가 깨짐').toBeGreaterThan(0);
    for (const f of allCss) expect(targetFiles, `${f}가 스윕 대상에서 누락`).toContain(f);
    expect(targetFiles).toContain('fonts.css');
  });

  it('.css 분기를 뺀 대체 판정은 최소 하나의 .css를 놓친다 (누락 회귀를 역방향 포함 단정이 잡음을 확인)', () => {
    const withoutCssBranch = (relPath) => relPath !== '_themes.scss' && relPath.endsWith('.scss'); // .css 분기 제거 모사
    const mutated = allFiles.filter(withoutCssBranch);
    const allCss = allFiles.filter((f) => f.endsWith('.css'));
    expect(allCss.some((f) => !mutated.includes(f))).toBe(true);
  });

  // 적대적 자가 재검토(18R, inventory 누락 클래스 — I4와 동종) — isProtectedSweepTarget은 `.scss`/`.css`
  // **두 확장자만** 대상으로 삼는다. 그래서 styles/ 아래에 다른 스타일 확장자(`.sass` 들여쓰기 문법,
  // `.less`, `.pcss` 등)가 추가되면 10R에 fonts.css가 그랬던 것과 **정확히 같은 방식으로** 스윕 밖으로
  // 새 나간다(파일은 로드되는데 게이트는 못 본다). 확장자 화이트리스트를 열어두는 대신, styles/ 아래
  // 실제 확장자 인벤토리 자체를 고정한다 — 새 확장자가 등장하면 여기서 먼저 RED가 나고 개발자가
  // isProtectedSweepTarget 확장 여부를 의식적으로 결정하게 된다(silent 누락 → 명시 결정으로 전환).
  it('styles/ 아래 확장자 인벤토리 고정 — .scss/.css 외 확장자가 생기면 RED(스윕 밖 silent 누락 방지)', () => {
    const exts = new Set(allFiles.filter((f) => f.includes('.')).map((f) => f.slice(f.lastIndexOf('.'))));
    expect([...exts].sort()).toEqual(['.css', '.scss']);
  });

  it('.scss 전부(컴파일 후 AST)+.css 전부(정규화 후 파싱)가 --color-/--track-/--shadow-·color-scheme 를 선언하지 않는다 (I1 24R)', () => {
    const offenders = targetFiles.flatMap(sweepFileForProtectedDeclarations);
    expect(offenders, `보호 토큰/color-scheme 선언(또는 컴파일 실패) 발견: ${offenders.join('; ')}`).toEqual([]);
  });
});

describe('I1(24R) styles 전역 color-scheme 금지 선재현↔RED — P4 스윕 non-custom property 확장', () => {
  // 옛 P4 검출(findProtectedDeclarations)은 --color-/--track-/--shadow-만 봐서 color-scheme에 blind(선재현),
  // 신 검출(findColorSchemeDeclarations)이 디코딩+lowercase로 위치/selector/escape/case 무관 RED. 두 검출을
  // sweepFileForProtectedDeclarations가 같은 siteCssText에 병렬로 태운다(위 실 스윕 assertion이 실 파일 커버).
  const scssCss = (body) => compileString(body).css;   // .scss 경로(Sass 컴파일)
  const rawCss = (body) => normalizeRawCss(body);       // .css 경로(fonts.css식 css-syntax 정규화)
  const cases = {
    'fonts.css식 .css raw':         rawCss(':root{color-scheme:dark}'),
    '일반 SCSS(비-:root selector)':  scssCss('.Foo{color-scheme:dark}'),
    '@media 내부':                   rawCss('@media (min-width:0px){:root{color-scheme:dark}}'),
    'escaped(color-\\73 cheme)':     ':root{color-\\73 cheme:dark}', // raw — decoder가 실이름 복원
    'case 변형(COLOR-SCHEME)':       ':root{COLOR-SCHEME:dark}',      // raw — toLowerCase가 정규화(regular property는 대소문자 무시)
  };
  it.each(Object.entries(cases))('선재현: %s → findProtectedDeclarations blind(offender 0)', (_l, cssText) => {
    expect(findProtectedDeclarations(cssText)).toEqual([]);
  });
  it.each(Object.entries(cases))('RED: %s → findColorSchemeDeclarations offender>0', (_l, cssText) => {
    expect(findColorSchemeDeclarations(cssText).length).toBeGreaterThan(0);
  });
  it('escaped가 실 파이프라인(Sass css-syntax 정규화)에서도 리터럴 color-scheme로 접혀 잡힌다(디코더는 belt-and-suspenders)', () => {
    // 실 스윕은 siteCssText(Sass)를 거치므로 escape는 컴파일 시 리터럴로 정규화된다 — 정규화본도 RED.
    expect(findColorSchemeDeclarations(rawCss(':root{color-\\73 cheme:dark}')).length).toBeGreaterThan(0);
  });
  it('대조(false-positive 없음): color-scheme 없는 파일 — 보호 custom property 소비·color/background는 GREEN', () => {
    expect(findColorSchemeDeclarations(rawCss(':root{--color-bg:#fff}'))).toEqual([]);
    expect(findColorSchemeDeclarations(scssCss('.Foo{color:red;background:var(--color-bg)}'))).toEqual([]); // 'color'≠'color-scheme'
  });
  it('적대적 스코프 판단: color-scheme만 좁게 금지 — accent-color/forced-color-adjust는 컴포넌트 정당 사용이라 대상 아님', () => {
    // accent-color는 스타일에 input[type=checkbox] 등 9곳 정당 사용, forced-color-adjust는 레포 0 — 전역 금지 시 false-positive.
    expect(findColorSchemeDeclarations(rawCss('.Foo{accent-color:red;forced-color-adjust:none}'))).toEqual([]);
    expect(STYLES_FORBIDDEN_NONCUSTOM_PROPS).toEqual(['color-scheme']);
  });
});

// WCAG 2.x 상대휘도/대비비. hex 6자리와 rgb(a)(...) 둘 다 파싱한다(myTasks ScopeBtn--active의
// 반투명 배경 rgba(94, 106, 210, 0.1)를 합성색 계산에 그대로 써야 하므로 hex 전용으로는 부족하다).
// transparent 등 둘 다 아닌 값은 파싱 실패로 null → contrastRatio가 0을 반환해 아래 >=3 단정이
// RED가 된다(다크 인디케이터 투명 회귀 검출).
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function parseColor(value) {
  // I1(18R, 적대적 자가 재검토에서 실측 발견): JS trim이면 `#6B7280<NBSP>`(브라우저에선 무효 값이라
  // 토큰이 적용되지 않는다)를 정상 hex로 둔갑시켜 대비 3.97로 통과했다 — CSS 공백 전용 trim으로 교체.
  const str = cssTrim(value);
  const hex = /^#([0-9a-fA-F]{6})$/.exec(str);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  // 엄격 CSS <number> 토큰만 허용(Important 1) — 느슨한 `[\d.]+`는 `1.`(trailing dot, CSS 불법 —
  // 브라우저는 이 선언을 폐기해 box-shadow가 none처럼 무효화된다)도 매치해 Number('1.')===1로
  // 정상 색상 취급했다(외부 검수 8라운드 실증). `\d+(?:\.\d+)?`(정수/소수)와 `\.\d+`(선행 점만) 두
  // 형태만 인정 — trailing dot·다중 소수점(`1.2.3`)·빈 채널은 전부 매치 실패로 null.
  // I1(18R, 적대적 자가 재검토): 구분자 공백도 CSS 5종만 허용한다. JS `\s*`는 `rgba(107,<NBSP>114,…)`
  // (브라우저는 무효 → 토큰 미적용)를 정상 색으로 파싱해 대비 단정을 통과시켰다 — 같은 과대 허용 클래스.
  const N = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
  const W = `[${CSS_WS_CLASS}]*`;
  const rgba = new RegExp(`^rgba?\\(${W}(${N})${W},${W}(${N})${W},${W}(${N})${W}(?:,${W}(${N})${W})?\\)$`).exec(str);
  if (rgba) {
    // 브라우저 의미론대로 clamp — a는 [0,1], RGB 채널은 [0,255]. clamp 없이 Number()만 쓰면
    // `rgba(60,60,60,10)`(a=10)처럼 스펙 밖 값이 합성 수학을 붕괴시킨다: compositeOver의
    // `a*fg + (1-a)*bg`가 a=10일 때 음의 계수(1-a=-9)로 bg를 반대 방향으로 끌어당겨 비현실적인
    // 합성색을 만들고, 그 결과로 나온 대비가 실제 렌더(clamp된 a=1, 즉 완전 불투명)보다 훨씬 높게
    // 나와 회귀를 놓쳤다(외부 검수 실증, s시나리오: 실대비 ≈1.5~1.7인데 미클램프 시 25~74로 통과).
    return {
      r: clamp(Number(rgba[1]), 0, 255),
      g: clamp(Number(rgba[2]), 0, 255),
      b: clamp(Number(rgba[3]), 0, 255),
      a: rgba[4] != null ? clamp(Number(rgba[4]), 0, 1) : 1,
    };
  }
  return null;
}
// fgValue/bgValue는 hex/rgba 문자열이거나 이미 파싱·합성된 {r,g,b} 객체(체인 합성용) 둘 다 허용 —
// 객체면 alpha 필드가 없다는 뜻이므로 불투명(a=1)으로 취급한다(ScopeToggle처럼 배경 자체가 이미
// 알파 합성 결과인 체인 케이스, compositeOver(indicator, scopeToggleAdjacent) 등).
function toRGBA(value) {
  if (value && typeof value === 'object' && 'r' in value) return { a: 1, ...value };
  return parseColor(value);
}
// 반투명 전경(fgValue)을 배경(bgValue) 위에 알파 합성한 불투명 rgb 결과. 파싱 실패면 null.
function compositeOver(fgValue, bgValue) {
  const fg = toRGBA(fgValue);
  const bg = toRGBA(bgValue);
  if (!fg || !bg) return null;
  const a = fg.a;
  return { r: a * fg.r + (1 - a) * bg.r, g: a * fg.g + (1 - a) * bg.g, b: a * fg.b + (1 - a) * bg.b };
}
function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
// colorA/colorB는 hex/rgba 문자열 또는 이미 파싱된 {r,g,b} 객체(합성색) 둘 다 허용.
// ⚠️ 알파를 파싱만 하고 무시한다 — rgba(…, 0)(완전 투명) 같은 값도 hex와 동일하게 취급해 오통과
// 시킨다(외부 검수 실증, k시나리오). 인디케이터처럼 알파가 있을 수 있는 전경색은 절대 이 함수에
// 직접 넣지 말고 반드시 아래 contrastOverBg로 배경 위에 먼저 합성한 뒤 그 결과를 넣을 것.
function contrastRatio(colorA, colorB) {
  const a = typeof colorA === 'string' ? parseColor(colorA) : colorA;
  const b = typeof colorB === 'string' ? parseColor(colorB) : colorB;
  if (!a || !b) return 0;
  const [lo, hi] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}
// 인디케이터(fg)를 인접 배경(bg) 위에 먼저 알파 합성한 뒤, 그 합성색과 배경 자체의 대비를 잰다.
// contrastRatio(fg, bg)를 직접 부르면 fg의 알파가 무시돼 rgba(107,114,128,0)(완전 투명)도 불투명
// hex와 동일한 대비로 통과했다 — 합성을 먼저 거치면 알파=0일 때 결과가 배경과 완전히 같아져
// 1:1이 되고, 아래 >=3 단정이 자연히 RED가 된다(외부 검수 실증, k시나리오).
function contrastOverBg(fgValue, bgValue) {
  const composited = compositeOver(fgValue, bgValue);
  if (!composited) return 0;
  return contrastRatio(composited, bgValue);
}

// M2(19R) — 모듈 스코프 승격(이전엔 다크 indicator describe 안의 지역 함수라 mutation으로 안 잠겼다).
// 최종 색값 해석: 리터럴(hex/rgba)이면 그대로, `var(--token)`이면 darkValuesMap으로 재귀 해석, 그 외는 null.
// var() 매치의 공백은 **CSS 5종 전용**이다(I1 손실 정규화 클래스) — 옛 `\s`/`trim()`으로 되돌리면 NBSP 등이
// 통과해 M2 직접 테스트가 RED가 된다. 순환 참조는 depth>5로 끊어 null(무한재귀 방지).
function resolveColorValue(value, darkValuesMap, depth = 0) {
  if (value == null || depth > 5) return null;
  if (parseColor(value)) return value;
  const m = new RegExp(`^var\\([${CSS_WS_CLASS}]*--([a-z0-9-]+)[${CSS_WS_CLASS}]*(?:,[\\s\\S]*)?\\)$`, 'i')
    .exec(cssTrim(value));
  if (!m) return null;
  const next = darkValuesMap[m[1]];
  if (next == null) return null;
  return resolveColorValue(next, darkValuesMap, depth + 1);
}

// 다크 셀렉터가 매칭 가능한 3가지 quote 변형(Sass 버전별 unquoted 출력 포함) — 파일 상단 주석 참고.
const DARK_SELECTORS = ['html[data-theme=dark]', "html[data-theme='dark']", 'html[data-theme="dark"]'];

// 보호 토큰 네임스페이스 — 이 접두사를 가진 custom property는 오직 flat 3블록(라이트/다크/별칭) 안에서만
// 선언될 수 있다. 어떤 selector·atrule로 감싸든(9라운드 이전에는 이 두 가지가 감시 목록 밖이라 통과했다)
// 이 세 블록 밖에서 나타나면 즉시 위반이다.
const PROTECTED_TOKEN_PREFIXES = ['--color-', '--track-', '--shadow-'];

// F1(12라운드) — 표준 CSS 식별자 escape 디코더. Sass는 내부 hex escape(--\63 olor-x)는 --color-x로
// 정규화하지만 **선행 하이픈**은 \- 형태로 재직렬화한다(\--color-x, -\-color-x, \2d -color-x→\--color-x,
// -\2d color-x→-\-color-x — 실측 확인). 이 escape 이름들은 전부 브라우저에서 --color-x로 해석되는 유효
// 선언인데 raw decl.prop이 startsWith('--color-')를 우회했다. 선행 escape 몇 개를 정규식으로 치환하는
// 접근은 leaky하므로(변종마다 뚫림) CSS Syntax Module의 escape 규칙대로 hex escape(\HH… 최대 6자리 +
// 선택 공백 1개)와 문자 escape(\X → X, 하이픈 포함)를 모두 해석해 의미 식별자를 복원한 뒤 접두를 검사한다.
// custom property는 스펙상 case-sensitive이므로 디코더는 대소문자를 보존한다(\43 →'C' → --Color-x 는
// 여전히 비보호). escape 없는 일반 prop(--color-x·border-color 등)은 그대로 반환(no-op)이라 무해하다.
function decodeCssIdentifier(ident) {
  const s = String(ident);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== '\\') { out += ch; i += 1; continue; }
    const next = s[i + 1];
    if (next === undefined) { out += '�'; break; } // 매달린 백슬래시 → U+FFFD(스펙)
    if (/[0-9a-fA-F]/.test(next)) {
      let hex = '';
      let j = i + 1;
      while (j < s.length && hex.length < 6 && /[0-9a-fA-F]/.test(s[j])) { hex += s[j]; j += 1; }
      if (j < s.length && /[ \t\n\f\r]/.test(s[j])) j += 1; // hex escape 뒤 공백 1개 소비
      const code = parseInt(hex, 16);
      out += (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) ? '�' : String.fromCodePoint(code);
      i = j;
    } else if (next === '\n' || next === '\f' || next === '\r') {
      i += 2; // 식별자 내 escaped newline은 방어적으로 무시
    } else {
      out += next; // 문자 escape: \X → X
      i += 2;
    }
  }
  return out;
}
function hasProtectedPrefix(prop) {
  const decoded = decodeCssIdentifier(prop);
  return PROTECTED_TOKEN_PREFIXES.some((p) => decoded.startsWith(p));
}

// I4(18R) — @property 등록 스윕. 이전까지 모든 스캔(findProtectedDeclarations·structuralGate·
// findUnprotectedDeclarations)은 **일반 declaration(decl.prop)만** 봤다. CSS `@property --color-x {
// syntax:"<color>"; inherits:false; initial-value:transparent; }`는 이름이 `atrule.params`에 있고 내부는
// syntax/inherits/initial-value라는 별개 디스크립터라 어느 스캔에도 잡히지 않았다(선재현 실측:
// offenders 0). 등록되면 그 토큰은 **더 이상 :root에서 상속되지 않고** initial-value를 쓰므로 자식
// 핀의 경계가 통째로 소실되는데 PINNED 선언 문자열은 그대로라 전 GREEN이다 — inventory 누락형
// false-green이다. 등록 **값**은 계산하지 않는다(문법 모델 추가 금지): 보호 접두 이름의 등록 자체를
// 금지한다. at-rule 이름도 escape/대소문자 변형(`@PROPERTY`, `@\70 roperty`)이 가능하므로 이 파일의
// 유일 디코더(decodeCssIdentifier)를 통과시킨 뒤 비교한다 — I3와 같은 "이름 비대칭" 재발 방지.
function findProtectedPropertyRegistrations(root) {
  const offenders = [];
  root.walkAtRules((atrule) => {
    if (decodeCssIdentifier(atrule.name).toLowerCase() !== 'property') return;
    const name = cssTrim(atrule.params);
    if (!hasProtectedPrefix(name)) return;
    offenders.push(`@property ${name}@${atrule.source?.start?.line}행(위치: ${describeLocation(atrule.parent)})`);
  });
  return offenders;
}

// FAIL 메시지에 위반 위치를 selector/atrule 체인(바깥→안, 예: `@media (min-width:0) > :root`)으로
// 이어붙인다 — 구조 게이트·컴포넌트 선언 금지 검사가 공유한다.
function describeLocation(node) {
  const parts = [];
  let cur = node;
  while (cur && cur.type !== 'root') {
    if (cur.type === 'rule') parts.unshift(cur.selector);
    else if (cur.type === 'atrule') parts.unshift(`@${cur.name}${cur.params ? ` ${cur.params}` : ''}`);
    cur = cur.parent;
  }
  return parts.join(' > ') || '(root)';
}

// 구조 계약(9라운드) — selector 문자열 열거(구 collectDarkSelectorRules)를 전면 폐기하고 _themes.scss의
// flat 3블록 계약을 postcss AST로 직접 강제한다. selector 열거 방식은 "감시할 selector 목록"을
// 유지하는 접근이었는데, 외부 검수가 그 목록 밖 selector로 두 가지 우회를 실증했다(둘 다 실렌더에서
// indicator 투명화를 일으키는데도 기존 방식으로는 37/37 GREEN이었다):
//  ① `@media (min-width:0){ :root { --color-selected-indicator: …0 !important } }` — `:root`는
//     DARK_SELECTORS 어떤 변형도 아니라서(선택자 문자열 자체가 다르다는 이유로) 다크 규칙으로
//     수집조차 안 됐다. 그런데 `:root`도 `html`에 적용되고 important가 승리하므로 실뷰포트에서는
//     이 규칙이 그대로 이긴다.
//  ② `@supports (display:block){ html[data-theme='dark']:root { …0 !important } }` — 이번엔 selector
//     문자열이 DARK_SELECTORS 어떤 변형과도 완전 동일 문자열이 아니라서(`:root` 접미가 붙어) 역시
//     안 걸렸다.
// 두 우회의 공통점은 "실렌더에서 이기는가"(root 직속 여부·important)와 무관하게 오직 "감시 목록에
// 있는 정확한 selector 문자열인가"만으로 판정했다는 것 — 그래서 selector 매칭 자체를 버리고, "보호
// 네임스페이스는 정해진 세 블록 밖 어디서도 선언될 수 없다"는 존재 자체 금지로 뒤집는다. selector가
// 무엇이든(`:root`든 `html[...]:root`든 그 무엇이든) 3블록 밖이면 무조건 FAIL — 우회 불가능한
// 화이트리스트(3블록만 예외)다.
function structuralGate(themesCss) {
  const root = postcss.parse(themesCss);
  const rootRules = [];
  root.walkRules((rule) => {
    if (rule.parent.type === 'root') rootRules.push(rule);
  });

  if (rootRules.length !== 3) {
    const where = rootRules
      .map((r) => `"${r.selector}"@${r.source?.start?.line}행`)
      .join(', ') || '(없음)';
    throw new Error(
      `_themes.scss 3블록 계약 위반: root 직속 규칙이 정확히 3개([라이트 :root, 다크 html[data-theme=dark], ` +
      `별칭 :root])여야 하는데 ${rootRules.length}개 발견 — ${where}`,
    );
  }

  const [lightRule, darkRule, aliasRule] = rootRules;
  // I1(18R): selectorMatches와 동일한 CSS 공백 전용 정규화 + 파서-레벨 JS trim 손실 가드를 적용한다.
  // `html[data-theme=dark]<NBSP>`가 JS trim으로 다크 블록으로 오인되던 경로를 fail-closed로 닫는다.
  const cssSafeSelector = (rule) =>
    (JS_ONLY_WS_RE.test(rule.selector) ? null : normalizeCssWhitespace(rule.selectors[0] ?? ''));
  const isPlainRoot = (rule) => rule.selectors.length === 1 && cssSafeSelector(rule) === ':root';
  const isDarkForm = (rule) =>
    rule.selectors.length === 1 && DARK_SELECTORS.includes(cssSafeSelector(rule));

  if (!isPlainRoot(lightRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 1번째 블록(라이트)은 ':root' 단독이어야 하는데 "${lightRule.selector}"(${lightRule.source?.start?.line}행)`);
  }
  if (!isDarkForm(darkRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 2번째 블록(다크)은 html[data-theme=dark] 계열(quote 무관) 단독이어야 하는데 "${darkRule.selector}"(${darkRule.source?.start?.line}행)`);
  }
  if (!isPlainRoot(aliasRule)) {
    throw new Error(`_themes.scss 3블록 계약 위반: 3번째 블록(별칭)은 ':root' 단독이어야 하는데 "${aliasRule.selector}"(${aliasRule.source?.start?.line}행)`);
  }

  // 보호 토큰 네임스페이스 선언 전수 검사 — "위 3개 rule 노드와 identity가 같은가"로만 판정한다
  // (selector 문자열 재비교가 아니다). @media/@supports 등으로 감싸 selector 텍스트를 3블록과 완전히
  // 동일하게(①) 또는 다르게(②) 만들어도 그 rule 노드는 3블록과 별개 객체이므로 절대 우회 불가 —
  // walkDecls는 @media/@supports 등 atrule 내부·다른 selector·중첩 무관 전수를 방문한다.
  const legitBlocks = new Set(rootRules);
  const offenders = [];
  root.walkDecls((decl) => {
    if (!hasProtectedPrefix(decl.prop)) return;
    const inLegitBlock = decl.parent.type === 'rule' && legitBlocks.has(decl.parent);
    if (inLegitBlock) return;
    offenders.push(`${decl.prop}@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  // I4(18R): @property 등록은 3블록(rule 노드) 안에 있을 수 없는 at-rule이므로 발견 즉시 위반이다.
  offenders.push(...findProtectedPropertyRegistrations(root));
  if (offenders.length > 0) {
    throw new Error(
      `_themes.scss 3블록 계약 위반: 보호 토큰(${PROTECTED_TOKEN_PREFIXES.join('/')}) 선언/등록이 3블록 밖에서 ` +
      `발견됨 — ${offenders.join('; ')}`,
    );
  }

  // I1(19R) shape contract — cascade winner를 **계산**하는 대신 "cascade가 자명해지는 형태"만 통과시킨다.
  // 각 블록에서 보호 토큰은 정확히 1개 선언(2개 이상=중복 offender)이고 !important를 쓰지 않는다(offender).
  // 이 유일 선언의 AST 값이 곧 baseline이다(buildBlockValues). 선재현(수정 전 현행 HEAD): LIGHT_BASELINE은
  // Object.fromEntries(후행 승리), SHADOW_XS_BASELINE.light는 정규식 .exec(첫 매치), buildDarkValues는
  // 다크 블록만 봐서 — 라이트에 `--shadow-xs: none !important` 중복이나 indicator `transparent !important`
  // 중복을 주입해도 372/372 통과했다(Chrome 계산값과 baseline이 어긋나는 false-green). 중복·!important
  // 자체를 offender로 접으면 "cascade가 자명"해져 첫/후행/중요도 어느 것을 읽든 결과가 같아진다 —
  // 그래서 게이트가 브라우저 cascade를 재구현할 필요가 없다(17R가 폐기한 실패 모드로 되돌아가지 않는다).
  // "0개"는 여기서 잡지 않는다: 모든 토큰이 모든 블록에 있는 게 아니며, 특정 토큰의 부재는 baseline
  // 단정(undefined ≠ 기대 리터럴)이 RED로 잡는다. escaped 이름(`\--color-x`)도 decodeCssIdentifier로
  // 실이름 그룹핑해 중복을 세므로 I3식 이름 비대칭 우회가 불가능하다.
  const shapeOffenders = [];
  for (const [blockName, rule] of [['라이트', lightRule], ['다크', darkRule], ['별칭', aliasRule]]) {
    const byToken = new Map(); // 디코딩된 실이름 → [{ important, line }]
    rule.walkDecls((decl) => {
      if (!hasProtectedPrefix(decl.prop)) return;
      const name = decodeCssIdentifier(decl.prop);
      if (!byToken.has(name)) byToken.set(name, []);
      byToken.get(name).push({ important: !!decl.important, line: decl.source?.start?.line });
    });
    for (const [name, ds] of byToken) {
      if (ds.length > 1) shapeOffenders.push(`${blockName} 블록 ${name} 선언 ${ds.length}개(중복 — cascade 비자명, ${ds.map((d) => `${d.line}행`).join('·')})`);
      for (const d of ds) if (d.important) shapeOffenders.push(`${blockName} 블록 ${name} !important(${d.line}행 — cascade 비자명)`);
    }
  }
  if (shapeOffenders.length > 0) {
    throw new Error(`_themes.scss shape contract 위반(보호 토큰 블록당 1선언·!important 금지): ${shapeOffenders.join('; ')}`);
  }

  return { root, lightRule, darkRule, aliasRule };
}

// 핀 대상 컴포넌트(및 임의 사이트 파일)가 보호 네임스페이스를 "선언"하는지 전수 검사한다(9라운드).
// 이 파일들은 var(--color-x) 같은 소비만 정상이고, `.Foo { --color-x: … }`처럼 조상 스코프에
// 재선언하면 그 서브트리 전체의 캐스케이드 값을 오염시킨다 — 컴포넌트는 소비 전용 계약이다.
// I4(18R): 일반 declaration에 더해 @property 등록(atrule.params)도 같은 계약으로 금지한다.
function findProtectedDeclarations(cssText) {
  const root = postcss.parse(cssText);
  const offenders = [];
  root.walkDecls((decl) => {
    if (!hasProtectedPrefix(decl.prop)) return;
    offenders.push(`${decl.prop}@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  offenders.push(...findProtectedPropertyRegistrations(root));
  return offenders;
}

// I1(24R) — styles 전역 color-scheme 금지. P4 스윕(findProtectedDeclarations)은 `--color-/--track-/--shadow-`
// 보호 **custom property**만 봤다. 그런데 `color-scheme`(non-custom, `--` 아님)는 :root의 네이티브 컨트롤·
// 스크롤바 라이트/다크를 통째로 바꾸는 전역 스위치이고 정본은 오직 `_themes.scss`(라이트/다크 블록)다.
// 격리 실증: `_themes.scss`보다 뒤 import되는 `fonts.css`(_app.js: _themes→globals→fonts 순)에
// `:root{color-scheme:dark!important}`를 넣어도 findProtectedDeclarations는 `--` 접두가 아니라 blind →
// 486 GREEN인데 라이트 화면 네이티브 컨트롤·스크롤바가 실제 dark로 강제되는 제품 회귀(selector 동치성/JS
// 런타임 예외 아님, 정적 styles 인벤토리 스코프 안). 기존 compile/normalize(siteCssText)→postcss AST
// 파이프라인을 **그대로 재사용**해(새 파이프라인 없음) `color-scheme` 선언을 위치·selector·중첩 무관 전면
// 금지한다. 이름 비교는 이 파일의 유일 디코더 decodeCssIdentifier(escape 복원)+toLowerCase 후 —
// escaped(`color-\73 cheme`)/case 변형(`COLOR-SCHEME`)까지 닫는다(regular property는 스펙상 대소문자 무시).
// 적대적 스코프 판단: 다른 테마성 non-custom property는 **함께 금지하지 않는다** — `accent-color`는 스타일에
// input[type=checkbox] 등 컴포넌트 스코프로 9곳 정당 사용(전역 금지 시 false-positive), `forced-color-adjust`는
// 레포 사용 0. color-scheme만이 `_themes`가 :root에서 소유하는 전역 네이티브-테마 스위치라 여기만 좁게 닫는다.
const STYLES_FORBIDDEN_NONCUSTOM_PROPS = ['color-scheme'];
function findColorSchemeDeclarations(cssText) {
  const root = postcss.parse(cssText);
  const offenders = [];
  root.walkDecls((decl) => {
    const name = decodeCssIdentifier(decl.prop).toLowerCase();
    if (!STYLES_FORBIDDEN_NONCUSTOM_PROPS.includes(name)) return;
    offenders.push(`${name} 선언 금지(styles 전역 — 정본은 _themes.scss)@${decl.source?.start?.line}행(위치: ${describeLocation(decl.parent)})`);
  });
  return offenders;
}

// P3(역방향, 내부 리뷰 지적) — 위 스캔들은 전부 "보호 접두가 3블록 '밖'에서 선언되면 안 된다"는
// 한 방향만 본다. 반대 방향(3블록 '안'에 PROTECTED_TOKEN_PREFIXES 밖의 새 토큰 패밀리가 섞여도
// 아무도 안 잡는다)은 열린 구멍이었다 — 예: 4번째 접두(예: --spacing-)가 도입돼 3블록에 추가돼도
// findProtectedDeclarations/structuralGate 무엇도 감지 못한다. rules는 postcss Rule 노드 배열
// (구조 게이트가 반환한 lightRule/darkRule/aliasRule 또는 synthetic 단일 rule)이고, 각 rule의
// decl을 훑어 '--'로 시작하지만 보호 접두 3종 어디에도 안 속하는 선언을 offenders로 모은다.
// color-scheme 같은 일반 프로퍼티는 '--' 접두가 아니므로 애초에 대상이 아니다.
// I1(13라운드) — decl.prop을 **정확히 한 번 디코딩한 지역 변수**로 custom-property 여부와 보호 접두를
// 모두 판정한다. 이전엔 raw `decl.prop.startsWith('--')`를 디코딩 전에 검사해, 선행 하이픈이 escape된
// 이름(`\--unprotected-x`·`-\-unprotected-x`·`\2d -unprotected-x`·`-\2d unprotected-x` — 전부 디코딩
// 결과 --unprotected-x)이 raw로는 `--`로 시작하지 않아 탈락 → 역방향 게이트가 새 비보호 토큰 패밀리를
// 놓쳤다(offender 0). 기존 케이스(--\75 nprotected-x)는 raw가 이미 --로 시작해 이 구멍을 미검증했다.
// offender 메시지는 원문(raw) decl.prop을 유지한다(기존 계약).
function findUnprotectedDeclarations(rules) {
  const offenders = [];
  for (const rule of rules) {
    rule.walkDecls((decl) => {
      const decoded = decodeCssIdentifier(decl.prop); // 정확히 한 번 디코딩
      if (!decoded.startsWith('--')) return; // 디코딩값으로 custom-property 판정
      if (!PROTECTED_TOKEN_PREFIXES.some((p) => decoded.startsWith(p))) offenders.push(`${decl.prop}@${decl.source?.start?.line}행`);
    });
  }
  return offenders;
}

// P2(내부 리뷰) → **I4(18R)에서 폐쇄**. `@property --color-x { … }` 등록 at-rule은 프로퍼티명이
// atrule.params에 있어 decl.prop 기반 스캔 셋 모두가 놓쳤다(선재현 offenders 0). 이제
// findProtectedPropertyRegistrations가 findProtectedDeclarations(핀 5파일·P4 styles/ 전체 스윕)와
// structuralGate 양쪽에 배선돼 있다. **남는 명시 예외**: JS 런타임 `CSS.registerProperty({name:
// '--color-x', …})`는 CSS 텍스트가 아니라 이 정적 게이트의 입력 인벤토리(styles/**/*.{scss,css}) **밖**
// 이다 — 아래 "명시 예외 전수" describe가 이 범위를 문서·단정으로 고정한다(현재 레포 사용처 0건).

// I1(19R) — 한 블록의 "유일 선언 AST 값" 맵. shape contract(structuralGate)가 보호 토큰 블록당 1선언·
// !important 금지를 이미 강제했으므로, cascade를 계산할 필요 없이 그 유일 선언의 값을 그대로 읽는다
// (17R가 폐기한 cascade 재구현으로 돌아가지 않는다). 이전 buildDarkValues는 reduceEffectiveDecls로
// cascade winner를 **계산**했는데, 그건 "다른 baseline이 cascade에 취약"하다는 진단의 정확한 대상이었다.
// prop 키는 "--" 접두를 뗀 형태(예: "color-bg"). decodeCssIdentifier로 escaped 이름을 실이름으로 복원해
// 읽는다(shape contract의 중복 그룹핑과 동일 경로). custom property가 아닌 선언(color-scheme 등)은 제외.
function buildBlockValues(rule) {
  const values = {};
  rule.walkDecls((decl) => {
    const name = decodeCssIdentifier(decl.prop);
    if (!name.startsWith('--')) return;
    values[name.slice(2)] = cssTrim(decl.value);
  });
  return values;
}
// 라이트/다크 블록 baseline — structuralGate가 shape contract를 강제하므로, 중복·!important가 있으면
// 여기 도달하기 전에 throw한다(= 잘못된 baseline을 읽지 않는다). LIGHT_BASELINE·SHADOW_XS_BASELINE·
// 다크 대비 단정 전부가 이 두 진입점을 공유한다(로직 중복·drift 방지).
function buildLightValues(themesCss) {
  return buildBlockValues(structuralGate(themesCss).lightRule);
}
function buildDarkValues(themesCss) {
  return buildBlockValues(structuralGate(themesCss).darkRule);
}

// I1(20R) — 디코딩 AST 키 맵(단일 원천). structuralGate가 3블록·shape를 강제한 뒤 각 블록의 custom
// property 키를 buildBlockValues(decodeCssIdentifier)로 실이름 복원해 수집한다 — shape·대칭·배타성·
// baseline이 전부 이 한 경로를 공유한다(raw 정규식 키 집합 파생 폐기). escaped 선행하이픈/hex escape가
// 라이트를 덮어써도 실이름으로 복원돼 배타성 교집합에 잡힌다(위 'I1(20R)' describe가 선재현↔RED 고정).
// 키는 buildBlockValues와 동일하게 `--` 접두를 뗀 형태(예: 'color-bg').
function decodedThemeKeySets(themesCss) {
  const { lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  const keys = (rule) => new Set(Object.keys(buildBlockValues(rule)));
  return { light: keys(lightRule), dark: keys(darkRule), aliases: keys(aliasRule) };
}
// 실 _themes.scss 파생 — 이전 raw 정규식 `const [light,dark,aliases]`를 대체한다. 모든 소비처
// (대칭·배타성·브리지/var 커버리지)가 이 디코딩 집합을 쓴다. 실 파일엔 escape가 없어 값은 동일(GREEN 유지).
const { light, dark, aliases } = decodedThemeKeySets(css);

// ─────────────────────────────────────────────────────────────────────────────
// I1(22R) — color-scheme 구조 계약. 21R manifest(buildBlockValues)는 **custom property만** 수집해
// (디코딩값 `--` 시작 아닌 선언 제외) 같은 블록의 `color-scheme` 값이 무방비였다: 외부 검수 격리 실증에서
// `:root{color-scheme:light}` ↔ `html[data-theme=dark]{color-scheme:dark}` 값 swap이 461/461 통과했다
// (토큰 색은 유지되나 **네이티브 입력 컨트롤·스크롤바의 라이트/다크가 반대로 적용**되는 실제 제품 회귀).
// 브라우저 의미론 모델을 추가하지 않고(17R 교훈) 세 블록의 non-custom-property 선언을 **구조 계약**으로만
// 좁게 고정한다:
//   · light 블록: `color-scheme: light` 정확히 1개
//   · dark 블록 : `color-scheme: dark`  정확히 1개
//   · alias 블록: `color-scheme` 없음
//   · 그 외 — 중복·삭제(부재)·!important·color-scheme 아닌 다른 일반 선언 = RED
//     (테마 블록의 non-custom-property 선언은 color-scheme 외 등장 자체가 offender다).
// 값은 리터럴이라 디코딩/파싱 불요. 블록 3판정은 structuralGate를 **재사용**한다(새 블록 파서 없음).
// custom property(디코딩값 `--` 시작)는 manifest·shape contract가 담당하므로 여기선 손대지 않는다.
// structuralGate 본체에 넣지 않고 **인접 전용 단정**으로 둔다 — 다른 mutation describe의 합성 SCSS는
// color-scheme를 안 실어서, 게이트에 병합하면 그 describe들이 전부 throw로 깨진다(현행 461 계약 보존).
const COLOR_SCHEME_CONTRACT = [
  ['라이트', 'light'],
  ['다크', 'dark'],
  ['별칭', null], // color-scheme 금지
];
function colorSchemeOffenders(themesCss) {
  const { lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  const rules = { 라이트: lightRule, 다크: darkRule, 별칭: aliasRule };
  const offenders = [];
  for (const [blockName, expected] of COLOR_SCHEME_CONTRACT) {
    const schemeDecls = [];
    rules[blockName].walkDecls((decl) => {
      const name = decodeCssIdentifier(decl.prop);
      if (name.startsWith('--')) return; // custom property는 manifest/shape가 담당
      if (name.toLowerCase() !== 'color-scheme') {
        offenders.push(`${blockName} 블록 비허용 일반 선언 ${decl.prop}@${decl.source?.start?.line}행`);
        return;
      }
      schemeDecls.push({ value: cssTrim(decl.value).toLowerCase(), important: !!decl.important, line: decl.source?.start?.line });
    });
    if (expected === null) {
      for (const d of schemeDecls) offenders.push(`${blockName} 블록 color-scheme 금지인데 존재(${d.line}행)`);
      continue;
    }
    if (schemeDecls.length === 0) offenders.push(`${blockName} 블록 color-scheme 누락(기대 ${expected})`);
    if (schemeDecls.length > 1) offenders.push(`${blockName} 블록 color-scheme 중복 ${schemeDecls.length}개(${schemeDecls.map((d) => `${d.line}행`).join('·')})`);
    for (const d of schemeDecls) {
      if (d.important) offenders.push(`${blockName} 블록 color-scheme !important(${d.line}행)`);
      if (d.value !== expected) offenders.push(`${blockName} 블록 color-scheme 값 오류: 기대 ${expected}, 실제 ${d.value}(${d.line}행)`);
    }
  }
  return offenders;
}

// ─────────────────────────────────────────────────────────────────────────────
// I1(23R) — root 노드 인벤토리 exact 고정. structuralGate는 root 직속 "rule 개수 3개"만 센다
// (walkRules + parent.type==='root' 필터). 그래서 at-rule(@media/@supports/@layer/@import/@font-face 등)이
// 3블록 앞/뒤/사이에 추가돼도 rootRules에 안 잡혀 통과했다 — 격리 실증: `_themes.scss` 끝에
// `@media (min-width:0px){ :root { color-scheme: dark } }`(항상-참 조건) 추가가 472/472 GREEN인데,
// 그 후행 `:root{color-scheme:dark}`가 **라이트 화면의 네이티브 컨트롤·스크롤바를 실제 dark로** 바꾸는
// 제품 회귀다(정적 _themes.scss 안·exact selector라 범위 밖 아님). selector 의미론 모델을 추가하지 않고
// (17R 교훈) **구조 인벤토리**로만 닫는다: comment 외 root.nodes가 정확히 [lightRule, darkRule, aliasRule]
// 세 identity와 **개수+동일성+순서**로 일치해야 한다. 3블록 판정은 structuralGate 재사용(새 파서 없음).
// colorSchemeOffenders와 같은 이유로 structuralGate 본체가 아닌 **인접 전용 단정**으로 둔다 — 게이트에
// 병합하면 3블록 밖 노드를 의도적으로 실어 특정 throw 메시지(/보호 토큰|3블록/ 등)를 단정하는 다른
// describe들이 깨진다(현행 472 계약 보존). structuralGate가 count/shape로 **먼저 throw**하는 mutation
// (4번째 rule 등)은 이 함수 진입 전에 이미 RED다. 같은 "count≠identity" 처방은 19R I2가 CORPUS를
// `length >= 90` count에서 순서 고정 exact manifest로 바꾼 것과 동일 계열이다.
// ─────────────────────────────────────────────────────────────────────────────
// postcss 노드 1개를 사람이 읽을 타입 라벨로. rootInventoryOffenders(root 직속)와 ruleChildTypeOffenders
// (블록 직속 자식)가 공유한다(로컬 중복 제거) — 둘 다 "이 위치에 있으면 안 되는 노드"를 지목한다.
function describeCssNode(n) {
  return n.type === 'rule' ? `rule ${n.selector}`
    : n.type === 'atrule' ? `@${n.name}${n.params ? ` ${n.params}` : ''}`
      : n.type === 'decl' ? `decl ${n.prop}` : n.type;
}
function rootInventoryOffenders(themesCss) {
  const { root, lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  const expected = [lightRule, darkRule, aliasRule];
  const meaningful = root.nodes.filter((n) => n.type !== 'comment');
  const offenders = [];
  if (meaningful.length !== expected.length) {
    offenders.push(
      `root 직속 의미 노드 ${meaningful.length}개(기대 ${expected.length}, comment 제외): ` +
      meaningful.map((n) => `${describeCssNode(n)}@${n.source?.start?.line}행`).join(', '),
    );
  }
  meaningful.forEach((node, i) => {
    if (node !== expected[i]) {
      offenders.push(`root 인덱스 ${i} 노드가 3블록 identity와 불일치: ${describeCssNode(node)}@${node.source?.start?.line}행`);
    }
  });
  return offenders;
}

// ─────────────────────────────────────────────────────────────────────────────
// I2(24R) — rule→직접 자식 우주 고정. rootInventoryOffenders(23R)는 root **직속 노드**만 exact 고정한다.
// 그런데 colorSchemeOffenders·structuralGate shape·buildBlockValues는 전부 `rule.walkDecls()` **재귀**라
// 3블록 안 어딘가 중첩된 노드의 선언을 그 블록의 직접 선언처럼 집계했다. 격리 실증(raw/native-nesting CSS):
//   :root { --color-bg:#fff; @media (min-width:99999px) { color-scheme:light } }
// → root 3-rule 통과(중첩 @media는 top-level 노드가 아니라 rootInventoryOffenders도 못 봄)·재귀 walker상
//   color-scheme:light 1개 인정(colorSchemeOffenders GREEN)·shape/manifest 정상 — 그런데 media 불일치 시
//   라이트 root에 color-scheme 미적용(계약이 실제와 어긋나는 false-green). Sass 1.97.3 경유는 중첩 @media를
//   hoist해 top-level at-rule로 빼므로 rootInventoryOffenders(23R)가 RED로 잡지만(실측), **raw CSS(native
//   nesting)는 hoist 없이 중첩 유지**라 그 방어가 성립 안 한다(실측: 중첩 노드의 parent가 @media/nested-rule).
// 처방(브라우저 의미론 모델 추가 없이, 17R 교훈): 세 legit rule 각각에서 **comment 제외 직접 자식이 전부
// `decl`인지** 구조로 고정한다 — nested rule/nested at-rule(@media/@supports/@layer 등) 등장 = offender.
// 이로써 root(23R)→rule 자식 타입(24R)→decl 분할(19~22R)→값(21R) 귀납이 실제 코드와 일치하고, 위 세
// 재귀 walker가 중첩 노드를 직접 선언으로 오인할 여지 자체가 사라진다(그 재귀들의 공동 backstop).
// rootInventoryOffenders와 같은 이유로 structuralGate 본체가 아닌 **인접 전용 단정**으로 둔다 — 3블록 판정은
// structuralGate 재사용(새 파서 없음). structuralGate가 count/shape/보호토큰으로 **먼저 throw**하는 mutation은
// 이 함수 진입 전에 이미 RED다.
// ─────────────────────────────────────────────────────────────────────────────
function ruleChildTypeOffenders(themesCss) {
  const { lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  const offenders = [];
  for (const [blockName, rule] of [['라이트', lightRule], ['다크', darkRule], ['별칭', aliasRule]]) {
    for (const child of rule.nodes) {
      if (child.type === 'comment') continue; // comment는 선언 아님 — cascade에 무영향이라 예외
      if (child.type !== 'decl') {
        offenders.push(`${blockName} 블록 직접 자식이 decl 아님(중첩 노드는 재귀 walker가 직접 선언으로 오인): ${describeCssNode(child)}@${child.source?.start?.line}행`);
      }
    }
  }
  return offenders;
}

describe('_themes.scss 구조 계약 — flat 3블록 강제 (selector 매칭→구조 게이트 전환, 9라운드)', () => {
  it('실 파일이 3블록 계약을 만족한다(형태·순서·보호 토큰 3블록 밖 배타성)', () => {
    expect(() => structuralGate(css)).not.toThrow();
  });
});

describe('3블록 내 모든 custom property는 보호 접두 3종 중 하나 (P3 — 역방향 완전성)', () => {
  it('라이트/다크/별칭 블록의 모든 --custom-property가 --color-/--track-/--shadow- 중 하나로 시작한다', () => {
    const { lightRule, darkRule, aliasRule } = structuralGate(css);
    const offenders = findUnprotectedDeclarations([lightRule, darkRule, aliasRule]);
    expect(
      offenders,
      `보호 접두 밖 토큰 발견 — 새 토큰 패밀리면 PROTECTED_TOKEN_PREFIXES에 추가하라: ${offenders.join('; ')}`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I2(18R) — canonical opaque layer가 참조하는 `--shadow-xs`의 **값 자체**를 exact baseline으로 고정한다.
// 층 1은 `var(--shadow-xs)`를 "완전 그림자로 확장되는 불투명 레이어"로 **전제**하고 통과시킨다. 그
// 전제는 토큰 값에 달려 있는데 이전엔 아무도 검사하지 않았다: `_themes.scss`에서 `--shadow-xs: none`
// 으로 바꾸면 실 CSS가 `box-shadow: none, inset …`이 되어 **Chrome 계산값이 none**(레이어 문법 위반으로
// 선언 전체 폐기)인데도 선언 문자열은 그대로라 296/296 GREEN이었다. LIGHT_BASELINE과 동일한 방식으로
// 라이트·다크 두 값을 리터럴 고정한다 — 값이 바뀌면(none·무효값·톤 변경) 여기서 즉시 RED다.
// ─────────────────────────────────────────────────────────────────────────────
// I1(21R): 리터럴 중복 제거 — THEME_VALUE_MANIFEST 단일 원천에서 파생(값 동일, GREEN 유지).
const SHADOW_XS_BASELINE = {
  light: THEME_VALUE_MANIFEST.light['shadow-xs'],
  dark: THEME_VALUE_MANIFEST.dark['shadow-xs'],
};
describe('--shadow-xs exact baseline (I2 — canonical opaque layer 전제 보호)', () => {
  it('canonical opaque layer는 정확히 var(--shadow-xs) 하나다(전제의 대상 고정)', () => {
    expect(CANON_SHADOW_OPAQUE_LAYER).toBe('var(--shadow-xs)');
  });
  it('라이트 값이 실측 리터럴과 일치 — none/무효값 치환 시 RED', () => {
    // I1(19R): .exec 첫 매치(선재현 우회 지점) 대신 shape 강제 유일 선언 경로(buildLightValues)로 읽는다.
    expect(buildLightValues(css)['shadow-xs']).toBe(SHADOW_XS_BASELINE.light);
  });
  it('다크 값이 실측 리터럴과 일치 — none/무효값 치환 시 RED', () => {
    expect(buildDarkValues(css)['shadow-xs']).toBe(SHADOW_XS_BASELINE.dark);
  });
  it('두 값 모두 파싱 가능한 그림자 값이다(빈 값·none류 회귀 이중 방어)', () => {
    for (const [k, v] of Object.entries(SHADOW_XS_BASELINE)) {
      expect(v, k).toMatch(/^0 1px 2px rgba\(0, 0, 0, 0\.[0-9]+\)$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I1(21R) — 전체 테마 값 manifest 검증 + 선재현↔RED mutation. buildBlockValues(shape 강제 유일 선언 값)를
// 3블록 전부에 적용해 {key,value} 전체를 THEME_VALUE_MANIFEST 단일 원천과 대조한다. LIGHT_BASELINE/
// SHADOW_XS_BASELINE은 이 manifest에서 파생되므로(위) 부분 baseline이 곧 이 원천의 부분집합이다.
// ─────────────────────────────────────────────────────────────────────────────
function themeValueManifest(themesCss) {
  const { lightRule, darkRule, aliasRule } = structuralGate(themesCss);
  return {
    light: buildBlockValues(lightRule),
    dark: buildBlockValues(darkRule),
    aliases: buildBlockValues(aliasRule),
  };
}

describe('전체 테마 값 manifest — light/dark/alias 전 토큰 {key,value} 단일 원천 고정 (I1 21R)', () => {
  const actual = themeValueManifest(css);
  it('실 _themes.scss 3블록 값 전체가 manifest와 정확히 일치한다 (deep-equal — 무결성 잠금)', () => {
    // toEqual은 키·값 양방향 exact 대조라 (a) 값 변경 (b) 토큰 추가/삭제 (c) manifest 미고정 토큰을 전부
    // 잡는다. 라이트·다크 `--track-paper` transparent 회귀가 여기서 RED가 된다(선재현: 부분 baseline은 통과).
    expect(actual).toEqual(THEME_VALUE_MANIFEST);
  });
  it('블록별 토큰 커버리지 — manifest가 buildBlockValues 키 집합을 정확히 덮는다 (미고정 토큰 0)', () => {
    // 적대적 자가 재검토: 값이 고정되지 않은 토큰이 하나라도 있으면 여기서 드러난다(대칭 커버리지 대조).
    // deep-equal(위)의 부분집합이지만 독립 신호로 남긴다 — 본 assertion이 약화돼도 3블록 키셋을 각각 지킨다.
    // 카디널리티는 하드코딩하지 않고 manifest(단일 원천)에서 파생 — 토큰 증감 시 손으로 동기화할 리터럴 없음.
    for (const block of ['light', 'dark', 'aliases']) {
      expect(Object.keys(actual[block]).sort(), block).toEqual(Object.keys(THEME_VALUE_MANIFEST[block]).sort());
    }
  });
  it('부분 baseline 뷰(LIGHT_BASELINE·SHADOW_XS_BASELINE)는 전체 manifest 키의 부분집합이다 (통합·중복 제거 확인)', () => {
    // 부분 baseline은 이제 manifest에서 파생되므로 리터럴 중복이 없다 — orphan 키(=undefined 파생) 0을 단정한다.
    const lightKeys = new Set(Object.keys(THEME_VALUE_MANIFEST.light));
    for (const k of LIGHT_BASELINE_KEYS) expect(lightKeys.has(k), k).toBe(true);
    expect(Object.values(LIGHT_BASELINE).every((v) => v !== undefined)).toBe(true);
    expect('shadow-xs' in THEME_VALUE_MANIFEST.light).toBe(true);
    expect('shadow-xs' in THEME_VALUE_MANIFEST.dark).toBe(true);
  });
});

describe('I1(21R) manifest 선재현↔RED mutation — 값 기준 무결성(소스 무관)', () => {
  // 합성 3블록 SCSS를 compileString→structuralGate→buildBlockValues로 **실제 컴파일 경로 그대로** 통과시켜
  // base manifest를 얻고, 각 mutation이 deep-equal(=무결성 게이트)에서 RED/GREEN으로 갈리는 지점을 고정한다.
  // `#{$_s}`(보간)와 `#F9FAFB`(리터럴)가 같은 값으로 컴파일되므로 "소스 표현만 다르면 GREEN"이 실증된다.
  const synth = (o = {}) => {
    const { tpL = '#{$_s}', tpD = '#17181C', aliasVal = 'var(--color-bg)', bgL = '#FFFFFF' } = o;
    return `$_s: #F9FAFB;
      :root { color-scheme: light; --color-bg: ${bgL}; --track-paper: ${tpL}; --shadow-xs: 0 1px 2px rgba(0,0,0,0.04); }
      html[data-theme='dark'] { --color-bg: #0E0F11; --track-paper: ${tpD}; --shadow-xs: 0 1px 2px rgba(0,0,0,0.4); }
      :root { --color-alias: ${aliasVal}; }`;
  };
  const manifestOf = (o) => themeValueManifest(compileString(synth(o)).css);
  const base = manifestOf();

  it('base 합성이 실 파이프라인(compile→structuralGate→buildBlockValues)을 통과한다', () => {
    expect(base.light['track-paper']).toBe('#F9FAFB');   // #{$_s} 보간 결과
    expect(base.dark['track-paper']).toBe('#17181C');
    expect(base.aliases['color-alias']).toBe('var(--color-bg)'); // 별칭 참조 문자열 그대로
  });
  it('① 라이트 값만 변경 → manifest deep-equal RED (다크는 격리)', () => {
    const mut = manifestOf({ tpL: '#EEEEEE' });
    expect(mut).not.toEqual(base);
    expect(mut.dark).toEqual(base.dark);
  });
  it('② 다크 값만 변경 → RED (라이트는 격리)', () => {
    const mut = manifestOf({ tpD: '#222222' });
    expect(mut).not.toEqual(base);
    expect(mut.light).toEqual(base.light);
  });
  it('③ 별칭(var 참조 문자열) 값만 변경 → RED', () => {
    const mut = manifestOf({ aliasVal: 'var(--color-surface)' });
    expect(mut).not.toEqual(base);
    expect(mut.aliases['color-alias']).toBe('var(--color-surface)');
  });
  it('④ --track-paper 양쪽 동일 오값(transparent) → RED (제품 회귀 — 부분 baseline은 GREEN이었다)', () => {
    const mut = manifestOf({ tpL: 'transparent', tpD: 'transparent' });
    expect(mut).not.toEqual(base);                       // ← 전체 manifest는 RED
    expect(mut.light['track-paper']).toBe('transparent');
    expect(mut.dark['track-paper']).toBe('transparent');
    // 선재현(왜 부분 baseline이 놓쳤나): (a) 키 대칭 통과(양 블록 동일 키셋) (b) LIGHT_BASELINE에 track-paper 없음.
    expect(Object.keys(mut.light).sort()).toEqual(Object.keys(base.light).sort()); // 옛 대칭 게이트 GREEN
    expect(LIGHT_BASELINE['track-paper']).toBeUndefined();                          // 옛 부분 baseline 미검사
    expect('track-paper' in THEME_VALUE_MANIFEST.light).toBe(true);                 // 이제 전체 manifest가 고정
    expect('track-paper' in THEME_VALUE_MANIFEST.dark).toBe(true);
  });
  it('⑤ Sass 표현만 변경·컴파일 값 동일 → GREEN (값 기준, 소스 무관)', () => {
    const mut = manifestOf({ tpL: '#F9FAFB' }); // `#{$_s}` → 리터럴, 둘 다 #F9FAFB로 컴파일
    expect(mut).toEqual(base);
  });
});

describe('color-scheme 구조 계약 — 세 블록 non-custom-property 선언 고정 (I1 22R)', () => {
  it('실 _themes.scss: light=color-scheme:light·dark=color-scheme:dark·alias=없음, 그 외 일반 선언 0 (offender 0)', () => {
    expect(colorSchemeOffenders(css)).toEqual([]);
  });
  it('적대적 재검토: 세 블록의 non-custom-property 선언은 color-scheme뿐이다(값 미검증 다른 일반 선언 부재)', () => {
    // 같은 클래스의 미래 회귀 방지 — 블록에 color-scheme 외 non-custom-property 선언이 실제로 있는지 확인.
    // 있으면 계약(COLOR_SCHEME_CONTRACT)에 포함해야 하지만, 현행 3블록엔 color-scheme 외 일반 선언이 없다.
    const { lightRule, darkRule, aliasRule } = structuralGate(css);
    const nonCustom = (rule) => {
      const out = [];
      rule.walkDecls((d) => { const n = decodeCssIdentifier(d.prop); if (!n.startsWith('--')) out.push(n.toLowerCase()); });
      return out;
    };
    expect(nonCustom(lightRule)).toEqual(['color-scheme']);
    expect(nonCustom(darkRule)).toEqual(['color-scheme']);
    expect(nonCustom(aliasRule)).toEqual([]);
  });
});

describe('I1(22R) color-scheme 선재현↔RED mutation — manifest 밖 non-custom-property 회귀', () => {
  // 합성 3블록 SCSS를 compileString→(structuralGate 재사용)→colorSchemeOffenders로 실제 컴파일 경로 그대로
  // 통과시켜, swap/delete/duplicate/!important 4형태가 값 manifest에는 안 보이고(선재현: 현행 461 통과 경로가
  // 무방비) color-scheme 계약에서만 RED로 갈리는 지점을 고정한다.
  const synth = (o = {}) => {
    const { lightScheme = 'color-scheme: light;', darkScheme = 'color-scheme: dark;', aliasScheme = '', lightExtra = '' } = o;
    return `:root { ${lightScheme} --color-bg: #FFFFFF; --shadow-xs: 0 1px 2px rgba(0,0,0,0.04); ${lightExtra} }
      html[data-theme='dark'] { ${darkScheme} --color-bg: #0E0F11; --shadow-xs: 0 1px 2px rgba(0,0,0,0.4); }
      :root { ${aliasScheme} --color-alias: var(--color-bg); }`;
  };
  const compiledOf = (o) => compileString(synth(o)).css;
  const offendersOf = (o) => colorSchemeOffenders(compiledOf(o));
  const baseCss = compiledOf();

  it('base 합성이 color-scheme 계약을 통과한다(offender 0)', () => {
    expect(offendersOf()).toEqual([]);
  });

  // 선재현(왜 현행 461이 무방비였나): swap은 custom property만 수집하는 값 manifest에 안 보인다.
  it('선재현: light↔dark swap이 값 manifest deep-equal에는 GREEN(buildBlockValues가 custom property만 수집)', () => {
    const swapped = compiledOf({ lightScheme: 'color-scheme: dark;', darkScheme: 'color-scheme: light;' });
    expect(themeValueManifest(swapped)).toEqual(themeValueManifest(baseCss)); // ← 옛 값 게이트 blind (false-green)
  });

  it('① swap(light↔dark 값) → color-scheme 계약 RED(양쪽 값 오류)', () => {
    const offs = offendersOf({ lightScheme: 'color-scheme: dark;', darkScheme: 'color-scheme: light;' });
    expect(offs.length).toBeGreaterThan(0);
    expect(offs.join(' ')).toMatch(/라이트 블록 color-scheme 값 오류/);
    expect(offs.join(' ')).toMatch(/다크 블록 color-scheme 값 오류/);
  });
  it('② delete(light color-scheme 삭제) → RED(누락)', () => {
    expect(offendersOf({ lightScheme: '' }).join(' ')).toMatch(/라이트 블록 color-scheme 누락/);
  });
  it('③ duplicate(light color-scheme 2개) → RED(중복)', () => {
    expect(offendersOf({ lightScheme: 'color-scheme: light; color-scheme: light;' }).join(' ')).toMatch(/라이트 블록 color-scheme 중복 2개/);
  });
  it('④ !important(light color-scheme !important) → RED', () => {
    expect(offendersOf({ lightScheme: 'color-scheme: light !important;' }).join(' ')).toMatch(/라이트 블록 color-scheme !important/);
  });
  it('⑤ alias 블록에 color-scheme 등장 → RED(별칭 금지)', () => {
    expect(offendersOf({ aliasScheme: 'color-scheme: dark;' }).join(' ')).toMatch(/별칭 블록 color-scheme 금지인데 존재/);
  });
  it('⑥ 테마 블록에 color-scheme 아닌 다른 일반 선언(accent-color) → RED(비허용 일반 선언)', () => {
    expect(offendersOf({ lightExtra: 'accent-color: red;' }).join(' ')).toMatch(/라이트 블록 비허용 일반 선언 accent-color/);
  });
});

describe('_themes.scss root 노드 인벤토리 exact — comment 외 root.nodes == [light,dark,alias] identity (I1 23R)', () => {
  it('실 _themes.scss: comment 외 root 직속 노드가 정확히 3블록 identity 세 개(개수+동일성+순서, offender 0)', () => {
    expect(rootInventoryOffenders(css)).toEqual([]);
  });
  it('적대적 재검토: 인벤토리는 개수가 아니라 세 rule identity(===)를 본다 (count-only 아님)', () => {
    // 개수(3)가 맞아도 다른 노드로 대체되면 identity 불일치로 잡힌다는 것을 실 파일에서 명시한다.
    const { root, lightRule, darkRule, aliasRule } = structuralGate(css);
    const meaningful = root.nodes.filter((n) => n.type !== 'comment');
    expect(meaningful.length).toBe(3);
    expect(meaningful[0]).toBe(lightRule); // 참조 동일(===)
    expect(meaningful[1]).toBe(darkRule);
    expect(meaningful[2]).toBe(aliasRule);
  });
});

describe('I1(23R) root 인벤토리 선재현↔RED mutation — at-rule/4번째/순서 (count-only 게이트가 놓친 구멍)', () => {
  const OK3 = `:root{--color-bg:#fff}html[data-theme='dark']{--color-bg:#000}:root{--color-alias:1}`;
  // 아래 5종은 rootRules 개수 3을 유지하고 3블록 밖 선언(color-scheme)도 보호 접두가 아니라
  // structuralGate가 **통과**한다(현행 count-only 게이트의 false-green). 인벤토리만 RED로 갈린다.
  const passesGateButExtraNode = {
    '@media 추가':    `${OK3}@media (min-width:0px){:root{color-scheme:dark}}`,
    '@supports 추가': `${OK3}@supports (display:block){:root{color-scheme:dark}}`,
    '@layer 추가':    `${OK3}@layer theme{:root{color-scheme:dark}}`,
    '@import 추가':   `${OK3}@import "x.css";`,
    '순서 뒤섞기(at-rule 선두)': `@media (min-width:0px){:root{color-scheme:dark}}${OK3}`,
  };
  it.each(Object.entries(passesGateButExtraNode))(
    '선재현: %s → structuralGate는 여전히 통과(count-only blind, false-green)',
    (_l, mutCss) => { expect(() => structuralGate(mutCss)).not.toThrow(); },
  );
  it.each(Object.entries(passesGateButExtraNode))(
    'RED: %s → rootInventoryOffenders offender>0(3블록 밖 노드 감지)',
    (_l, mutCss) => { expect(rootInventoryOffenders(mutCss).length).toBeGreaterThan(0); },
  );
  it('4번째 rule 추가 → structuralGate가 count(정확히 3개)로 먼저 throw(인벤토리 진입 전 RED)', () => {
    const mut = `${OK3}:root{color-scheme:dark}`;
    expect(() => structuralGate(mut)).toThrow(/정확히 3개|3블록/);
    expect(() => rootInventoryOffenders(mut)).toThrow(); // structuralGate throw를 전파
  });
  it('GREEN 대조: comment 추가(선두·말미·블록 사이)는 무의미 노드라 offender 0', () => {
    expect(rootInventoryOffenders(`/* lead */${OK3}`)).toEqual([]);
    expect(rootInventoryOffenders(`${OK3}/* tail */`)).toEqual([]);
    expect(rootInventoryOffenders(
      `:root{--color-bg:#fff}/* mid */html[data-theme='dark']{--color-bg:#000}:root{--color-alias:1}`,
    )).toEqual([]);
  });
});

describe('_themes.scss rule 직접 자식 타입 exact — 세 블록 직접 자식 전부 decl(comment 제외) (I2 24R)', () => {
  it('실 _themes.scss: 라이트/다크/별칭 블록 직접 자식에 nested rule/at-rule 없음(offender 0)', () => {
    expect(ruleChildTypeOffenders(css)).toEqual([]);
  });
  it('적대적 재검토: 세 블록 직접 자식은 comment를 빼면 전부 decl 타입이다(중첩 노드 부재)', () => {
    // 재귀 walkDecls가 직접 선언으로 오인할 수 있는 중첩 노드가 실제로 있는지 직접 자식 타입으로 확인한다.
    const { lightRule, darkRule, aliasRule } = structuralGate(css);
    const childTypes = (rule) => rule.nodes.filter((n) => n.type !== 'comment').map((n) => n.type);
    for (const rule of [lightRule, darkRule, aliasRule]) {
      expect(new Set(childTypes(rule))).toEqual(new Set(['decl']));
    }
  });
});

describe('I2(24R) rule 자식 우주 선재현↔RED mutation — 재귀 walkDecls 과잉 인정(raw native-nesting)', () => {
  // structuralGate/colorSchemeOffenders/rootInventoryOffenders는 전부 postcss.parse 직접(Sass 미경유)이라
  // native-nesting이 hoist 없이 중첩 유지된다 — 그 상태에서 옛 계약 전부 통과(선재현)↔ruleChildTypeOffenders만
  // RED로 갈리는 지점을 고정한다. light 블록은 **직접** color-scheme 없이 중첩 노드 안에만 color-scheme:light를
  // 실어, 재귀 walker가 그 nested 선언을 라이트의 직접 color-scheme로 오인(false-green)하는 것을 정확히 재현한다.
  const rawThemes = (lightNested) =>
    `:root{--color-bg:#fff;${lightNested}}` +
    `html[data-theme='dark']{color-scheme:dark;--color-bg:#000}` +
    `:root{--color-alias:1}`;
  const nestedNodes = {
    'nested @media(항상-참 min-width:0px)':     '@media (min-width:0px){color-scheme:light}',
    'nested @media(항상-거짓 min-width:99999px)': '@media (min-width:99999px){color-scheme:light}',
    'nested rule(.child)':                       '.child{color-scheme:light}',
    'nested @supports':                          '@supports (display:grid){color-scheme:light}',
  };
  it.each(Object.entries(nestedNodes))(
    '선재현: %s → structuralGate 통과 + rootInventoryOffenders 0 + colorSchemeOffenders 0(재귀 walker false-green)',
    (_l, nested) => {
      const raw = rawThemes(nested);
      expect(() => structuralGate(raw)).not.toThrow();          // 중첩 노드는 3블록 밖 top-level 노드가 아님
      expect(rootInventoryOffenders(raw)).toEqual([]);          // 23R 인벤토리는 top-level만 봐서 blind
      expect(colorSchemeOffenders(raw)).toEqual([]);            // 재귀 walkDecls가 nested color-scheme:light를 라이트 직접으로 오인
    },
  );
  it.each(Object.entries(nestedNodes))(
    'RED: %s → ruleChildTypeOffenders offender>0(라이트 블록 직접 자식에 non-decl)',
    (_l, nested) => {
      const offs = ruleChildTypeOffenders(rawThemes(nested));
      expect(offs.length).toBeGreaterThan(0);
      expect(offs.join(' ')).toMatch(/라이트 블록 직접 자식이 decl 아님/);
    },
  );
  it('브리프 격리 실증(항상-거짓 @media): 옛 전 계약 통과인데 media 불일치 시 라이트 color-scheme 미적용', () => {
    // colorSchemeOffenders는 nested color-scheme:light를 인정(계약 통과)하지만, min-width:99999px는 실뷰포트에서
    // 불일치라 라이트 root에 color-scheme가 실제로는 적용되지 않는다 — 계약↔실제 괴리를 ruleChildTypeOffenders가 닫는다.
    const raw = rawThemes('@media (min-width:99999px){color-scheme:light}');
    expect(colorSchemeOffenders(raw)).toEqual([]);              // 옛 계약 GREEN(false-green)
    expect(ruleChildTypeOffenders(raw).length).toBeGreaterThan(0); // 신 구조 계약 RED
  });
  it('GREEN 대조: comment는 선언 아님 — 직접 color-scheme:light + 블록내 comment는 offender 0', () => {
    const raw = `:root{--color-bg:#fff;/* c */color-scheme:light}` +
      `html[data-theme='dark']{color-scheme:dark;--color-bg:#000}` +
      `:root{--color-alias:1}`;
    expect(() => structuralGate(raw)).not.toThrow();
    expect(colorSchemeOffenders(raw)).toEqual([]);
    expect(ruleChildTypeOffenders(raw)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I1(19R) — baseline은 "유일 선언 AST 값"이다(shape contract). cascade winner를 계산하지 않는다.
// 선재현↔RED 대응표(각 mutation은 수정 전 현행 HEAD에서 372/372 통과 = false-green이었다):
//   (a) 라이트 --shadow-xs 뒤 `none !important` 중복 → SHADOW_XS_BASELINE.light가 .exec 첫 매치라 선행
//       '0 1px 2px…'를 읽어 통과(Chrome 계산값은 none). 이제 중복+important 둘 다 shape offender → throw.
//   (b) 라이트 indicator `transparent !important` 선행 중복 → LIGHT_BASELINE이 Object.fromEntries(후행
//       승리)라 후행 normal을 읽어 통과. 이제 중복+important shape offender → throw.
//   (c) 순서 반전(normal→important, important→normal) 양방향 → 어느 쪽도 중복이라 throw.
// ─────────────────────────────────────────────────────────────────────────────
describe('I1(19R) shape contract — 보호 토큰 블록당 1선언·!important 금지 (선재현↔RED)', () => {
  // 다크/별칭은 정상(각 1선언·important 없음)으로 고정하고 라이트 블록만 변형한다.
  const wrap = (lightBody) => `:root{${lightBody}}html[data-theme=dark]{--color-selected-indicator:#6B7280;--shadow-xs:0 1px 2px rgba(0,0,0,0.4)}:root{--color-b:3}`;
  const OK_LIGHT = '--color-selected-indicator:transparent;--shadow-xs:0 1px 2px rgba(0,0,0,0.04)';

  it('정상 형태(각 보호 토큰 1선언·!important 없음)는 통과하고 유일 선언 값을 읽는다', () => {
    const themes = wrap(OK_LIGHT);
    expect(() => structuralGate(themes)).not.toThrow();
    // 유일 선언 AST 값을 verbatim으로 읽는다(정규화·재포맷 없음 — 입력 그대로).
    expect(buildLightValues(themes)['shadow-xs']).toBe('0 1px 2px rgba(0,0,0,0.04)');
    expect(buildLightValues(themes)['color-selected-indicator']).toBe('transparent');
    expect(buildDarkValues(themes)['shadow-xs']).toBe('0 1px 2px rgba(0,0,0,0.4)');
  });

  it.each([
    ['(a) shadow-xs 뒤 none !important 중복', '--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:none !important'],
    ['(a\') shadow-xs 단순 중복(중요도 없이도 cascade 비자명)', '--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:0 2px 4px rgba(0,0,0,0.04)'],
    ['(b) indicator transparent !important 선행 중복', '--color-selected-indicator:transparent !important;--color-selected-indicator:transparent'],
    ['(b\') indicator 단일 !important', '--color-selected-indicator:transparent !important'],
    ['(c) 순서 normal→important', '--color-selected-indicator:transparent;--color-selected-indicator:red !important'],
    ['(c\') 순서 important→normal', '--color-selected-indicator:red !important;--color-selected-indicator:transparent'],
  ])('shape 위반 %s → structuralGate throw (선재현: 현행 HEAD baseline은 통과)', (_l, body) => {
    expect(() => structuralGate(wrap(body))).toThrow(/shape contract/);
  });

  it('baseline 빌더도 유일 선언 경로 — 라이트 중복 주입 시 buildLightValues가 값을 잘못 읽지 않고 throw', () => {
    const mutated = wrap('--color-bg:#FFFFFF;--shadow-xs:0 1px 2px rgba(0,0,0,0.04);--shadow-xs:none !important');
    expect(() => buildLightValues(mutated)).toThrow(/shape contract/);
  });

  it('escaped 이름 중복도 디코딩해 동일 토큰으로 그룹 — 우회 불가(I3식 이름 비대칭 방지)', () => {
    // raw `--shadow-xs`와 escaped `\--shadow-xs`(디코딩 결과 동일)는 같은 토큰 → 중복 offender.
    expect(() => structuralGate(wrap('--shadow-xs:0 1px 2px rgba(0,0,0,0.04);\\--shadow-xs:none'))).toThrow(/shape contract/);
  });

  it('실 _themes.scss는 shape contract를 만족한다(라이트/다크/별칭 전부 보호 토큰 1선언·!important 0)', () => {
    expect(() => structuralGate(css)).not.toThrow();
  });

  it('비보호 토큰(--x)은 shape contract 대상 아님 — 중복·!important 허용(대칭/역방향 게이트가 별도 처리)', () => {
    // structuralGate는 보호 접두(--color-/--track-/--shadow-)만 shape로 본다. --x 중복은 통과.
    const themes = `:root{--color-a:1;--x:A !important;--x:B}html[data-theme=dark]{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(themes)).not.toThrow();
  });
});

describe('다크 selected-indicator 값 시맨틱 고정 (SC 1.4.11 비텍스트 대비 3:1)', () => {
  // 9라운드: dark 블록의 존재·유일성·root-직속 여부·형태(selector 문자열)는 이제 structuralGate
  // (flat 3블록 계약, 파일 상단 참고)가 구조적으로 보장한다 — 위반 시 이 시점에 즉시 throw(위치
  // 포함 명시 메시지)한다. 구 collectDarkSelectorRules의 selector 열거 방식은 폐기됐다: 그 방식은
  // "감시할 selector 문자열 목록"에 의존해 목록 밖 selector(`:root`, `html[...]:root` 등)로 감싼
  // 우회를 놓쳤지만, structuralGate는 selector가 무엇이든 3블록 밖 보호 토큰 선언 자체를 금지하므로
  // 우회 불가능하다. I1(19R): darkRule "내부"의 중복 선언·!important는 이제 shape contract가 offender로
  // 접으므로(cascade가 자명), buildDarkValues는 cascade를 계산하지 않고 유일 선언 AST 값을 그대로 읽는다
  // (buildBlockValues). 7라운드째 문제였던 "다크 블록 내부 !important 개입"은 값 계산 이전에 structuralGate
  // throw로 막힌다. buildDarkValues는 대칭 구멍 B(아래 --color-input-border 대비 describe)와 공유하는 모듈 헬퍼다.
  const darkValues = buildDarkValues(css);

  // ScopeToggle 실제 인접 합성색 — .MyTasks__ScopeBtn--active의 background를 컴파일된 myTasks
  // CSS에서 postcss AST로 그대로 읽어(하드코딩 금지) 다크 surface 위에 알파 합성한다. bg·surface
  // 단독 대비만으로는 실제 렌더 결과보다 대비가 후하게 나와 회귀를 놓친다(외부 검수 실증: indicator
  // #5F6774일 때 bg 3.36·surface 3.11로 통과하지만 실제 합성색 #1E202E 대비는 2.83으로 실패).
  // 매치 규칙 [0]만 읽던 이전 코드는 같은 selector로 뒤에 다시 오는 override(예: `background:
  // rgba(94,106,210,.2);` 재정의)를 놓치고 stale 값으로 GREEN 처리했다(외부 검수 실증, n시나리오)
  // — effectiveValue로 매치 규칙 전부에 cascade를 적용한 최종값 하나만 쓴다.
  const myTasksRoot = postcss.parse(compiledSiteCss('components/myTasks/myTasks.scss'));
  const scopeBtnActiveRules = findRootRules(myTasksRoot, '.MyTasks__ScopeBtn--active');
  const scopeBgFinal = effectiveValue(scopeBtnActiveRules, new Set(['background']))['background']?.value ?? null;
  // resolveColorValue는 M2(19R)에서 모듈 스코프로 승격됐다(헬퍼 직접 테스트 대상 — 파일 상단 정의).
  // 최종값이 rgba/hex 리터럴이면 그대로, `var(--token)` 참조면 darkValues(shape 강제 유일 선언 값)로 재귀
  // 해석한다. 리터럴도 토큰 참조도 아닌(복합 표현식 등) 값은 null → 호출부 not.toBeNull()이 RED로 떨어뜨린다.
  const scopeBgResolved = resolveColorValue(scopeBgFinal, darkValues);
  const scopeToggleAdjacent = scopeBgResolved != null
    ? compositeOver(scopeBgResolved, darkValues['color-surface'])
    : null;

  // 4개 인접색 각각을 독립된 it()로 단정 — 하나로 합쳐 첫 실패에서 bail하면 이후 신호(특히
  // ScopeToggle 합성색)가 실행조차 안 돼 리포트에서 안 보인다. 분리해두면 어떤 인접색이
  // 얼마의 대비로 얼마나 못 미쳤는지 실패 로그에서 개별적으로 확인할 수 있다.
  const indicator = darkValues['color-selected-indicator'];
  it('vs bg 3:1 이상 — transparent 등으로 되돌리면 파싱 실패로 RED', () => {
    expect(contrastOverBg(indicator, darkValues['color-bg']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs surface 3:1 이상', () => {
    expect(contrastOverBg(indicator, darkValues['color-surface']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs surface-hover 3:1 이상', () => {
    expect(contrastOverBg(indicator, darkValues['color-surface-hover']), `indicator=${indicator}`).toBeGreaterThanOrEqual(3);
  });
  it('vs ScopeToggle 실제 합성색(반투명 active 배경 on 다크 surface) 3:1 이상', () => {
    expect(scopeToggleAdjacent, `ScopeToggle 배경 최종값 해석 실패: scopeBgFinal=${scopeBgFinal}`).not.toBeNull();
    expect(contrastOverBg(indicator, scopeToggleAdjacent), `indicator=${indicator} on scopeToggleAdjacent=${JSON.stringify(scopeToggleAdjacent)}`).toBeGreaterThanOrEqual(3);
  });
});

describe('다크 컨트롤 경계·accent 대비 고정(WCAG 1.4.3/1.4.11)', () => {
  // indicator(위 describe)만 대비 단정이 있었고 컨트롤 경계 토큰 자체(승격핀 6곳 중 5곳이 실제로
  // 소비하는 --color-input-border)는 무보호였다 — 다크 값을 --color-border(#26282E, 비-input 톤)로
  // 강등해도 대비 단정이 하나도 없어 전 테스트가 GREEN이었다(Task 6 "다크 대비 보정"의 존재 이유가
  // 무너지는 회귀). 알파 선합성 경로(compositeOver/contrastOverBg)를 그대로 재사용해 두 토큰 각각을
  // bg·surface·input-bg 3가지 배경과 3:1 이상으로 고정한다.
  const darkValues = buildDarkValues(css);
  const BG_TOKENS = ['color-bg', 'color-surface', 'color-input-bg'];
  const BORDER_TOKENS = ['color-input-border', 'color-input-border-hover'];
  for (const borderToken of BORDER_TOKENS) {
    for (const bgToken of BG_TOKENS) {
      it(`${borderToken} vs ${bgToken} 3:1 이상`, () => {
        expect(
          contrastOverBg(darkValues[borderToken], darkValues[bgToken]),
          `${borderToken}=${darkValues[borderToken]} vs ${bgToken}=${darkValues[bgToken]}`,
        ).toBeGreaterThanOrEqual(3);
      });
    }
  }

  // S3 scrum accent — 텍스트 4.5:1, 컨트롤 경계 3:1 (SC 1.4.3 / 1.4.11). 컨트롤 경계 토큰이
  // 무보호면 다크 강등이 침묵 통과하는 대칭 구멍 B와 동일 구조라 이 describe에 co-locate하고
  // 같은 알파 선합성 경로(contrastOverBg)를 재사용한다(새 describe·헬퍼 없음). 링은 반투명이라
  // contrastOverBg가 color-bg 위에 선합성한 결과로 잰다 — 불투명 원색으로 재지 않는다(14R 패턴).
  const SCRUM_DARK_CONTRAST = [
    ['color-accent-scrum', 'color-accent-scrum-subtle', 4.5], // 틴트 배경 위 accent 텍스트
    ['color-accent-scrum', 'color-input-bg', 4.5],            // 컨트롤 배경 위 accent 텍스트(Chip--on·TodayBtn·탭 on)
    ['color-accent-scrum', 'color-surface', 3],               // 보더/아이콘 vs 표면
    ['color-accent-scrum-border', 'color-surface', 3],        // hover 컨트롤 경계
    ['color-retro-try', 'color-retro-try-bg', 4.5],           // KPT try 헤더
    ['color-error-border-soft', 'color-surface', 3],          // LeaveBtn 컨트롤 경계
    ['color-error-border-soft', 'color-error-bg', 3],         // LeaveBtn hover 시 경계 유지
    ['color-accent-scrum-ring', 'color-bg', 3],               // focus ring 반투명 → bg 위 선합성 후 대비
    ['color-warning-ink', 'color-warning-bg', 4.5],
    ['color-warning-ink-deep', 'color-warning-bg', 4.5],
    ['color-warning-ink-strong', 'color-warning-bg', 4.5],
    ['color-warning', 'color-warning-bg', 3],
    ['color-text-inverse', 'color-primary', 4.5],
    ['color-text-inverse', 'color-primary-hover', 4.5],
    ['color-input-border-hover', 'track-border-soft', 3],
    ['color-accent-scrum', 'color-accent-scrum-wash', 4.5],            // dark-only
    ['color-accent-scrum-border', 'color-accent-scrum-subtle', 3],     // dark-only
  ];
  for (const [fg, bg, ratio] of SCRUM_DARK_CONTRAST) {
    it(`${fg} vs ${bg} ${ratio}:1 이상`, () => {
      expect(
        contrastOverBg(darkValues[fg], darkValues[bg]),
        `${fg}=${darkValues[fg]} vs ${bg}=${darkValues[bg]}`,
      ).toBeGreaterThanOrEqual(ratio);
    });
  }
});

// 게이트 자체 상설 검증 — 이전 라운드들은 각 결함을 "실파일을 임시로 훼손 → vitest 실행 → 복원"하는
// 수동 시뮬로만 검증했다(재현 스크립트가 안 남아 다음 라운드가 같은 결함을 다시 심어도 못 잡았다).
// 여기서는 postcss.parse한 합성 CSS 문자열로 헬퍼(parseColor/structuralGate/findProtectedDeclarations/
// reduceEffectiveDecls + 17R 신설 canonical 매처/층 2 evaluator)를 직접 단정해, 시뮬 재현 없이도 이후
// 라운드의 회귀를 상시 검출한다 — 8·9라운드 외부 검수 대응.
describe('게이트 자체 검증 (synthetic CSS)', () => {
  describe('parseColor — 엄격 CSS number (Important 1)', () => {
    it('trailing dot(1.)은 CSS 불법 number — null', () => {
      expect(parseColor('rgba(107,114,128,1.)')).toBeNull();
    });
    it('스펙 밖 alpha(10)는 파싱되고 clamp로 a=1', () => {
      expect(parseColor('rgba(60,60,60,10)')).toEqual({ r: 60, g: 60, b: 60, a: 1 });
    });
    it('leading dot(.5)은 유효 CSS number', () => {
      expect(parseColor('rgba(0,0,0,.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    });
    it('음수 채널은 애초에 정규식 매치 실패 — null', () => {
      expect(parseColor('rgba(-1,0,0,1)')).toBeNull();
    });
    it('다중 소수점(1.2.3)·빈 채널은 매치 실패 — null', () => {
      expect(parseColor('rgba(1.2.3,0,0,1)')).toBeNull();
      expect(parseColor('rgba(,0,0,1)')).toBeNull();
    });
  });

  describe('structuralGate — flat 3블록 계약 + 보호 토큰 3블록 밖 배타성 (Important, 9라운드)', () => {
    // 검수 실증 우회 ①·②는 둘 다 selector 열거(구 collectDarkSelectorRules)의 "감시 목록에 없는
    // selector"를 타고 들어왔다 — 아래 두 케이스는 그 정확한 재현이다. structuralGate는 selector
    // 문자열이 무엇이든 3블록 밖 보호 토큰 선언 자체를 금지하므로 두 우회 모두 FAIL해야 한다.
    it('정상 3블록이면 통과하고 darkRule을 반환한다', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      const { darkRule } = structuralGate(cssText);
      expect(darkRule.selector).toBe(`html[data-theme='dark']`);
    });
    it('우회① media-:root — :root도 html에 적용되고 important가 승리하는데 선택자 목록 밖이라 놓쳤던 케이스, 이제 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        @media (min-width: 0px) {
          :root { --color-selected-indicator: rgba(0,0,0,0) !important; }
        }
      `;
      expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
    });
    it('우회② @supports dark:root — DARK_SELECTORS 어떤 변형과도 문자열이 달라 놓쳤던 케이스, 이제 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        @supports (display: block) {
          html[data-theme='dark']:root { --color-selected-indicator: rgba(0,0,0,0) !important; }
        }
      `;
      expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
    });
    it('4번째 root 블록이 있으면 블록 개수 불일치로 FAIL', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
        :root { --color-c: 4; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/3블록/);
    });
    it('!important가 후행 non-important를 이긴다(다크 블록 내부 cascade, custom property도 동일 규칙)', () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark'] { --x: A !important; --x: B; }
        :root { --color-b: 3; }
      `;
      const { darkRule } = structuralGate(cssText);
      const state = reduceEffectiveDecls([darkRule], (decl, prop) => prop.startsWith('--'));
      expect(state['--x'].value).toBe('A');
    });

    // synthetic 보충(concern 2, 내부 리뷰) — 순서/형태 오류 각 1건을 명시 FAIL로 단정한다.
    it('블록 순서가 뒤바뀌면(다크가 1번째) FAIL', () => {
      const cssText = `
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-a: 1; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/1번째 블록\(라이트\)/);
    });
    it('블록이 다중 셀렉터(:root, .Sneak)면 단독 :root가 아니므로 FAIL', () => {
      const cssText = `
        :root, .Sneak { --color-a: 1; }
        html[data-theme='dark'] { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/1번째 블록\(라이트\)/);
    });
    it("2번째 블록이 html[data-theme='dark']:root 형태(:root 접미 오염)면 FAIL", () => {
      const cssText = `
        :root { --color-a: 1; }
        html[data-theme='dark']:root { --color-a: 2; }
        :root { --color-b: 3; }
      `;
      expect(() => structuralGate(cssText)).toThrow(/2번째 블록\(다크\)/);
    });
  });

  describe('findProtectedDeclarations — 컴포넌트 보호 토큰 "선언" 금지 (9라운드)', () => {
    it('.Foo{--color-x:red} 처럼 조상 스코프 재선언은 FAIL 대상 목록에 잡힌다', () => {
      const offenders = findProtectedDeclarations('.Foo { --color-x: red; }');
      expect(offenders.length).toBe(1);
      expect(offenders[0]).toMatch(/--color-x/);
    });
    it('var() 참조로 소비만 하면 통과 — 빈 배열', () => {
      const offenders = findProtectedDeclarations('.Foo { border-color: var(--color-x); }');
      expect(offenders).toEqual([]);
    });
  });

  describe('P4 컴파일 기반 스윕 synthetic (Important 1, 10라운드) — 원문 정규식이 놓친 우회 재현', () => {
    // 실 레포는 위반 0건이라 실 스윕(위 "styles/ 전체 컴파일/AST 스윕")만으로는 FAIL 분기가 한 번도
    // 실행되지 않는다 — compileString(파일 I/O 없이 SCSS 문자열을 바로 컴파일)으로 합성 소스를 만들어
    // findProtectedDeclarations/sweepFileForProtectedDeclarations의 FAIL·엣지 경로를 직접 검증한다.
    it('멀티라인 선언(콜론이 다음 줄)도 컴파일 후 AST로 검출 — 원문 같은-줄 정규식은 이 케이스를 놓쳤다', () => {
      const cssText = compileString('.Foo {\n  --color-x\n    : red;\n}\n').css;
      expect(findProtectedDeclarations(cssText)).toHaveLength(1);
    });
    it('블록주석(/* --color-x: red; */) 내부 텍스트는 Comment 노드라 선언으로 오검출 안 함', () => {
      const cssText = compileString('.Foo {\n  /* --color-x: red; */\n  color: blue;\n}\n').css;
      expect(findProtectedDeclarations(cssText)).toEqual([]);
    });
    it('.css 파일(합성, fonts.css 우회 재현) — postcss.parse 직접으로도 보호 토큰 선언 검출', () => {
      const cssText = ':root { --color-selected-indicator: red; }';
      expect(findProtectedDeclarations(cssText)).toEqual(['--color-selected-indicator@1행(위치: :root)']);
    });
    it('소비(var(--color-x))는 선언이 아니므로 무시(기존 findProtectedDeclarations 계약 재확인)', () => {
      const cssText = compileString('.Foo { border-color: var(--color-x); }\n').css;
      expect(findProtectedDeclarations(cssText)).toEqual([]);
    });
    it('sweepFileForProtectedDeclarations — sass 컴파일 실패(존재하지 않는 파일)는 침묵 스킵 대신 offender로 표면화', () => {
      const offenders = sweepFileForProtectedDeclarations('__does-not-exist__.scss');
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatch(/__does-not-exist__\.scss: 컴파일\/파싱 실패/);
    });
  });

  describe('isProtectedSweepTarget — P4 스윕 대상 판정 (Important 2, 11라운드)', () => {
    it('루트 정본 _themes.scss(exact)만 예외 — false', () => {
      expect(isProtectedSweepTarget('_themes.scss')).toBe(false);
    });
    it('중첩 components/example/_themes.scss는 대상 — true (endsWith 우회 없음)', () => {
      expect(isProtectedSweepTarget('components/example/_themes.scss')).toBe(true);
    });
    it('접미 우연 일치 components/rogue_themes.scss도 대상 — true', () => {
      expect(isProtectedSweepTarget('components/rogue_themes.scss')).toBe(true);
    });
    it('fonts.css(.css 커버리지)도 대상 — true', () => {
      expect(isProtectedSweepTarget('fonts.css')).toBe(true);
    });
    it('비 scss/css(예: .js)는 대상 아님 — false', () => {
      expect(isProtectedSweepTarget('components/foo.js')).toBe(false);
    });
  });

  describe('normalizeRawCss — raw .css escaped custom-property 정규화 (Minor, 11라운드)', () => {
    // 원문 raw 파싱은 `--\63 olor-…`(유효 CSS, 실이름 --color-…)를 리터럴 prop으로 남겨 보호 접두 검사를
    // 우회시켰다. Sass CSS-syntax 컴파일로 식별자 escape를 정규화한 뒤 findProtectedDeclarations에 태운다.
    it('escaped 선언(--\\63 olor-…)이 정규화 후 실이름 --color-selected-indicator로 검출된다', () => {
      const norm = normalizeRawCss(':root { --\\63 olor-selected-indicator: red; }');
      const offenders = findProtectedDeclarations(norm);
      expect(offenders).toHaveLength(1);
      expect(offenders[0]).toMatch(/--color-selected-indicator/);
    });
    it('일반(비escape) 보호 선언도 그대로 검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss(':root { --color-x: red; }'))).toHaveLength(1);
    });
    it('--Color-…(대문자)는 case-sensitive 유지 → 보호 접두(--color-) 아니므로 미검출(오검출 방지)', () => {
      expect(findProtectedDeclarations(normalizeRawCss(':root { --Color-x: red; }'))).toEqual([]);
    });
    it('블록주석 안 escaped 선언은 Comment 노드라 미검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss('.Foo { /* --\\63 olor-x: red; */ color: blue; }'))).toEqual([]);
    });
    it('소비(var(--\\63 olor-x))는 선언이 아니라 값이므로 미검출', () => {
      expect(findProtectedDeclarations(normalizeRawCss('.Foo { border-color: var(--\\63 olor-x); }'))).toEqual([]);
    });
  });

  describe('keyIntersection — 별칭·라이트 교집합 판정 (P1 synthetic)', () => {
    it('별칭이 라이트 키를 재선언하면 교집합에 잡힌다(specificity 동일 → 후행 재선언이 침묵 오염)', () => {
      const lightKeys = new Set(['color-a', 'color-b']);
      const aliasKeys = new Set(['color-a', 'color-c']);
      expect(keyIntersection(aliasKeys, lightKeys)).toEqual(['color-a']);
    });
    it('배타적이면 빈 배열', () => {
      expect(keyIntersection(new Set(['color-c']), new Set(['color-a', 'color-b']))).toEqual([]);
    });
  });

  describe('findUnprotectedDeclarations — 보호 접두 역방향 판정 (P3 synthetic)', () => {
    it('보호 접두 밖 토큰(--brand-new)을 검출', () => {
      const root = postcss.parse(':root { --color-a: 1; --brand-new: 2; }');
      const offenders = findUnprotectedDeclarations([root.first]);
      expect(offenders).toEqual(['--brand-new@1행']);
    });
    it('보호 접두 3종만 있으면 빈 배열', () => {
      const root = postcss.parse(':root { --color-a: 1; --track-b: 2; --shadow-c: 3; }');
      expect(findUnprotectedDeclarations([root.first])).toEqual([]);
    });
    it('일반 프로퍼티(color-scheme 등)는 애초에 대상 아님', () => {
      const root = postcss.parse(':root { color-scheme: light; --color-a: 1; }');
      expect(findUnprotectedDeclarations([root.first])).toEqual([]);
    });
  });

  // ── 17R 전환: 아래 4개 describe는 폐기된 grammar 모델 헬퍼(outermostVarTokens·splitTopLevelLayers·
  //    assertVisibleInsetShadowLayer·synthesizeBorderSides 계열)의 단위 단정이었다. **계약 의미는
  //    보존하되** 판정 주체를 canonical 매처/층 2 evaluator로 이관한다 — 각 벡터가 "canonical이 아니라서
  //    RED"임을 그 자체 상태로 단정하므로 기존 계약(중첩 var 미수집·fallback 텍스트 오매치·spread 0
  //    비가시·네 면 소실 등)이 전부 같은 결론으로 유지된다.
  describe('canonical var 원자 — 구 outermostVarTokens/topLevelVarTokens 계약 이관(10~15R 벡터 보존)', () => {
    // 구 계약: "최상위 var()의 첫 인자만 수집, 중첩/fallback·유사 함수명은 미수집".
    // 신 계약: canonical 토큰 참조는 **정확히 `var(--name)`** 뿐이다 — 아래 변종은 전부 비-canonical.
    it.each([
      ['fallback + 중첩 var(10R r5)', 'var(--a, "(", var(--b))'],
      ['값 전체가 문자열', '"var(--x)"'],
      ['비ASCII 접두 함수명(λvar)', 'λvar(--x)'],
      ['식별자 접미 함수명(fakevar)', 'fakevar(--x)'],
      ['escaped 식별자 함수명(fake\\ var)', 'fake\\ var(--x)'],
      ['calc 안 var + 콤마 나열', 'calc(1px + var(--a)), var(--b)'],
      ['fallback 안 escape', 'var(--a, \\(, var(--b))'],
      ['문자열 밖 escaped quote', '\\" , var(--x)'],
      ['콤마 없는 잔여 인자(13R I2a)', 'var(--color-input-border garbage)'],
      ['fallback 있는 var(12R/13R GREEN이었음)', 'var(--x, #ccc)'],
      ['중첩 malformed fallback(14R I3)', 'var(--color-input-border, var(--bad garbage))'],
      ['정상 중첩 fallback(14R I3 대조, 이전 GREEN)', 'var(--color-input-border, var(--fallback))'],
      ['대문자 VAR()(14R I3에서 인정했던 형태)', 'VAR(--x)'],
      ['비ASCII dashed-ident(15R I4)', 'var(--é)'],
      ['언더스코어 dashed-ident(14R I3)', 'var(--_name)'],
      ['escape 포함 이름(15R I4)', 'var(--\\65 x)'],
    ])('%s 는 canonical 토큰 참조가 아니다 → border color 자리에서 RED', (_label, value) => {
      expect(CANON_VAR_REF_RE.test(normalizeDeclValue(value))).toBe(false);
      expect(classifyRelevantDecl('border', `1px solid ${value}`).syntax).toBe('non-canonical');
    });
    it('GREEN(무회귀): 정확한 var(--name)만 canonical 토큰 참조', () => {
      expect(canonicalNeedleToken('var(--color-input-border)')).toBe('color-input-border');
      expect(canonicalNeedleToken(' var(--color-selected-indicator) ')).toBe('color-selected-indicator');
      expect(() => canonicalNeedleToken('var(--x, #ccc)')).toThrow(/canonical/);
    });
  });

  describe('canonical box-shadow 레이어 분해 — 구 splitTopLevelLayers 계약 이관', () => {
    // 기대 갱신(18R I2): 이전엔 임의 토큰(`var(--x)`)도 canonical 레이어였다. 이제 허용 indicator
    // layer는 실측 전체 문자열 하나뿐이라 토큰 이름까지 고정된다.
    it('단일 레이어(핀 실측 전체 문자열)는 레이어 1개로 모델링', () => {
      const layers = canonicalShadowLayers(CANON_SHADOW_INDICATOR_LAYER);
      expect(layers).toHaveLength(1);
      expect(layers[0]).toEqual({ kind: 'inset', offsetX: 0, offsetY: 0, blur: 0, spread: 1, token: 'color-selected-indicator' });
    });
    it('임의 토큰 레이어(inset 0 0 0 1px var(--x))는 더 이상 canonical이 아니다 — 18R I2 축소', () => {
      expect(canonicalShadowLayers('inset 0 0 0 1px var(--x)')).toBeNull();
    });
    it('다중 그림자(HomeTabs 핀)는 최상위 콤마로만 분해 — var() 내부 콤마와 혼동 없음(fallback var는 애초에 canonical 아님)', () => {
      const layers = canonicalShadowLayers('var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)');
      expect(layers.map((l) => l.kind)).toEqual(['opaque-var', 'inset']);
      expect(layers[0].token).toBe('shadow-xs');
      expect(layers[1].token).toBe('color-selected-indicator');
    });
    it('canonical이 아닌 값은 분해 자체를 하지 않는다(null) — 조각이 canonical처럼 보이는 우회 차단', () => {
      expect(canonicalShadowLayers('foo(a, inset 0 0 0 1px var(--t))')).toBeNull();
      expect(canonicalShadowLayers('var(--shadow-xs) , junk')).toBeNull();
      expect(canonicalShadowLayers('none')).toBeNull();
    });
  });

  describe('canonical 인디케이터 가시성 — 구 assertVisibleInsetShadowLayer 계약 이관(10~13R 벡터 보존)', () => {
    const IND = 'color-selected-indicator';
    const ivis = (value) => evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible;
    it('정상 형태(핀 실측 전체 문자열)는 visible', () => {
      expect(ivis(CANON_SHADOW_INDICATOR_LAYER)).toBe(true);
    });
    // 기대 갱신(18R I2, GREEN→RED): `inset 0 0 0 2px var(--…)`는 층 2 가시성 계산상 spread>0이지만
    // **실핀에 없는 전체 문자열**이라 canonical 밖이다. "임의 길이·임의 레이어 조합 허용"이 곧 whitelist를
    // 작은 CSS 문법으로 되돌리는 경로였으므로(I2), 폭 변경도 개발자가 알아야 할 신호로 남긴다.
    it('실핀 밖 spread(2px)는 canonical 밖 — RED(18R I2 축소, 이전 GREEN)', () => {
      expect(ivis(`inset 0 0 0 2px var(--${IND})`)).toBe(false);
    });
    it.each([
      ['var(--t) 단독 레이어(치환 후 불법값이면 선언 무효화)', 'var(--color-selected-indicator)'],
      ['spread 0(렌더 폭 없음)', 'inset 0 0 0 0 var(--color-selected-indicator)'],
      ['inset 키워드 없음(outset 그림자)', '0 0 0 2px var(--color-selected-indicator)'],
      ['length 4개 미만(spread 없음)', 'inset 0 0 2px var(--color-selected-indicator)'],
      ['unitless 비영 spread(불법 CSS)', 'inset 0 0 0 5 var(--color-selected-indicator)'],
      ['1% spread(% 불허)', 'inset 0 0 0 1% var(--color-selected-indicator)'],
      ['negative blur', 'inset 0 0 -1px 1px var(--color-selected-indicator)'],
      ['length 5개(개수 초과)', 'inset 0 0 0 1px 2px var(--color-selected-indicator)'],
      ['stray word 잔여(junk)', 'inset 0 0 0 1px junk var(--color-selected-indicator)'],
      ['미지원 함수 잔여(calc)', 'inset 0 0 0 1px calc(2px) var(--color-selected-indicator)'],
      ['top-level slash div 잔여', 'inset 0 0 0 / 1px var(--color-selected-indicator)'],
    ])('RED: %s', (_label, value) => {
      expect(ivis(value)).toBe(false);
    });
    // 기대 갱신(18R I2): spread 0 레이어는 이제 canonical 판정 단계에서 이미 탈락한다(실측 문자열 밖).
    // 층 분리(canonical 판정 ≠ 가시성 계산)는 border 도메인에서 계속 단정된다(width 0은 canonical).
    it('spread 0은 canonical 밖(18R I2) — 판정 단계에서 이미 RED', () => {
      const cls = classifyRelevantDecl('box-shadow', `inset 0 0 0 0 var(--${IND})`);
      expect(cls.syntax).toBe('non-canonical');
      expect(ivis(`inset 0 0 0 0 var(--${IND})`)).toBe(false);
    });
    it('무회귀: 핀 실측 spread(1px) 형태는 계속 visible', () => {
      expect(ivis(`inset 0 0 0 1px var(--${IND})`)).toBe(true);
    });
    // 층 2 가시성 계산(spread>0)이 공허하지 않음을 유지 — CANONICAL_DECLS의 레이어 모델을 직접 단정한다.
    it('canonical indicator layer 모델의 spread는 1(>0) — 층 2 가시성 입력 고정', () => {
      expect(canonicalShadowLayers(CANON_SHADOW_INDICATOR_LAYER)[0].spread).toBeGreaterThan(0);
    });
  });

  describe('canonical border 가시성 + 구 4면 cascade 엔진 계약 이관(11R 대칭 구멍 A)', () => {
    const TOKEN = 'color-input-border';
    const V = 'var(--color-input-border)';
    it('canonical shorthand는 width>0·토큰 일치일 때만 가시(층 2 계산)', () => {
      expect(evalBorderScss(`.X{border:1px solid ${V}}`, TOKEN).visible).toBe(true);
      expect(evalBorderScss(`.X{border:0 solid ${V}}`, TOKEN).visible).toBe(false); // canonical이나 width 0
      expect(evalBorderScss(`.X{border:1px solid var(--color-border)}`, TOKEN).visible).toBe(false); // 다른 토큰
    });
    it('canonical 판정과 가시성 계산은 분리된 층이다 — width 0도 syntax는 canonical', () => {
      const cls = classifyRelevantDecl('border', `0 solid ${V}`);
      expect(cls.syntax).toBe('canonical');
      expect(cls.border).toEqual({ width: 0, style: 'solid', token: TOKEN });
    });
    it('비가시 style(none/hidden)은 canonical 밖 — 선언 존재 자체가 RED', () => {
      expect(classifyRelevantDecl('border', `1px none ${V}`).syntax).toBe('non-canonical');
      expect(classifyRelevantDecl('border', `1px hidden ${V}`).syntax).toBe('non-canonical');
    });
    it('여러 root 규칙(문서 순서)에 걸쳐도 relevant 선언 전수를 본다 — 후행 규칙의 비-canonical이 RED로 이긴다', () => {
      expect(evalBorderScss(`.X{border:1px solid ${V}} .X{border-bottom-width:0}`, TOKEN).visible).toBe(false);
    });
    it('border-radius/border-collapse/border-spacing은 relevant 아님(경계 무관) — 그 외 border-*는 relevant', () => {
      expect(isRelevantProp('border-radius')).toBe(false);
      expect(isRelevantProp('border-top-left-radius')).toBe(false);
      expect(isRelevantProp('border-collapse')).toBe(false);
      expect(isRelevantProp('border-spacing')).toBe(false);
      expect(isRelevantProp('border')).toBe(true);
      expect(isRelevantProp('border-width')).toBe(true);
      expect(isRelevantProp('border-image-source')).toBe(true);
      expect(isRelevantProp('border-inline-width')).toBe(true); // 논리 프로퍼티 fail-closed(15R 계약)
      expect(isRelevantProp('border-future-thing')).toBe(true); // 미지 border-* 도 relevant(fail-closed)
      expect(isRelevantProp('box-shadow')).toBe(true);
      expect(isRelevantProp('all')).toBe(true);
      expect(isRelevantProp('color')).toBe(false);
      expect(isRelevantProp('--dead-border')).toBe(false);
    });
    // 내부 리뷰 실증 — 벗기기 전엔 `-webkit-border-image`/`-webkit-box-shadow`가 startsWith('border')/
    // ===' box-shadow'에 안 걸려 relevant 밖으로 샜다(층 1 자체가 무력화되는 false-green). 커스텀
    // 프로퍼티(`--foo`)는 두 번째 문자가 `-`라 deprefix가 무영향임을 함께 고정한다.
    it('벤더 프리픽스(-webkit-/-moz-/-ms-/-o-)를 벗긴 뒤 판정 — alias도 relevant, 커스텀 프로퍼티는 무영향', () => {
      expect(isRelevantProp('-webkit-border-image')).toBe(true);
      expect(isRelevantProp('-webkit-box-shadow')).toBe(true);
      expect(isRelevantProp('-moz-box-shadow')).toBe(true);
      expect(isRelevantProp('-ms-border-radius')).toBe(false); // 벗겨도 radius는 여전히 경계 무관
      expect(isRelevantProp('-o-border-width')).toBe(true);
      expect(isRelevantProp('--webkit-color-x')).toBe(false); // 커스텀 프로퍼티(두 번째 문자 '-')는 deprefix 무영향
    });
    it('border-radius만 있으면 border 선언이 전무 → initial(비가시) RED', () => {
      expect(evalBorderScss('.X{border-radius:8px;border-collapse:collapse}', TOKEN).visible).toBe(false);
    });
    it('조건부 문맥(@media) 안 동일 셀렉터의 relevant 선언은 모델 불가로 표면화된다(구 수집 누락 폐쇄)', () => {
      const cssText = `.X{border:1px solid ${V}}@media (min-width:0px){.X{border:none}}`;
      const res = evalBorderCss(cssText, TOKEN);
      expect(res.visible).toBe(false);
      expect(res.unmodelable.join(' ')).toMatch(/조건부 문맥/);
    });
    it('조건부 문맥이라도 relevant 아닌 선언만 있으면 무해(과잉 RED 방지)', () => {
      const cssText = `.X{border:1px solid ${V}}@media (min-width:0px){.X{border-radius:4px}}`;
      expect(evalBorderCss(cssText, TOKEN).visible).toBe(true);
    });
  });

  describe('대칭 구멍 B synthetic — --color-input-border 다크 강등값이 대비 단정에 실제로 걸린다', () => {
    // 실 레포 현재 값(#6B7280 on #0E0F11 계열)은 위 실파일 describe에서 이미 GREEN으로 고정됐다 —
    // 여기서는 "만약 --color-border(비-input 톤, #26282E)로 강등되면 이 단정이 실제로 RED가 되는가"를
    // darkValues 재구성 없이 대비 함수를 직접 단정해 검증한다(합성 CSS로 강등값을 재현).
    it('강등값(#26282E, 일반 border 톤) vs 실제 다크 bg(#0E0F11)는 3:1 미만 — 대비 단정이 실제로 이 회귀를 잡는다', () => {
      const degraded = '#26282E';
      const darkBg = buildDarkValues(css)['color-bg'];
      expect(contrastOverBg(degraded, darkBg)).toBeLessThan(3);
    });
  });

  describe('reduceEffectiveDecls — prop 정규화 (Minor 2)', () => {
    it('일반 property는 case-insensitive 통합 — BORDER 뒤 border가 후행 승리', () => {
      const root = postcss.parse('.x { BORDER: none; border: 1px solid red; }');
      const state = reduceEffectiveDecls([root.first], () => true);
      expect(Object.keys(state)).toEqual(['border']);
      expect(state.border.value).toBe('1px solid red');
    });
    it('커스텀 프로퍼티는 case-sensitive 유지 — --Foo와 --foo는 별개 키', () => {
      const root = postcss.parse('.x { --Foo: A; --foo: B; }');
      const state = reduceEffectiveDecls([root.first], () => true);
      expect(state['--Foo'].value).toBe('A');
      expect(state['--foo'].value).toBe('B');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12라운드 회귀 게이트(보존분) — 식별자 디코더 계열은 이번 전환 대상이 아니다(핀 외 게이트). 보호 토큰
// 네임스페이스·cascade prop 정규화는 그대로 유지된다.
// ─────────────────────────────────────────────────────────────────────────────

describe('12R F1 — escaped 선행 하이픈 보호 토큰 우회 (표준 식별자 디코더)', () => {
  // Sass는 내부 hex(--\63 olor-x)는 --color-x로 정규화하지만 선행 하이픈은 \- 로 재직렬화한다
  // (\--color-x, -\-color-x, \2d -color-x→\--color-x, -\2d color-x→-\-color-x). 이 escape 이름들은
  // 전부 Chrome에서 --color-x로 해석되는 유효 선언인데 decl.prop raw가 startsWith('--color-')를
  // 우회했다 — 표준 CSS 식별자 디코더로 의미값을 복원해 검출한다. raw .css(normalizeRawCss) +
  // compiled .scss(compileString) 양쪽 P4 경로를 모두 검증한다.
  const rawDetect = (prop) => findProtectedDeclarations(normalizeRawCss(`:root { ${prop}: red; }`));
  const scssDetect = (prop) => findProtectedDeclarations(compileString(`.Foo { ${prop}: red; }`).css);
  it.each([
    ['\\--color-x'],
    ['-\\-color-x'],
    ['\\2d -color-x'],
    ['-\\2d color-x'],
  ])('raw .css: %s 는 실이름 --color-…로 검출된다(RED)', (prop) => {
    expect(rawDetect(prop)).toHaveLength(1);
  });
  it('compiled .scss 경로: \\--color-x 도 검출된다(RED)', () => {
    expect(scssDetect('\\--color-x')).toHaveLength(1);
  });
  it('기존 내부 hex(--\\63 olor-x)도 계속 검출(GREEN 유지)', () => {
    expect(rawDetect('--\\63 olor-x')).toHaveLength(1);
  });
  it('--Color-x(대문자)는 case-sensitive 비보호 → 미검출(GREEN 유지, 오검출 방지)', () => {
    expect(rawDetect('--Color-x')).toEqual([]);
  });
  it('escaped 대문자(-\\43 olor-x=-Color-x)도 case-sensitive 비보호 → 미검출(GREEN)', () => {
    // M2 주석 오기 정정 — 입력은 `-\43 olor-x`: 선행 `-` + \43(=0x43='C') + `olor-x` = **-Color-x**
    // (단일 하이픈, --Color-x 아님). custom property도 아니고 보호 접두도 아니라 미검출이 맞다.
    expect(rawDetect('-\\43 olor-x')).toEqual([]);
  });
  it('블록주석 안 escaped 이름은 Comment 노드라 미검출(GREEN)', () => {
    expect(findProtectedDeclarations(normalizeRawCss('.Foo { /* \\--color-x: red; */ color: blue; }'))).toEqual([]);
  });
  it('소비(var(\\--color-x))는 값이라 미검출(GREEN)', () => {
    expect(findProtectedDeclarations(normalizeRawCss('.Foo { border-color: var(\\--color-x); }'))).toEqual([]);
  });
});

// F1의 decodeCssIdentifier는 hasProtectedPrefix에만 배선되고 normalizeProp(cascade predicate·state 키)
// 에는 미적용이었다(내부 리뷰 실증, 12라운드) — escaped 선언이 reduceEffectiveDecls/핀 relevant 수집
// 양쪽에서 predicate 탈락으로 cascade에서 통째로 실종됐다. normalizeProp이 decodeCssIdentifier로 먼저
// 디코딩하도록 고치면 두 소비처(다크 cascade·핀 relevant 판정)가 한 번에 닫힌다.
// 17R 전환 후에도 이 배선은 **필수**다: escaped `\42order`가 relevant 판정을 우회하면 canonical 게이트
// 자체가 그 선언을 못 보고 지나친다(= canonical 매칭 우회 경로). 아래 세 번째 it이 그 폐쇄를 고정한다.
describe('12R F5 — normalizeProp CSS 식별자 디코더 선통과 (relevant 수집 우회 폐쇄)', () => {
  const escapedIndicatorThemes = `
    :root { --color-bg: #FFFFFF; --color-selected-indicator: transparent; }
    html[data-theme=dark] {
      --color-bg: #0E0F11;
      --color-selected-indicator: #6B7280;
      \\--color-selected-indicator: transparent;
    }
    :root { --color-alias-unused: 0; }
  `;

  it('19R 기대 갱신(cascade 계산→shape 위반): 다크 블록 escaped 중복(\\--color-selected-indicator)은 buildDarkValues가 값을 계산하기 전에 shape contract로 throw — escaped 이름도 디코딩해 동일 토큰으로 중복 카운트', () => {
    // 기대 갱신: 이전엔 buildDarkValues가 reduceEffectiveDecls로 후행 transparent를 cascade winner로 읽어
    // 회귀를 값으로 잡았다(=cascade 계산 의존). 19R shape contract는 보호 토큰 블록당 1선언을 강제하므로
    // 이 escaped 중복은 값 계산 이전에 구조 위반으로 접힌다(cascade 재구현 없이 더 강한 폐쇄). 디코더가
    // 중복 그룹핑에도 쓰이므로 raw `--color-selected-indicator`와 escaped `\--…`가 같은 토큰으로 묶인다.
    expect(() => buildDarkValues(escapedIndicatorThemes)).toThrow(/shape contract/);
    expect(() => structuralGate(escapedIndicatorThemes)).toThrow(/shape contract/);
  });

  it('normalizeProp 디코딩 계약 유지(cascade 레이어): reduceEffectiveDecls는 escaped prop(\\--color-x)을 실이름으로 디코딩해 동일 키로 통합한다 — effectiveValue 등 소비처가 여전히 escaped 선언을 놓치지 않는다', () => {
    // 12R-F5의 본래 관심사(normalizeProp가 decodeCssIdentifier를 선통과)는 reduceEffectiveDecls 층에서
    // 그대로 유지된다(effectiveValue·직접 소비처가 공유). _themes 층은 shape contract가 별도로 막는다.
    const root = postcss.parse('.x { --color-x: #6B7280; \\--color-x: transparent; }');
    const state = reduceEffectiveDecls([root.first], (decl, prop) => prop.startsWith('--'));
    expect(Object.keys(state)).toEqual(['--color-x']); // 두 선언이 같은 키로 통합
    expect(state['--color-x'].value).toBe('transparent'); // 후행 승리(cascade는 여전히 정확)
  });

  it('border: 후행 \\42order:none(디코딩=border)이 relevant 선언으로 수집돼 canonical 위반 RED가 된다', () => {
    const V = 'var(--color-input-border)';
    // 이 테스트는 normalizeProp의 **raw 식별자 디코딩**을 검증한다 — Sass는 escape를 선(先)정규화하므로
    // (\42order→Border) compileString을 태우면 decode 경로가 실행되지 않는다. 따라서 공용 evaluator를
    // 호출하되 cssText는 raw로 넣어 postcss.parse가 escape를 보존하게 한다.
    const res = evalBorderCss(`.X{border:1px solid ${V};\\42order:none}`);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/order: none/);
  });

  // 회귀 안전 확인(코드 변경과 무관 — hasProtectedPrefix가 이미 자체 디코딩) — P3 역방향도 escaped
  // 비보호 토큰을 놓치지 않는다.
  it('findUnprotectedDeclarations: escaped 비보호 토큰(--\\75 nprotected-x=--unprotected-x)도 검출', () => {
    const root = postcss.parse(':root { --color-a: 1; --\\75 nprotected-x: 2; }');
    const offenders = findUnprotectedDeclarations([root.first]);
    expect(offenders).toEqual(['--\\75 nprotected-x@1행']);
  });

  it('멱등성: decodeCssIdentifier/normalizeProp을 이미 디코딩된(또는 1회 디코딩된) 식별자에 재적용해도 무변화 — 이중 디코딩 지점 없음 보증', () => {
    const alreadyDecoded = ['--color-selected-indicator', 'border', 'border-top-color', '--Foo-Bar', 'all'];
    for (const ident of alreadyDecoded) {
      expect(decodeCssIdentifier(decodeCssIdentifier(ident))).toBe(decodeCssIdentifier(ident));
      expect(normalizeProp(normalizeProp(ident))).toBe(normalizeProp(ident));
    }
    // 현실 escape 패턴(leading-hyphen escape) 1회 디코딩 결과에는 백슬래시가 남지 않으므로 재통과해도
    // 무변화 — decode 지점이 정확히 한 곳(normalizeProp 진입부)이면 이중 호출 경로가 생겨도 안전하다.
    const onceDecoded = decodeCssIdentifier('\\--color-selected-indicator');
    expect(onceDecoded).toBe('--color-selected-indicator');
    expect(decodeCssIdentifier(onceDecoded)).toBe(onceDecoded);
  });

  // M2(13라운드) — **음성 mutation**: 이름에 \5c(백슬래시 자체의 hex escape)가 들어가면 1회 디코딩이
  // 리터럴 백슬래시를 낳아, **재디코딩하면 값이 달라진다**. 이는 "정확히 한 번만 디코딩"(단일 decode
  // 지점=normalizeProp 진입부) 계약을 고정한다.
  it('멱등성 음성 대조: \\5c(백슬래시 hex escape) 포함 이름은 1회≠2회 디코딩 — 단일 소비 계약 고정', () => {
    const once = decodeCssIdentifier('--color\\5c x'); // \5c → 리터럴 '\' , 뒤 공백 1개 소비
    expect(once).toBe('--color\\x'); // 리터럴 백슬래시 1개 남음
    expect(decodeCssIdentifier(once)).toBe('--colorx'); // 재디코딩: \x → x (백슬래시 소비) → 값 변함
    expect(decodeCssIdentifier(once)).not.toBe(once); // 비-멱등: 이 지점을 두 번 태우면 오독됨을 명시
  });
});

describe('13R I1 — findUnprotectedDeclarations 선행 하이픈 escape 역방향 검출', () => {
  // 디코딩 결과가 전부 --unprotected-x(비보호 custom property)인데 raw는 --로 시작하지 않아 놓쳤던 4종.
  it.each([
    ['\\--unprotected-x'],
    ['-\\-unprotected-x'],
    ['\\2d -unprotected-x'],
    ['-\\2d unprotected-x'],
  ])('선행 하이픈 escape %s 는 실이름 --unprotected-x로 검출된다(RED)', (prop) => {
    const root = postcss.parse(`:root { --color-a: 1; ${prop}: 2; }`);
    expect(findUnprotectedDeclarations([root.first])).toHaveLength(1);
  });
  it('기존 케이스(--\\75 nprotected-x, raw가 이미 --로 시작)도 계속 검출(GREEN 유지)', () => {
    const root = postcss.parse(':root { --color-a: 1; --\\75 nprotected-x: 2; }');
    expect(findUnprotectedDeclarations([root.first])).toEqual(['--\\75 nprotected-x@1행']);
  });
  it('보호 접두 3종만 있으면 escape 여부 무관 빈 배열(오검출 방지)', () => {
    const root = postcss.parse(':root { --color-a: 1; \\--track-b: 2; }'); // \--track-b = --track-b(보호)
    expect(findUnprotectedDeclarations([root.first])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11R~17R 회귀 벡터 코퍼스 — 6라운드에 걸쳐 축적된 mutation 벡터 전량을 **canonical 게이트 기대**로
// 이관한다(삭제 금지 원칙). 각 항목은 원 라운드 ID를 유지하고, 기대가 바뀐 것은 `note`에 갱신 사유를
// 병기한다. 기대 갱신의 유일한 원인은 아키텍처 전환 자체다:
//   · 구 모델의 "invalid(폐기) → **이전 유효 선언 fallback** → GREEN" 부류는 전부 RED가 된다.
//     정적 회귀 게이트에서 non-canonical CSS는 그 자체로 실패이고, 브라우저의 폐기 의미론을 흉내 내는
//     일(=false-green의 근원)을 중단했기 때문이다.
//   · 구 모델이 "유효 grammar"로 인정하던 non-canonical 형태(directional longhand 조립·border-width:0
//     복원·border-image:none 등)도 canonical 밖이므로 RED다(false-RED 방향 — 회귀 게이트로선 올바름).
// 반대로 **canonical + CSS-wide만으로 구성된 GREEN**(핀 실형태·`all:initial` 후 canonical box-shadow·
// `border-image:initial` 등)은 그대로 GREEN으로 남는다 — 층 2가 그 조합만 계산하기 때문이다.
// ─────────────────────────────────────────────────────────────────────────────
const CIB = 'color-input-border';
const IND = 'color-selected-indicator';
const V = 'var(--color-input-border)';
const IV = 'var(--color-selected-indicator)';
// 구 false-green의 단골 형태(M13 패턴): 활성 border-image + important 성분 longhand. 구 모델은 "무효
// shorthand가 border-image를 reset해 important longhand가 드러남"으로 GREEN을 냈다. 17R에선 성분
// longhand·border-image 모두 canonical 밖이라 어느 경로로도 GREEN이 될 수 없다.
const M13 = (candidate) => `.X{border-width:1px !important;border-style:solid !important;`
  + `border-color:${V} !important;border-image:url(a.png);border:${candidate}}`;

const CORPUS = [
  // ── 11R 대칭 구멍 A(border 4면 cascade) — RED 10종은 그대로 RED, GREEN 4종은 기대 갱신.
  { id: '11R-A1', kind: 'border', label: 'shorthand 후 border-width:0', src: `.X{border:1px solid ${V};border-width:0}`, visible: false },
  { id: '11R-A2', kind: 'border', label: 'shorthand 후 border-style:none', src: `.X{border:1px solid ${V};border-style:none}`, visible: false },
  { id: '11R-A3', kind: 'border', label: 'shorthand 후 border-color:transparent', src: `.X{border:1px solid ${V};border-color:transparent}`, visible: false },
  { id: '11R-A4', kind: 'border', label: 'border: calc(100% - 2px) solid var(…)', src: `.X{border:calc(100% - 2px) solid ${V}}`, visible: false },
  { id: '11R-A5', kind: 'border', label: 'border-width:0 !important', src: `.X{border:1px solid ${V};border-width:0 !important}`, visible: false },
  { id: '11R-A6', kind: 'border', label: 'border-width:0 !important 후 shorthand', src: `.X{border-width:0 !important;border:1px solid ${V}}`, visible: false },
  { id: '11R-A7', kind: 'border', label: 'directional border-left-width:0', src: `.X{border:1px solid ${V};border-left-width:0}`, visible: false },
  { id: '11R-A8', kind: 'border', label: '논리 프로퍼티 border-inline-width:0', src: `.X{border:1px solid ${V};border-inline-width:0}`, visible: false },
  { id: '11R-A9', kind: 'border', label: '`all: unset` 리셋(층 2가 계산: border initial → 비가시)', src: `.X{border:1px solid ${V};all:unset}`, visible: false },
  { id: '11R-A10', kind: 'border', label: 'border: 5 solid var(…)(unitless 비영 width)', src: `.X{border:5 solid ${V}}`, visible: false },
  { id: '11R-B1', kind: 'border', label: 'border-width:0 후 shorthand 복원', src: `.X{border-width:0;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-width는 canonical 폼이 아니다. 구 모델은 shorthand가 성분을 복원한다고 **계산**했지만, 전환 후 게이트는 non-canonical 선언의 의미를 추론하지 않는다(fail-closed).' },
  { id: '11R-B2', kind: 'border', label: 'shorthand !important 후 border-width:0(non-imp)', src: `.X{border:1px solid ${V} !important;border-width:0}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유 — !important 우선순위 계산 이전에 border-width:0 자체가 canonical 밖이다.' },
  { id: '11R-B3', kind: 'border', label: 'directional 성분으로 4면 조립', src: `.X{border-width:1px;border-style:solid;border-color:${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 성분 longhand 조립은 핀이 쓰지 않는 형태라 canonical 집합에 없다. 실제 핀이 이 형태로 바뀌면 개발자가 알아야 한다(게이트의 의도된 신호).' },
  { id: '11R-B4', kind: 'border', label: 'border-style 4값 확장(전면 solid)', src: `.X{border:1px solid ${V};border-style:solid solid solid solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-style longhand는 canonical 밖.' },

  // ── 12R F2 wrapper 색함수(직접 var 아님) — 전부 RED 유지.
  { id: '12R-F2a', kind: 'border', label: 'color-mix 0% wrapper', src: `.X{border:1px solid color-mix(in srgb,${V} 0%,transparent)}`, visible: false },
  { id: '12R-F2b', kind: 'border', label: 'rgb(var) wrapper', src: `.X{border:1px solid rgb(${V})}`, visible: false },
  { id: '12R-F2c', kind: 'border', label: 'rgb(from var …/0) wrapper', src: `.X{border:1px solid rgb(from ${V} r g b / 0)}`, visible: false },
  { id: '12R-F2d', kind: 'indicator', label: 'inset 인디케이터 color-mix wrapper', src: `.X{box-shadow:inset 0 0 0 1px color-mix(in srgb,${IV} 0%,transparent)}`, visible: false },
  { id: '12R-F2-GREEN', kind: 'border', label: '직접 var(--expected)(핀 실형태)', src: `.X{border:1px solid ${V}}`, visible: true },

  // ── 12R F3 border-image 도장.
  { id: '12R-F3a', kind: 'border', label: 'border 뒤 투명 border-image', src: `.X{border:1px solid ${V};border-image:linear-gradient(transparent,transparent) 1}`, visible: false },
  { id: '12R-F3b', kind: 'border', label: 'border-image 뒤 winning border shorthand', src: `.X{border-image:linear-gradient(transparent,transparent) 1;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 구 모델은 border shorthand의 border-image initial 리셋을 계산했다. 전환 후엔 border-image 선언(비 CSS-wide)이 존재하는 것 자체가 canonical 위반이다 — reset 부작용 모델이 통째로 사라졌다(finding 3 클래스 소멸).' },
  { id: '12R-F3c', kind: 'border', label: 'important border-image를 non-important border가 못 덮음', src: `.X{border-image:linear-gradient(transparent,transparent) 1 !important;border:1px solid ${V}}`, visible: false },
  { id: '12R-F3d', kind: 'border', label: 'border-image-source longhand(non-none)', src: `.X{border:1px solid ${V};border-image-source:linear-gradient(transparent,transparent)}`, visible: false },
  { id: '12R-F3e', kind: 'border', label: 'border-image-source:none(명시적)', src: `.X{border:1px solid ${V};border-image-source:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): `none`은 CSS-wide 키워드가 아니라 border-image-source의 property별 값이다 — canonical 집합 밖이라 RED. 리셋 의도라면 `initial`/`unset`이 층 2의 모델 대상이다(12R-F3f 참고).' },
  { id: '12R-F3f', kind: 'border', label: 'border-image-source:initial(CSS-wide 리셋)', src: `.X{border:1px solid ${V};border-image-source:initial}`, visible: true },
  { id: '12R-F3g', kind: 'border', label: 'border-image-slice non-initial(명시 예외 A)', src: `.X{border:1px solid ${V};border-image-slice:5}`, visible: false },

  // ── 12R F4 border 문법 전 노드 소비 — 전부 RED 유지 + 폐기 fallback GREEN 갱신.
  { id: '12R-F4a', kind: 'border', label: '1% width', src: `.X{border:1% solid ${V}}`, visible: false },
  { id: '12R-F4b', kind: 'border', label: '1px/solid(slash div 잔여)', src: `.X{border:1px/solid ${V}}`, visible: false },
  { id: '12R-F4c', kind: 'border', label: '1px,solid(comma div 잔여)', src: `.X{border:1px,solid ${V}}`, visible: false },
  { id: '12R-F4d', kind: 'border', label: 'string junk 잔여', src: `.X{border:1px solid ${V} "junk"}`, visible: false },
  { id: '12R-F4e', kind: 'border', label: 'border-width comma 무효 → 구 모델은 이전 0으로 fallback', src: `.X{border-width:0;border-style:solid;border-color:${V};border-width:1px,1px}`, visible: false },
  { id: '12R-F4f', kind: 'border', label: '무효 border-width 뒤 유효 shorthand fallback', src: `.X{border:1px solid ${V};border-width:1px,1px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 구 모델의 "무효 선언 폐기 → 이전 유효 선언 fallback" 동작을 제거했다. 층 2는 무효 CSS를 계산하지 않고, non-canonical 선언의 존재를 실패로 본다.' },

  // ── 13R I2 var 문법 / box-shadow 선언 전체 유효성.
  { id: '13R-I2a', kind: 'border', label: 'border color가 var(--x garbage)', src: `.X{border:1px solid var(--color-input-border garbage)}`, visible: false },
  { id: '13R-I2b1', kind: 'indicator', label: 'inset 중복', src: `.X{box-shadow:inset inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '13R-I2b2', kind: 'indicator', label: 'color 2개(transparent + var)', src: `.X{box-shadow:inset 0 0 0 1px transparent ${IV}}`, visible: false },
  { id: '13R-I2b3', kind: 'indicator', label: '무효 형제 레이어(junk)', src: `.X{box-shadow:junk, inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '13R-I2b-G1', kind: 'indicator', label: '유효 단일 inset 레이어(핀 실형태)', src: `.X{box-shadow:inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '13R-I2b-G2', kind: 'indicator', label: '다중 그림자(HomeTabs 핀 실형태)', src: `.X{box-shadow:var(--shadow-xs), inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '13R-I2b-G3', kind: 'indicator', label: '무효 box-shadow(junk) 후행 → 구 모델은 앞선 유효 선언 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 동작 제거(층 2 재설계). junk 선언이 존재하는 것 자체가 실패다.' },

  // ── 13R I3 directional 잔여 노드.
  { id: '13R-I3a', kind: 'border', label: 'directional 잔여노드(1px "junk")', src: `.X{border-width:0;border-style:solid;border-color:${V};border-top-width:1px "junk";border-right-width:1px "junk";border-bottom-width:1px "junk";border-left-width:1px "junk"}`, visible: false },
  { id: '13R-I3b', kind: 'border', label: '잔여 없는 유효 directional(1px)', src: `.X{border-width:0;border-style:solid;border-color:${V};border-top-width:1px;border-right-width:1px;border-bottom-width:1px;border-left-width:1px}`, visible: false,
    note: '기대 갱신(GREEN→RED): directional 성분 longhand는 canonical 밖(11R-B3와 동일 사유).' },

  // ── 13R I4 border-image shorthand 양방향.
  { id: '13R-I4a', kind: 'border', label: 'border-image:none이 stale slice를 리셋', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): `none`·`5`가 모두 canonical 밖이다(12R-F3e와 동일 사유). CSS-wide `initial`판은 13R-I4c가 GREEN으로 유지한다.' },
  { id: '13R-I4b', kind: 'border', label: '무효 shorthand(border:junk)는 리셋 안 함', src: `.X{border-image:linear-gradient(transparent,transparent) 1;border-width:1px !important;border-style:solid !important;border-color:${V} !important;border:junk}`, visible: false },
  { id: '13R-I4c', kind: 'border', label: 'border-image:initial(CSS-wide 리셋)', src: `.X{border:1px solid ${V};border-image:initial}`, visible: true },

  // ── 13R 잔여1 deferred(var 포함 문법위반) — 구 모델의 3분기가 전부 하나로 수렴한다.
  { id: '13R-D1', kind: 'indicator', label: 'spread 자리 var(--zero) → deferred', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero) ${IV}}`, visible: false },
  { id: '13R-D2', kind: 'border', label: 'width 자리 var(--w) → 슬롯 중복 deferred', src: `.X{border:1px solid ${V};border:var(--w) solid ${V}}`, visible: false },
  { id: '13R-D3', kind: 'indicator', label: 'var 없는 위반(length 5개) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px 2px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '13R-D4', kind: 'border', label: 'var 없는 위반(width 슬롯 중복) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border:1px 2px solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '13R-D5', kind: 'indicator', label: 'well-formed 아닌 var만 포함한 위반 → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero garbage)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거. well-formed 여부 판정 자체가 사라졌다.' },
  { id: '13R-D6', kind: 'border', label: 'well-formed 아닌 var만 포함한 border 위반', src: `.X{border:1px solid ${V};border:solid var(--w garbage)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },

  // ── 14R I1 border longhand 삼분(CSS-wide·named color·deferred).
  { id: '14R-I1a', kind: 'border', label: 'border-top-color: var(…) "junk"(deferred)', src: `.X{border:1px solid ${V};border-top-color:${V} "junk"}`, visible: false },
  { id: '14R-I1b', kind: 'border', label: 'border-style: initial', src: `.X{border:1px solid ${V};border-style:initial}`, visible: false },
  { id: '14R-I1c', kind: 'border', label: 'border-color: red(named color override)', src: `.X{border:1px solid ${V};border-color:red}`, visible: false },
  { id: '14R-I1d', kind: 'border', label: 'border-color: inherit(모델 불가)', src: `.X{border:1px solid ${V};border-color:inherit}`, visible: false },
  { id: '14R-I1e', kind: 'border', label: 'border-width: unset(CSS-wide 리셋 → border initial)', src: `.X{border:1px solid ${V};border-width:unset}`, visible: false,
    note: '기대 갱신(GREEN→RED): 층 2는 성분별 셀을 모델하지 않는다 — border 계열 CSS-wide 리셋은 경계 전체를 initial(비가시)로 접는다(의도적 과잉 안전, fail-closed).' },
  { id: '14R-I1f', kind: 'border', label: '잔여 없는 유효 directional(border-top-color: V)', src: `.X{border:1px solid ${V};border-top-color:${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): directional 성분 longhand는 canonical 밖(11R-B3 사유).' },
  { id: '14R-I1g', kind: 'border', label: 'var 없는 순수 문법위반(border-top-color: red blue) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-top-color:red blue}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I1h', kind: 'border', label: 'border: initial(shorthand 전체 CSS-wide)', src: `.X{border:1px solid ${V};border:initial}`, visible: false },

  // ── 14R I2 indicator CSS-wide·all·negative blur.
  { id: '14R-I2a', kind: 'indicator', label: 'box-shadow: initial', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:initial}`, visible: false },
  { id: '14R-I2b', kind: 'indicator', label: 'all: initial → box-shadow none', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:initial}`, visible: false },
  { id: '14R-I2c', kind: 'indicator', label: 'all: initial 후 canonical box-shadow가 이김(순서 대칭)', src: `.X{all:initial;box-shadow:inset 0 0 0 1px ${IV}}`, visible: true },
  { id: '14R-I2d', kind: 'indicator', label: 'all: initial !important 는 후행 non-important를 이김', src: `.X{all:initial !important;box-shadow:inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '14R-I2e', kind: 'indicator', label: 'negative blur(var 없음) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 -1px 1px #000}`, visible: false,
    note: '기대 갱신(GREEN→RED): 14R에서 브라우저 폐기 의미론에 맞춰 GREEN으로 정정했던 항목. 전환 후엔 브라우저 의미론 재현을 중단했으므로 non-canonical 존재 = RED.' },
  { id: '14R-I2f', kind: 'indicator', label: 'negative blur + well-formed var(deferred)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 -1px 1px ${IV}}`, visible: false },

  // ── 14R I3 재귀 var·색함수 문법·대문자 VAR.
  { id: '14R-I3a', kind: 'border', label: 'fallback 내부 malformed 중첩 var', src: `.X{border:1px solid var(--color-input-border, var(--bad garbage))}`, visible: false },
  { id: '14R-I3b', kind: 'border', label: 'fallback이 정상 var인 중첩(구 모델은 토큰 정상 수집)', src: `.X{border:1px solid var(--color-input-border, var(--fallback))}`, visible: false,
    note: '기대 갱신(GREEN→RED): canonical 토큰 참조는 fallback 없는 `var(--name)`뿐이다.' },
  { id: '14R-I3c', kind: 'indicator', label: 'rgb(from junk r g b) 형제 레이어', src: `.X{box-shadow:0 0 rgb(from junk r g b), inset 0 0 0 1px ${IV}}`, visible: false },
  { id: '14R-I3d', kind: 'border', label: '대문자 VAR()(구 모델은 유효 인정)', src: `.X{border:1px solid VAR(--color-input-border)}`, visible: false,
    note: '기대 갱신(암묵 GREEN→RED): 함수명 대소문자 정규화를 중단했다 — canonical은 소문자 `var(` 정확일치.' },

  // ── 14R I4 border-image 삼분 + CSS-wide.
  { id: '14R-I4a', kind: 'border', label: 'stale slice:5 후 border-image:initial', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:initial}`, visible: false,
    note: '기대 갱신(GREEN→RED): `border-image-slice:5`가 canonical 밖이라 그 존재만으로 RED(후행 리셋 여부와 무관 — 상태 복구 모델 없음).' },
  { id: '14R-I4b', kind: 'border', label: 'border-image: junk 후 source:none', src: `.X{border:1px solid ${V};border-image-slice:5;border-image:junk;border-image-source:none}`, visible: false },
  { id: '14R-I4c', kind: 'border', label: 'border-image: inherit(모델 불가)', src: `.X{border:1px solid ${V};border-image:inherit}`, visible: false },

  // ── 14R I5 필수 전이 3형태 × border·indicator.
  { id: '14R-I5-1b', kind: 'border', label: '① 유효 → 후행 순수 문법위반(값 5개) → 구 모델은 fallback', src: `.X{border:1px solid ${V};border-color:red red red red red}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I5-1i', kind: 'indicator', label: '① indicator 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px 2px 3px}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-I5-2b', kind: 'border', label: '② 유효 → 후행 deferred → fail-closed', src: `.X{border:1px solid ${V};border-color:${V} "junk"}`, visible: false },
  { id: '14R-I5-2i', kind: 'indicator', label: '② indicator deferred fail-closed', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 var(--zero) ${IV}}`, visible: false },
  { id: '14R-I5-3b', kind: 'border', label: '③ deferred 후 유효 winner가 이김', src: `.X{border:${V} "junk";border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 후행 canonical winner가 있어도 앞선 non-canonical 선언의 존재가 실패다(층 1은 순서 무관 전수 판정).' },
  { id: '14R-I5-3i', kind: 'indicator', label: '③ indicator deferred 후 유효 winner', src: `.X{box-shadow:inset 0 0 0 var(--zero) ${IV};box-shadow:inset 0 0 0 1px ${IV}}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유.' },

  // ── 14R 잔여1 시스템 색.
  { id: '14R-R1a', kind: 'border', label: 'border-color: AccentColor', src: `.X{border:1px solid ${V};border-color:AccentColor}`, visible: false },
  { id: '14R-R1b', kind: 'indicator', label: 'box-shadow … ButtonText', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px ButtonText}`, visible: false },
  { id: '14R-R1c', kind: 'border', label: 'accentcolor(소문자)', src: `.X{border:1px solid ${V};border-color:accentcolor}`, visible: false },
  { id: '14R-R1d', kind: 'border', label: 'deprecated 시스템 색(ThreeDFace)', src: `.X{border:1px solid ${V};border-color:ThreeDFace}`, visible: false },
  { id: '14R-R1e', kind: 'border', label: '미지 ident(NotAColor) → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-color:NotAColor}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거. "유효 색인가"를 판정하지 않으므로 AccentColor와 NotAColor가 동일하게 RED로 수렴한다 — 이 수렴 자체가 전환의 요지다.' },

  // ── 14R 잔여2 border-image longhand.
  { id: '14R-R2a', kind: 'border', label: 'border-image-source: junk → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-image-source:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '14R-R2b', kind: 'border', label: '이전 상태=활성 이미지일 때 junk', src: `.X{border:1px solid ${V};border-image-source:linear-gradient(red,blue);border-image-source:junk}`, visible: false },
  { id: '14R-R2c', kind: 'border', label: 'border-image-slice: var(--x)(deferred)', src: `.X{border:1px solid ${V};border-image-slice:var(--x)}`, visible: false },

  // ── 15R I1~I6(헤드리스 Chrome 대조 벡터).
  { id: '15R-M1', kind: 'border', label: 'all: var(--color-bg)(deferred)', src: `.X{border:1px solid ${V};all:var(--color-bg)}`, visible: false },
  { id: '15R-M2', kind: 'indicator', label: 'all: var(--color-bg)(indicator)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:var(--color-bg)}`, visible: false },
  { id: '15R-M3', kind: 'border', label: 'border-width: initial 1px(다값 CSS-wide)', src: `.X{border:0 solid ${V};border-width:initial 1px}`, visible: false },
  { id: '15R-M4', kind: 'border', label: 'border-style: initial solid → 구 모델은 선언 폐기 후 solid 유지', src: `.X{border:1px solid ${V};border-style:initial solid}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '15R-M5', kind: 'indicator', label: 'calc 포함 유효 shadow winner', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 calc(1px + 1vw) 1px #000}`, visible: false },
  { id: '15R-M6', kind: 'indicator', label: '인자 부족 색함수 rgb(from red) → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px rgb(from red)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(색함수 arity 모델 삭제).' },
  { id: '15R-M6b', kind: 'border', label: 'border-color: color-mix(in srgb)(피연산자 부족)', src: `.X{border:1px solid ${V};border-color:color-mix(in srgb)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거.' },
  { id: '15R-M7', kind: 'border', label: 'border-color: tr\\61 nsparent(escaped ident)', src: `.X{border:1px solid ${V};border-color:tr\\61 nsparent}`, visible: false },
  { id: '15R-M8', kind: 'indicator', label: 'box-shadow … r\\65 d(escaped ident)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px r\\65 d}`, visible: false },
  { id: '15R-M9', kind: 'border', label: 'border-color: var(--é) "junk"(비ASCII dashed-ident)', src: `.X{border:1px solid ${V};border-color:var(--é) "junk"}`, visible: false },
  { id: '15R-M10', kind: 'border', label: 'border-image: inherit 후 일반 longhand가 못 지움', src: `.X{border-image:inherit;border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-M11', kind: 'border', label: 'border-image: inherit 후 border-image: none 복구', src: `.X{border:1px solid ${V};border-image:inherit;border-image:none}`, visible: false,
    note: '기대 갱신(GREEN→RED): 모델 불가(inherit/revert) 표시는 sticky다 — 후행 리셋으로 해제되지 않는다(의도적 과잉 안전). 게다가 `none`도 canonical 밖이다.' },
  { id: '15R-M12', kind: 'border', label: 'all: inherit 는 후행 longhand로 지워지지 않음', src: `.X{border:1px solid ${V};all:inherit;border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-M13', kind: 'border', label: '확인 불가 shorthand(border: foo())는 border-image를 reset하지 않음', src: M13('foo()'), visible: false },
  { id: '15R-M14', kind: 'border', label: '-webkit-image-set 도 <image>로 성립(활성 도장)', src: `.X{border:1px solid ${V};border-image-source:-webkit-image-set("a.png" 1x)}`, visible: false },
  { id: '15R-M15', kind: 'border', label: 'border-image-slice: junk → 구 모델은 폐기 fallback', src: `.X{border:1px solid ${V};border-image-slice:junk}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(border-image 성분 grammar 모델 삭제).' },
  { id: '15R-M16', kind: 'border', label: 'border-image-repeat: 3값(최대 2 초과)', src: `.X{border:1px solid ${V};border-image-repeat:stretch stretch stretch}`, visible: false,
    note: '기대 갱신(GREEN→RED): 동일 사유.' },
  { id: '15R-ADV1', kind: 'border', label: 'image 활성 상태는 후행 일반 longhand로 안 지워짐(역방향)', src: `.X{border-image-source:linear-gradient(red,blue);border-width:1px;border-style:solid;border-color:${V}}`, visible: false },
  { id: '15R-ADV2', kind: 'border', label: 'border shorthand(유효)가 image를 리셋(구 무회귀 계약)', src: `.X{border-image:inherit;border:1px solid ${V}}`, visible: false,
    note: '기대 갱신(GREEN→RED): border-image의 inherit은 모델 불가 sticky다. 구 모델은 shorthand의 리셋 부작용을 계산했지만 그 부작용 모델을 삭제했다.' },
  { id: '15R-EXC-A', kind: 'border', label: '명시 예외 A: source none이어도 non-initial slice면 RED', src: `.X{border:1px solid ${V};border-image-slice:5}`, visible: false },
  { id: '15R-EXC-B', kind: 'border', label: '명시 예외 B: outset:0px(단위만 다른 0)', src: `.X{border:1px solid ${V};border-image-outset:0px}`, visible: false },

  // ── 16R I1~I3 + 근본1.
  { id: '16R-I1a', kind: 'border', label: 'all: env(...)(substitution deferred)', src: `.X{border:1px solid ${V};all:env(safe-area-inset-top)}`, visible: false },
  { id: '16R-I1b', kind: 'indicator', label: 'all: env(...)(indicator)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};all:env(safe-area-inset-top)}`, visible: false },
  { id: '16R-I1c', kind: 'indicator', label: '후행 box-shadow에 env(length 자리)', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 env(safe-area-inset-top,3px) 1px red}`, visible: false },
  { id: '16R-I2', kind: 'border', label: '무효 hex(#xyz) shorthand는 border-image를 reset하지 않음', src: M13('#xyz'), visible: false },
  { id: '16R-I3a', kind: 'border', label: '이중 슬래시 색함수는 reset하지 않음', src: M13('rgb(1 2 3 / / 1)'), visible: false },
  { id: '16R-I3b', kind: 'indicator', label: '이중 슬래시 색함수 후행 → 구 모델은 폐기 fallback', src: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 0 1px hsl(0 50% 50% / / 1)}`, visible: false,
    note: '기대 갱신(GREEN→RED): 폐기 fallback 제거(색함수 구분자 grammar 모델 삭제).' },
  { id: '16R-I3c', kind: 'border', label: '색 개수 초과 color-mix', src: M13('color-mix(in srgb, red, blue, green)'), visible: false },
  { id: '16R-I3d', kind: 'border', label: '유효 토큰 shorthand 무회귀(핀 실형태)', src: `.X{border:1px solid ${V}}`, visible: true },
];

describe('11R~17R 회귀 벡터 코퍼스 — canonical 게이트 기대로 이관(계약 보존)', () => {
  it.each(CORPUS)('$id $label', ({ kind, src, visible, token }) => {
    const t = token || (kind === 'border' ? CIB : IND);
    const res = kind === 'border' ? evalBorderScss(src, t) : evalIndicatorScss(src, t);
    expect(res.visible, JSON.stringify(res)).toBe(visible);
  });
  it(`코퍼스 규모 하한(현재 ${CORPUS.length}종) — 벡터 유실 방지`, () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(90);
  });
  it('코퍼스 GREEN은 canonical(+CSS-wide)만으로 구성된 것뿐이다 — GREEN 목록 고정', () => {
    expect(CORPUS.filter((c) => c.visible).map((c) => c.id)).toEqual([
      '12R-F2-GREEN', '12R-F3f', '13R-I2b-G1', '13R-I2b-G2', '13R-I4c', '14R-I2c', '16R-I3d',
    ]);
  });
  it('기대 갱신 항목은 전부 사유(note)를 병기한다', () => {
    const updated = CORPUS.filter((c) => c.note);
    expect(updated.length).toBeGreaterThanOrEqual(25);
    for (const c of updated) expect(c.note, c.id).toMatch(/기대 갱신/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I2(19R) — CORPUS "삭제 금지"를 실제로 보장한다. 이전엔 `CORPUS.length >= 90` count만 검사해서, 격리
// 사본에서 11R-A1 한 건을 삭제해도 113개가 여전히 >= 90이라 371/371 통과했다(RED 벡터라 GREEN ID 목록
// 에도 안 걸렸다 = 어디에도 안 잡힘). 처방: 114개 ID를 **순서까지** 고정한 exact manifest로 전체 인벤토리
// 비교 + ID uniqueness 단정(삭제 후 다른 ID 중복으로 개수 맞추는 우회 차단). 각 ID가 어느 라운드 계약
// 인지 그룹 주석으로 표기하고, 라운드별 개수도 고정한다. RED 벡터도 manifest에 포함되므로 삭제 시 걸린다.
// ─────────────────────────────────────────────────────────────────────────────
const CORPUS_MANIFEST = [
  // 11R 대칭 구멍 A(border 4면 cascade)/B (14)
  '11R-A1', '11R-A2', '11R-A3', '11R-A4', '11R-A5', '11R-A6', '11R-A7', '11R-A8', '11R-A9', '11R-A10',
  '11R-B1', '11R-B2', '11R-B3', '11R-B4',
  // 12R F2 색함수 wrapper / F3 border-image 도장 / F4 border 문법 전 노드 소비 (18)
  '12R-F2a', '12R-F2b', '12R-F2c', '12R-F2d', '12R-F2-GREEN',
  '12R-F3a', '12R-F3b', '12R-F3c', '12R-F3d', '12R-F3e', '12R-F3f', '12R-F3g',
  '12R-F4a', '12R-F4b', '12R-F4c', '12R-F4d', '12R-F4e', '12R-F4f',
  // 13R I2 var/box-shadow 유효성 / I3 directional 잔여 / I4 border-image 양방향 / D deferred (18)
  '13R-I2a', '13R-I2b1', '13R-I2b2', '13R-I2b3', '13R-I2b-G1', '13R-I2b-G2', '13R-I2b-G3',
  '13R-I3a', '13R-I3b',
  '13R-I4a', '13R-I4b', '13R-I4c',
  '13R-D1', '13R-D2', '13R-D3', '13R-D4', '13R-D5', '13R-D6',
  // 14R I1 longhand 삼분 / I2 indicator CSS-wide / I3 재귀 var / I4 border-image / I5 전이 / R1 시스템색 / R2 border-image longhand (35)
  '14R-I1a', '14R-I1b', '14R-I1c', '14R-I1d', '14R-I1e', '14R-I1f', '14R-I1g', '14R-I1h',
  '14R-I2a', '14R-I2b', '14R-I2c', '14R-I2d', '14R-I2e', '14R-I2f',
  '14R-I3a', '14R-I3b', '14R-I3c', '14R-I3d',
  '14R-I4a', '14R-I4b', '14R-I4c',
  '14R-I5-1b', '14R-I5-1i', '14R-I5-2b', '14R-I5-2i', '14R-I5-3b', '14R-I5-3i',
  '14R-R1a', '14R-R1b', '14R-R1c', '14R-R1d', '14R-R1e',
  '14R-R2a', '14R-R2b', '14R-R2c',
  // 15R M(헤드리스 Chrome 대조) / ADV(역방향) / EXC(명시 예외) (21)
  '15R-M1', '15R-M2', '15R-M3', '15R-M4', '15R-M5', '15R-M6', '15R-M6b', '15R-M7', '15R-M8', '15R-M9',
  '15R-M10', '15R-M11', '15R-M12', '15R-M13', '15R-M14', '15R-M15', '15R-M16',
  '15R-ADV1', '15R-ADV2', '15R-EXC-A', '15R-EXC-B',
  // 16R I1 env / I2 무효 hex / I3 색함수 구분자 (8)
  '16R-I1a', '16R-I1b', '16R-I1c', '16R-I2', '16R-I3a', '16R-I3b', '16R-I3c', '16R-I3d',
];
const CORPUS_ROUND_COUNTS = { '11R': 14, '12R': 18, '13R': 18, '14R': 35, '15R': 21, '16R': 8 };

describe('I2(19R) — CORPUS exact ordered manifest + uniqueness (삭제/중복 우회 폐쇄)', () => {
  it('manifest 자체가 114개·ID 중복 없음·라운드별 개수 고정', () => {
    expect(CORPUS_MANIFEST).toHaveLength(114);
    expect(new Set(CORPUS_MANIFEST).size).toBe(114);
    const byRound = {};
    for (const id of CORPUS_MANIFEST) { const r = id.match(/^(\d+R)/)[1]; byRound[r] = (byRound[r] || 0) + 1; }
    expect(byRound).toEqual(CORPUS_ROUND_COUNTS);
    expect(Object.values(CORPUS_ROUND_COUNTS).reduce((a, b) => a + b, 0)).toBe(114);
  });

  it('CORPUS 실제 ID 인벤토리 === manifest (순서 포함) — 삭제·재배치·추가 전부 RED', () => {
    // count만 보던 이전 게이트가 놓친 것을 여기서 잡는다: 배열 자체를 순서까지 비교한다.
    expect(CORPUS.map((c) => c.id)).toEqual(CORPUS_MANIFEST);
  });

  it('CORPUS ID uniqueness — 삭제 후 다른 ID 중복으로 개수 맞추는 우회 차단', () => {
    const ids = CORPUS.map((c) => c.id);
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(new Set(ids).size, `중복 ID: ${dups.join(', ')}`).toBe(ids.length);
  });

  it('선재현↔RED: 임의 1건(11R-A1) 삭제는 count-only(>=90)로는 못 잡지만 인벤토리·uniqueness가 잡는다', () => {
    const deleted = CORPUS.filter((c) => c.id !== '11R-A1').map((c) => c.id);
    // 선재현: 현행 HEAD의 `CORPUS.length >= 90`은 113개도 통과했다.
    expect(deleted.length).toBeGreaterThanOrEqual(90);
    // 인벤토리 비교는 삭제를 즉시 검출한다.
    expect(deleted).not.toEqual(CORPUS_MANIFEST);
    // 삭제 후 다른 ID를 중복해 개수(114)를 맞추는 우회도 uniqueness + 순서 비교가 잡는다.
    const deletedThenDup = [...deleted, '11R-A2'];
    expect(deletedThenDup).toHaveLength(114);
    expect(new Set(deletedThenDup).size).not.toBe(deletedThenDup.length); // uniqueness RED
    expect(deletedThenDup).not.toEqual(CORPUS_MANIFEST);                  // 순서 비교 RED
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I2(20R) — CORPUS **payload 무결성**. 위 manifest는 ID 존재·순서·uniqueness만 보장하고 각 entry의
// payload(kind/src/visible/token)는 안 봤다. 선재현(옛 게이트): 11R-A1의 ID를 유지한 채 src를 11R-A2와
// 동일 교체하면 border-width:0 벡터가 사실상 삭제(border-style:none 중복)되는데도 ID·순서·개수·GREEN
// 목록 전부 유지 → 통과(false-green). 처방: entry별 정규화 fingerprint(있는 필드만 {id,kind,src,token,
// visible}을 고정 필드순 결정적 직렬화 → SHA-256)를 상수로 고정한다. payload swap·visible 반전·src 변조가
// 해시 불일치로 RED. label/note는 서술 필드라 fingerprint에서 제외(의미 벡터만 잠근다). 새 벡터 추가 시
// CORPUS_FINGERPRINTS도 갱신해야 통과(무결성 잠금 — 그게 의도).
// ─────────────────────────────────────────────────────────────────────────────
const CORPUS_FP_FIELDS = ['id', 'kind', 'src', 'token', 'visible']; // 고정 필드순 = 결정적 직렬화
function corpusEntrySerialize(c) {
  const obj = {};
  for (const k of CORPUS_FP_FIELDS) if (c[k] !== undefined) obj[k] = c[k];
  return JSON.stringify(obj, CORPUS_FP_FIELDS); // replacer 배열 = 키 화이트리스트+순서(존재 필드만)
}
const corpusEntryFingerprint = (c) => createHash('sha256').update(corpusEntrySerialize(c)).digest('hex');

// entry별 payload SHA-256(고정 필드순 직렬화 도출). 새 벡터·payload 변경 시 이 상수도 갱신해야 통과.
const CORPUS_FINGERPRINTS = {
  // 11R
  '11R-A1': 'dc46a16329c15203b613a4afbd18022163234b2f52d56c08f052d844c21aac38',
  '11R-A2': '0d44e72d05066b97cde4bd6ad2bfb27990d53637ee8bafecdb6e71ba697992ba',
  '11R-A3': '3b04fa5dfa13e7ba79fe2ae9d1feeaacb3ca8f3c8296b780eda6632efb0b4bff',
  '11R-A4': '14fa936b488dd1f459e31e6322ed4b32acccb620227803f119bbef5b686c5f1b',
  '11R-A5': '5bd25d404602357564a1d4e54be763be1366dc3073e6a13eaea9bebd809720f3',
  '11R-A6': '8d271ecd31cb9856a848347380d837f54bc9d7b62fd7d9fe951293dc4bf497fe',
  '11R-A7': '4e6d059cdd3fcfbf8b59f4db5fb6db470168e444a6443d3fe9811511a5fb4476',
  '11R-A8': 'a389c137d9af006d375e3909f2403363576fcd668fdfcf1e127b2d8239c3b473',
  '11R-A9': '982dd362a14b752f5ebb82212377d928b272f6ed076ac72bd0857ff3f75e1ce9',
  '11R-A10': 'edc89a68d98805496c053dc4db8482a6aaa2c9a094a91fd23647829e894ed1b2',
  '11R-B1': '0352f268f483f47f6baa9c818a80bba353e53b0e2d2c68fe9fd2a5dc36523500',
  '11R-B2': '916220b5afe31ea3b20f104f964a515ec87eb46ce7da4b75240d608eff3c6db1',
  '11R-B3': '2b78d7e60802905b49a2cd5f3533c162ec710971eb289b229b81c9c92b35a58e',
  '11R-B4': '0a64188ebbf9ad056f16e4488c3a7fa6093dc77479498cbd7e8417eddee595f0',
  // 12R
  '12R-F2a': 'd4b2bbb64cfd8e5ffb0a760054582803adbba22dcb190ccc5fe9bce04417f995',
  '12R-F2b': 'b47e2ae1d797b43a882b4e667ccac1e5ab40990b9b2b5073411f10af60fa7586',
  '12R-F2c': '49c707d50d238f705a1bd329261ca5324346924cff53caf87fa2edc52d5a059c',
  '12R-F2d': '119a63ce8fa2a7adcd6e7223d6a88801353dbaee8fbc7d50270fbab2fa3e58f0',
  '12R-F2-GREEN': '85ad33943fec81e5ece2791c23ee00e611711587adc9594ae0d73023246f2b6a',
  '12R-F3a': '0cc930b2877c1935c4c7551640a7a22c5d79b66d76b9ba87d64e991da841a8e6',
  '12R-F3b': '76317d74865fb3b936a8cac48bf6a6e242335178944fed8c61bd1901aad2c190',
  '12R-F3c': '0313ff92d2f06ca2f588755ad521d3cfa6c7d7c8f093064ce23d3945d460deeb',
  '12R-F3d': '38c81bbd61aaefe4bfdc513d3e786345c8db2b8bb70323ab009801693b726bad',
  '12R-F3e': 'e460481bfb8bc68296cbed8d1956151e1376c6a3e39c5b0bf775aff29765e3ee',
  '12R-F3f': '67ea2c292fd3f04f42411897a972cf6bd22087acc696ccf1022ceb2e706b34d7',
  '12R-F3g': 'f315c4283ff02df4fd8fa60e5083fa78e69d7df75c3921c348f8f88f8e402c8c',
  '12R-F4a': '1c00016553c09834c2a1d437c100be63a82f3ca4f36b41edb23c7b978f36fe95',
  '12R-F4b': 'd3204f37b5633ed22f5564ee71d6c66a6198d4a8b6d9253b5194a05cd099c280',
  '12R-F4c': '215a13ff83eb9b94cfb0f3461a21c85151bcbef6e17e2b1cf78ba5a8da64ee07',
  '12R-F4d': '7fa2980bd7d6edbfa30d00ee50b64ef60885a39057379f2bb968c6f1cfe05eb8',
  '12R-F4e': 'd9126692e3837121f0ff29e8587ecdbfdae202dba37188a60c7dae185c2618d1',
  '12R-F4f': 'ff33787475cdda9ff5e8ca93451e3ca74312ef82bf94f320328f3ee428d7e63e',
  // 13R
  '13R-I2a': '17cb2a1e26c08d6c38c58b4a69dbbf934829101730b6b253b2c5224c9f255990',
  '13R-I2b1': 'f83e9975c6206bc146127fd71f98123c7277b81e87ac4d248b51963244d49163',
  '13R-I2b2': '626f6c66f57edb9babd9b5cb3390f46419c990394d90e62c0b1b32e733661a67',
  '13R-I2b3': 'ea87674585c3d2cad7625480f3c90146b1489baad19e0ec4421dc6d8ec461b4d',
  '13R-I2b-G1': 'e652719b5ca1bffa5235aeeb7def2925f6fb8f8b340d276ce88e81bb0f8e1fbd',
  '13R-I2b-G2': 'e24e7d730d67bd86eb8d50234ea84434b1041824bef70aaeed53d3250f3367a9',
  '13R-I2b-G3': 'bae92da0f6d2777c7797c59f51f14bfc10e0ff712e0056b6f84cc325bc1ee3bf',
  '13R-I3a': '42e5d4fbc8cba1f6c74d9ee721ca8b70c67272608836197ec105cd15022d3f94',
  '13R-I3b': '023e693a33e0a4a71cf91f7d2879363cfcbe63a556116d7300256f442255f053',
  '13R-I4a': 'ce7583886731d5ec507ecd38c0a6afb64267ff0d4fc1f566cc66577ea0970e79',
  '13R-I4b': 'd7bb7e3ad15cd87845168730af025750819fafe6f5d1da4df68696a88bef58c9',
  '13R-I4c': '976db31c02f37e7af54defc68e075895632540bca14d0b3ca369aebb76b13f7b',
  '13R-D1': 'af42d113e6e985088a251e5b273d9898eb25aaa9433db048df4ff5e6eae068ea',
  '13R-D2': 'bcfb08c087e7f74876a59049002a96e82591cc340211ce8073ec73ba1fdc42ce',
  '13R-D3': '54b9fe05a36e32edfae5dca406b312dd8301824d60a0b5fb4a12192625be0146',
  '13R-D4': '5a5322e201ef67e1bc4a506ec3c4b990e03dd0ef5154010ebe5ababe6c579b68',
  '13R-D5': 'ab003274f2a8f25964b0d8ba5e420c6102af98b048213ef80d3a2c0c8b30c4d5',
  '13R-D6': 'b81f48feee042aaab35650d69fb2fde790ae091746cbc040e15aed3f9943aa0d',
  // 14R
  '14R-I1a': '6084bfe477bc54f6d7d79178cd6f2ae81a0bb5b0158b6029d9ed5769e2fe9c9b',
  '14R-I1b': '65738176ea33f7fa586e16b3aca5dd26788aedfb92b2621e7b25f376529e893c',
  '14R-I1c': '35ecd33ba6b87d93d90f46ca5159ed210bd375004228622621dbfbef3945fd90',
  '14R-I1d': '52e9d12552d10d83b5d962d0fa92fc4ab4ebfe6c84ac0686e61695f515d5b101',
  '14R-I1e': '2d921233ff92e7988c3058dbc1fbb5a94e5567d95c4f60316b9bd9cb79f30d9e',
  '14R-I1f': 'b1c5999c5f1382361dfd34ac92e921b989076a715d0330e25d4ccc1647d6546a',
  '14R-I1g': '893fc0480b65397d266898e78d51dbe04622f3b3e4dd29b2bf5f1b6b7e962138',
  '14R-I1h': '714ff3c26f8af0331e4848e9ee7e90ce8e3b8c8d269fa25cad104026eec4abd5',
  '14R-I2a': '97b3aaf2ccaa75f64d2d42cf9c0aac0f00a55751e0b398588d5104fbda7b6e3f',
  '14R-I2b': '64f1cd69c8f770fedf2fec23c624c89761fb82cd184bd67b453f021d7d0df964',
  '14R-I2c': 'c7709e4bf0ef870634c7e84faaa528bbe22da749b51ed008fdb0a0684d06ab8c',
  '14R-I2d': 'af2fdeb540abf233627fd49ab559ae865097c1c5659da9aa71c4272e98f9e2dd',
  '14R-I2e': '7012acd165dbb61ee159f3c5cd7b3fb8ce8dc17fc99e8ddf4f9cf3cf1c1dfc53',
  '14R-I2f': '86f30d0dbbe8fabe888f378a9b5750ef82e8139eb09fc2ca12919203949b3aec',
  '14R-I3a': 'b397e5e700eb39ff98c9c4d5213a062ca746730beae0daf7a3d44a9206025fc0',
  '14R-I3b': '07931d9411b26c28d45c92095c06937f0b1598f866330b7741d37d11706b4e43',
  '14R-I3c': '763cb046273ab58fc11de5db8fceb2c8f0666fc6551dcf09be7e80e9a903abe3',
  '14R-I3d': '5e3df8ae8f5a73f7bcdd4c2a14cacc3e52ce12bcadb3d3c648504fbccbcc555c',
  '14R-I4a': 'e12ce021482ae3d20ad39ec533d1d54894a0a5a33be4b5273e1ef35d4ba55182',
  '14R-I4b': 'b2c6d254ab72c604777fe095d82e4f004879030cfbb8ff8e953880ee53255432',
  '14R-I4c': 'fde44249a5aa118e6564a1c604357eaec806def300a0e2edd700e3781e05d119',
  '14R-I5-1b': '1dcf9c99e6e50167756a0b900d444d7f04e2facb316e723d84a0537a86e6175a',
  '14R-I5-1i': '34936138f3f76cba7f1a431440f8407ec35b62cb6a95de59593fe801c0b3422e',
  '14R-I5-2b': 'a74c79a601e046fa868e13971a1b781e23db321efcb9b7f76423f9262b62f523',
  '14R-I5-2i': 'bcad33f3abb7770063b95eabaaaf46cc19350ab7cbb4666a76d35445fab372fc',
  '14R-I5-3b': '2c42dd570d958f4244067ff80d275893e329d17fb0637973d6c8732f12cc5958',
  '14R-I5-3i': '9effa78108f2827be66a6fdc20724716ad0261f923ec55a40ac4e0970b547ac1',
  '14R-R1a': 'f4702c05c1a32374e1f8b768548b6534f10ff4b2dbc8b847e72adce9b510db1d',
  '14R-R1b': '9bb661f41a2890735a8ad04a0429dae57b7463cee5496359b663d79e04f89ae1',
  '14R-R1c': '23aacb78f3a7edcb72d19967bda51c140abd1d17828d485f2b06ed749acd33d5',
  '14R-R1d': '5c7cc428d0e822555e244672ba10976b76dbd4a73642dd8af25d0c2a7404ca90',
  '14R-R1e': '089607391bfedab11aa6b9e8240e5f6e16d657fb5198bef2809d4009b02d4879',
  '14R-R2a': '1b3ea3fcc863e65d3de774e83a5202ef80e1d4d9b751e1a016a9753cee392fac',
  '14R-R2b': 'aeeb8a271ba072b919bcb4b901959d42413ac79c5a0cf37afb4202d8a0f36a23',
  '14R-R2c': '6736cd50108a328a62e7977581a2f21aaf85e545cbf2fd822e3efd03b787318f',
  // 15R
  '15R-M1': '862fb9a31af02451d9ed963db08cd31ac408bd2596c965a54dca6cb10784db82',
  '15R-M2': 'b9d6439c338ffd97fd44cddfe687dea6d1dcefb96af584ae9e718c1124026f5d',
  '15R-M3': 'aaee8e20316f003422ef50fc73ffeb41def897f200a384c7b6a7acb0337a2ab1',
  '15R-M4': 'e22b82b328ff1eda664659edec33fedbc5a6fb748069082d20e255c212752e8c',
  '15R-M5': '9a12f01f9fd70f8c9bb3fedc7f1e8df009705c049486466eb354a852c56d6b71',
  '15R-M6': '417ea19a9cb4d0325fff3fe5ff62b7c5b10129806178c8958dab9ac30c8d1d35',
  '15R-M6b': '61eeb97a8838a87809de3296b8f6c8ff9ed477434fe8e2e49030f4b33daae88e',
  '15R-M7': '637ea456acb94e65f6753dbe138de7b1a4762671b61fe084f80120d4f8e015a3',
  '15R-M8': 'f2d4741fbc50663b2d6ad9ec6524670be5faddd67ed0b9913a337753928e0005',
  '15R-M9': '6338a71bf1af7d9c67d82634f1bff0e5cf1720649c9bf702de8b071e85c562cf',
  '15R-M10': 'b29ee4b711cd368cccd855c5ae39d47ef5fca1c4cb19b407d0158fb66a4023dc',
  '15R-M11': '05d80260928a197b6797beefdbdb782702f8a31617a97d24e7312ff1b907a22f',
  '15R-M12': '846bc7cc0c46b37c88f311e699f73005342c111627c4be819805dfa3ded5ca08',
  '15R-M13': 'e1d2873a8d99cfc809b6cac59a0a264c844e3c9e73c19bdf282b8f5f80c79a6f',
  '15R-M14': 'ec62bd932e3620502803c8057d437f24da7b3a5250fa3ba4cbf708f00b7b65c3',
  '15R-M15': 'e1903df67fd98d486d43275849edb9d4cf8bd4e979bbfa0ee6d107155a40dfcb',
  '15R-M16': '824c1c4b107f5f53ab0019876c1151371ef902e0eebb5b953e8baa05d8c9ed4a',
  '15R-ADV1': 'fe336c9a24e0b031194adfe5cc765b12d3f05b75ddd8c58af7ea752d3dfa7ea8',
  '15R-ADV2': 'c79c0c8efdc7b421c9a6eb485c50aaa01ddf3e47be61f64a40f5e7caaa3ccdc1',
  '15R-EXC-A': 'c425f8ccaae0e92d38ae01e555fa6cd84dfb39f3155504c556560d9b3f20ffda',
  '15R-EXC-B': '06585dc0f356f6ce14772cc8baa85adf139ccf0f7fe70a4e5f88f3b374d162e5',
  // 16R
  '16R-I1a': '7f19672bfd2411431f3d73d46f721d1933d68941d149f5a94e832a9a0fd7065c',
  '16R-I1b': 'dbe56cf2cbb556863d77fefccb22ef84e25dfdbb1c22c80f1fca97ecc30cd650',
  '16R-I1c': '2c35678efda57dbb5e25b0befb047572f2dd34c47d92d6b49212fa6ac31e693f',
  '16R-I2': 'aa8e67f46aace26e55d560e1132e353cf528f6b6a59db4b8663e1ff229d96f23',
  '16R-I3a': '2a5567f381db64867ea8e381104ccc1525dc4cc79fa13fcd90d421959de48342',
  '16R-I3b': '28a790afe3f1f3d81d9f1d7c246c9b9e605928ef88764004fb6f2f1117f2361d',
  '16R-I3c': '0d2726797fa76f901cd56072a26769f309701f7b7b537da0bdbf7caa5fe1a8c3',
  '16R-I3d': '22e06f9c4562c01aadcc01228628ebd519c87ca36c607b3c4d9dad13a7f83eb6',
};

describe('I2(20R) — CORPUS entry별 payload fingerprint (swap/visible반전/src변조/token 폐쇄)', () => {
  it('fingerprint 맵 키 === manifest (누락·잉여 entry 없음)', () => {
    expect(Object.keys(CORPUS_FINGERPRINTS).sort()).toEqual([...CORPUS_MANIFEST].sort());
  });

  it('각 CORPUS entry의 payload fingerprint가 고정 상수와 일치한다 (src/kind/visible/token 변조 시 RED)', () => {
    for (const c of CORPUS) {
      expect(corpusEntryFingerprint(c), `${c.id} payload 변조(kind/src/visible/token) 또는 상수 미갱신`).toBe(CORPUS_FINGERPRINTS[c.id]);
    }
  });

  it('직렬화 결정성 — 필드 순서 무관·존재 필드만·label/note 제외', () => {
    const a = { id: 'X', kind: 'border', src: '.X{}', visible: false, token: 't', label: 'L', note: 'N' };
    const b = { note: 'DIFF', label: 'DIFF', token: 't', visible: false, src: '.X{}', kind: 'border', id: 'X' };
    expect(corpusEntrySerialize(a)).toBe(corpusEntrySerialize(b));       // 키 순서·label/note 무관
    expect(corpusEntrySerialize(a)).toBe('{"id":"X","kind":"border","src":".X{}","token":"t","visible":false}');
    // token 없는 entry는 필드가 빠진다(있는 필드만 직렬화).
    expect(corpusEntrySerialize({ id: 'Y', kind: 'border', src: '.Y{}', visible: true }))
      .toBe('{"id":"Y","kind":"border","src":".Y{}","visible":true}');
  });

  it('선재현↔RED: 11R-A1 ID 유지 + src를 11R-A2로 교체(payload swap) → manifest는 통과하지만 fingerprint 불일치', () => {
    const a1 = CORPUS.find((c) => c.id === '11R-A1');
    const a2 = CORPUS.find((c) => c.id === '11R-A2');
    const swapped = { ...a1, src: a2.src }; // ID·순서·개수 그대로, payload(src)만 오염
    // 선재현: ID 인벤토리는 그대로라 manifest·GREEN목록·uniqueness가 전부 통과한다(옛 게이트가 놓친 지점).
    const idsAfterSwap = CORPUS.map((c) => (c.id === '11R-A1' ? swapped.id : c.id));
    expect(idsAfterSwap).toEqual(CORPUS_MANIFEST);
    // fingerprint는 src 변조를 즉시 검출한다.
    expect(corpusEntryFingerprint(swapped)).not.toBe(CORPUS_FINGERPRINTS['11R-A1']);
  });

  it('선재현↔RED: visible 반전·token 변조도 fingerprint 불일치로 RED', () => {
    const green = CORPUS.find((c) => c.id === '12R-F2-GREEN'); // visible:true 벡터
    expect(corpusEntryFingerprint({ ...green, visible: false })).not.toBe(CORPUS_FINGERPRINTS['12R-F2-GREEN']);
    const ind = CORPUS.find((c) => c.id === '13R-I2b-G1');     // token 미설정(기본 IND)
    expect(corpusEntryFingerprint({ ...ind, token: 'color-border' })).not.toBe(CORPUS_FINGERPRINTS['13R-I2b-G1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17R 최소 회귀 벡터 상설화 — 외부 검수가 "모델이 정답 판정기라서" 뚫린다고 실증한 8종. 전환 **전**
// 이 8종은 전부 GREEN이었다(선재현 확인: 현행 HEAD 사본에 8 단정을 붙여 8/8 통과 = false-green 확정).
// 전환 후에는 canonical이 아니라는 이유 하나로 전부 RED다 — 개별 grammar 판정이 사라졌으므로 이 부류의
// 우회는 원리적으로 재발할 수 없다.
// 명시 예외: 8종 중 다수는 Sass가 컴파일 단계에서 선-거부(전역 rgb() 인자 검증 실패)하거나
// 선-상수접기(sqrt/hypot 등 CSS Values 4 수학 함수 채택)한다 — SCSS 경로로는 벡터가 원형 그대로 도달할
// 수 없다. 따라서 **raw CSS 텍스트**를 공용 evaluator에 직접 태운다(P4 스윕이 raw .css도 훑으므로 실제
// 입력 경로이며, 17R 이전 라운드도 동일 구조의 예외를 명시해 왔다).
// ─────────────────────────────────────────────────────────────────────────────
const R17_REGRESSION_VECTORS = [
  { id: 'V1', label: 'env(--x, initial) — custom env는 var-전용 deferred 검사에 안 걸려 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};all:env(--x, initial)}` },
  { id: 'V2', label: 'if(style(--flag: true): initial; else: initial) — 조건 함수 미인식 → 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};all:if(style(--flag: true): initial; else: initial)}` },
  { id: 'V3', label: 'hypot(3px, 1vw) — MATH_FUNCTIONS 미등재 길이 함수 → length 연속성 위반으로 폐기→핀 부활',
    kind: 'indicator', css: `.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:inset 0 0 hypot(3px, 1vw) 1px red}` },
  { id: 'V4', label: '-webkit-link — 벤더 색 키워드 미등재 → 미지 ident=폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:-webkit-link}` },
  { id: 'V5', label: 'RGB(from light-dark(red, blue) r g b) — relative-color origin 미인식 → 폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:RGB(from light-dark(red, blue) r g b)}` },
  { id: 'V6', label: 'RGB(foo(1) 2 3) — known-fn 내부 미지 함수가 unsupported로 낙착해 border-image reset 부작용',
    kind: 'border', css: M13('RGB(foo(1) 2 3)') },
  { id: 'V7', label: 'RGB(1 2 3 4) — 채널 4개(슬래시 없음)를 arity 하한만 보고 valid 인정 → reset 부작용',
    kind: 'border', css: M13('RGB(1 2 3 4)') },
  { id: 'V8', label: 'color-mix 구분자 오용(in srgb red, blue) — 그룹 수 위반=폐기→핀 부활',
    kind: 'border', css: `.X{border:1px solid ${V};border-color:color-mix(in srgb red, blue)}` },
];
describe('17R 8 회귀 벡터 상설화 — 전환 전 false-green 8/8 → 전환 후 상설 RED', () => {
  it.each(R17_REGRESSION_VECTORS)('$id RED: $label', ({ kind, css: cssText }) => {
    const res = kind === 'border' ? evalBorderCss(cssText, CIB) : evalIndicatorCss(cssText, IND);
    expect(res.visible, JSON.stringify(res)).toBe(false);
    // RED의 **이유**까지 고정한다 — "우연히 다른 경로로 RED"가 아니라 canonical 위반으로 RED여야 한다.
    expect(res.nonCanonical.length + res.unmodelable.length, JSON.stringify(res)).toBeGreaterThan(0);
  });
  it('8종 전부 canonical 판정 자체가 non-canonical이다(값 유효성은 판단하지 않는다)', () => {
    expect(R17_REGRESSION_VECTORS).toHaveLength(8);
    // 적대적 재검토(I2와 동종 인벤토리 클래스): 8종 ID를 순서까지 고정 — 삭제/재배치 시 RED.
    expect(R17_REGRESSION_VECTORS.map((v) => v.id)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']);
    const values = [
      ['all', 'env(--x, initial)'],
      ['all', 'if(style(--flag: true): initial)'],
      ['box-shadow', 'inset 0 0 hypot(3px, 1vw) 1px red'],
      ['border-color', '-webkit-link'],
      ['border-color', 'RGB(from light-dark(red, blue) r g b)'],
      ['border', 'RGB(foo(1) 2 3)'],
      ['border', 'RGB(1 2 3 4)'],
      ['border-color', 'color-mix(in srgb red, blue)'],
    ];
    for (const [prop, value] of values) {
      expect(classifyRelevantDecl(prop, value), `${prop}: ${value}`).toEqual({ syntax: 'non-canonical', prop, value: normalizeDeclValue(value) });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fuzz oracle 재설계(검수 권장 4) — 이전 배터리는 `not.toBe('valid')`류라 invalid-discard와 unsupported를
// 뭉뚱그려 **상태 전이를 검증하지 못했다**(브라우저-유효 `-webkit-link`를 넣어도 전부 통과하는데 실제론
// false-green). 이제 벡터를 브라우저 기준으로 3분류하고, **기대 상태 그 자체**를 단정한다:
//   · PROVEN_INVALID        — 브라우저도 폐기하는 값
//   · PROVEN_VALID_UNMODELED— 브라우저에서 유효한데 우리가 모델하지 않는 값(이전 false-green의 원천)
//   · UNKNOWN               — 브라우저 판정을 우리가 확정할 수 없는 값
// 새 아키텍처의 요지는 **세 분류가 동일한 상태로 수렴**한다는 것이다(전부 non-canonical → RED). 분류
// 자체가 판정에 영향을 주지 않는다는 사실이 곧 "유효성 추론 없음"의 증거다.
// Sass compile 실패 벡터를 조용히 필터링하지 않는다 — 전 벡터를 raw CSS 경로로 태워 필터가 아예 없다.
// ─────────────────────────────────────────────────────────────────────────────
const PROVEN_INVALID = [
  '#xyz', '#12', '#12345', '#1234567', '#gggggg', '#',
  'rgb(1 2 3 / / 1)', 'rgb(1,,3)', 'hsl(0 50% 50% / / 1)', 'rgb(from red)',
  'color-mix(in srgb)', 'color-mix(in srgb, red, blue, green)', 'RGB(1 2 3 4)',
  '5xyz', '10flex', 'notacolor', 'inherits', 'initiall', 'url(x) url(y)', '"astring"',
];
const PROVEN_VALID_UNMODELED = [
  '-webkit-link', 'AccentColor', 'ButtonText', 'ThreeDFace', 'red', 'transparent', 'currentcolor',
  'light-dark(#fff, #000)', 'color-mix(in srgb, red, blue)', 'rgb(1 2 3)', 'rgb(1 2 3 / 0.5)',
  '#aabbccdd', '#abc', 'calc(1px + 1vw)', 'hypot(3px, 1vw)', 'env(safe-area-inset-top)',
  'attr(data-x)', 'var(--color-input-border, #ccc)', 'VAR(--color-input-border)', 'tr\\61 nsparent',
];
const UNKNOWN = [
  'zzz()', 'foobar()', 'qux(1, 2)', 'foo-bar-baz()', 'attrx(data-x)',
  'oklab4()', 'lch2(1 2 3)', 'color-contrast(red vs blue)', 'super-gradient(red, blue)',
  'if(style(--flag: true): initial)', 'env(--x, initial)', 'RGB(foo(1) 2 3)',
  '3quux', 'bluish', 'foo-bar-baz', ',,', '/ /',
];
const FUZZ_CLASSES = [
  ['PROVEN_INVALID', PROVEN_INVALID],
  ['PROVEN_VALID_UNMODELED', PROVEN_VALID_UNMODELED],
  ['UNKNOWN', UNKNOWN],
];
describe('17R fuzz oracle 3분류 — 세 분류가 동일 상태(non-canonical/RED)로 수렴한다', () => {
  it('배터리 규모 하한(각 분류 ≥ 15, 합계 ≥ 50)', () => {
    for (const [name, list] of FUZZ_CLASSES) expect(list.length, name).toBeGreaterThanOrEqual(15);
    expect(PROVEN_INVALID.length + PROVEN_VALID_UNMODELED.length + UNKNOWN.length).toBeGreaterThanOrEqual(50);
  });

  it.each(FUZZ_CLASSES)('%s — 층 1은 정확히 non-canonical 상태를 반환한다(네 배치 전부)', (_name, list) => {
    for (const U of list) {
      // 기대 상태 **그 자체**를 단정한다(not-valid가 아니라 정확한 상태 객체).
      expect(classifyRelevantDecl('border', `1px solid ${U}`).syntax, `border:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('border', U).syntax, `border-value:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('box-shadow', `inset 0 0 0 1px ${U}`).syntax, `bs-color:${U}`).toBe('non-canonical');
      expect(classifyRelevantDecl('all', U).syntax, `all:${U}`).toBe('non-canonical');
    }
  });

  it.each(FUZZ_CLASSES)('%s — cascade 시퀀스: 기존 GREEN → 후보 → RED, 후행 확정 override로도 복구 불가', (_name, list) => {
    for (const U of list) {
      // ① 기존 GREEN 뒤에 후보가 오면 RED
      expect(evalBorderCss(`.X{border:1px solid ${V};border-color:${U}}`, CIB).visible, `seq1:${U}`).toBe(false);
      // ② 후보 뒤에 **확정 canonical override**가 와도 RED(층 1은 순서 무관 전수 판정 — fallback 소멸)
      expect(evalBorderCss(`.X{border-color:${U};border:1px solid ${V}}`, CIB).visible, `seq2:${U}`).toBe(false);
      // ③ indicator 도메인 동일
      expect(evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:${U}}`, IND).visible, `seq3:${U}`).toBe(false);
    }
  });

  it.each(FUZZ_CLASSES)('%s — !important 조합에서도 동일 상태(중요도는 canonical 위반을 구제하지 못한다)', (_name, list) => {
    for (const U of list) {
      expect(evalBorderCss(`.X{border:1px solid ${V} !important;border-color:${U}}`, CIB).visible, `imp1:${U}`).toBe(false);
      expect(evalBorderCss(`.X{border:1px solid ${V};border-color:${U} !important}`, CIB).visible, `imp2:${U}`).toBe(false);
      expect(evalBorderCss(`.X{border-color:${U} !important;border:1px solid ${V} !important}`, CIB).visible, `imp3:${U}`).toBe(false);
    }
  });

  it('분류를 바꾸는 mutation은 판정을 바꾸지 못한다 — 세 분류의 상태 집합이 완전히 동일하다', () => {
    const stateOf = (U) => JSON.stringify([
      classifyRelevantDecl('border', `1px solid ${U}`).syntax,
      evalBorderCss(`.X{border:1px solid ${V};border-color:${U}}`, CIB).visible,
      evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};box-shadow:${U}}`, IND).visible,
    ]);
    const states = new Set([...PROVEN_INVALID, ...PROVEN_VALID_UNMODELED, ...UNKNOWN].map(stateOf));
    expect([...states]).toEqual([JSON.stringify(['non-canonical', false, false])]);
  });

  it('mutation 검출력 — 후보 자리에 canonical 폼이 오면 GREEN이 된다(위 RED 단정이 공허하지 않음)', () => {
    // 동일 위치·동일 구조에서 canonical만 GREEN을 낸다는 대조. 이 단정이 없으면 위 RED들은
    // "무엇을 넣어도 RED"인 공허한 게이트와 구분되지 않는다.
    expect(evalBorderCss(`.X{border:1px solid ${V}}`, CIB).visible).toBe(true);
    expect(evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV}}`, IND).visible).toBe(true);
    expect(evalBorderCss(`.X{border:1px solid ${V};border-color:zzz()}`, CIB).visible).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17R 적대적 자가 재검토 — **canonical 매칭 자체를 우회하는 경로**를 직접 단정한다(수집 누락·셀렉터
// 구멍·부작용 잔존·정규식 anchoring).
// ─────────────────────────────────────────────────────────────────────────────
describe('17R 적대적 자가 재검토 — canonical 매칭 우회 경로 폐쇄', () => {
  it('부작용 금지: 비-canonical 선언은 canonical 셀을 덮지 않으며, 그럼에도 RED다', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};border:RGB(foo(1) 2 3)}`, CIB);
    expect(res.border).toEqual({ width: 1, style: 'solid', token: CIB }); // 앞선 canonical 셀 그대로
    expect(res.nonCanonical).toHaveLength(1);
    expect(res.visible).toBe(false); // 부작용은 없지만 존재 자체가 실패(fail-closed)
  });
  it('relevant 수집 누락 없음: escaped prop(\\62 ox-shadow=box-shadow)도 relevant로 복원돼 판정된다', () => {
    const res = evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};\\62 ox-shadow:none}`, IND);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/ox-shadow: none/);
  });
  // 내부 리뷰 실증 — isRelevantProp이 `prop.startsWith('border')`/`=== 'box-shadow'`로만 판정하던 동안
  // `-webkit-border-image`/`-webkit-box-shadow` 같은 벤더 프리픽스 alias는 relevant 수집에서 아예
  // 빠졌다(=층 1이 그 선언을 못 보고 지나침 → canonical 위반 판정 자체가 실행 안 돼 항상 GREEN이었다).
  // Chrome/Safari 둘 다 이 alias를 지원하므로 실제 렌더는 도장/그림자 소멸인데 게이트는 GREEN — 상설
  // 회귀 벡터로 고정한다(styles/ 현재 사용 0건이라 latent이나, 15R VENDOR_PREFIX_RE/unprefixedFn이 17R
  // 삭제분에 함께 사라진 결과로 재발한 구멍이다).
  it('relevant 수집 누락 없음: 벤더 프리픽스 alias(-webkit-border-image)도 relevant로 복원돼 RED — 이전엔 미수집 false-green', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};-webkit-border-image:url(a.png)}`, CIB);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-webkit-border-image: url\(a\.png\)/);
  });
  it('relevant 수집 누락 없음: 벤더 프리픽스 alias(-webkit-box-shadow)도 relevant로 복원돼 RED — 이전엔 미수집 false-green', () => {
    const res = evalIndicatorCss(`.X{box-shadow:inset 0 0 0 1px ${IV};-webkit-box-shadow:none}`, IND);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-webkit-box-shadow: none/);
  });
  it('relevant 수집 누락 없음: 대문자 프로퍼티(BORDER)도 normalizeProp로 통합돼 판정된다', () => {
    expect(evalBorderCss(`.X{border:1px solid ${V};BORDER-COLOR:red}`, CIB).visible).toBe(false);
  });
  it('중첩 규칙 안 선언도 walkDecls 전수 방문 — root 직속 규칙 내부의 어떤 선언도 놓치지 않는다', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};border-style:dotted dotted}`, CIB);
    expect(res.nonCanonical).toHaveLength(1);
  });
  it('anchoring: canonical 정규식은 부분 매칭되지 않는다(접두/접미 잔여 거부)', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V} extra`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border', `x 1px solid ${V}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `inset 0 0 0 1px ${IV} extra`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `junk, inset 0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
  });
  it('canonical 폼은 프로퍼티에 묶여 있다 — 같은 문자열이라도 다른 프로퍼티에선 canonical이 아니다', () => {
    expect(classifyRelevantDecl('border', `inset 0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('box-shadow', `1px solid ${V}`).syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border-top', `1px solid ${V}`).syntax).toBe('non-canonical'); // 핀 미사용 형태
  });
  it('CSS-wide 인정은 값 전체가 소문자 단독일 때만(다값·대문자 변형 거부)', () => {
    expect(classifyRelevantDecl('all', 'initial').syntax).toBe('canonical');
    expect(classifyRelevantDecl('all', ' unset ').syntax).toBe('canonical'); // 공백 정규화만 허용
    expect(classifyRelevantDecl('all', 'INITIAL').syntax).toBe('non-canonical'); // 명시 예외(fail-closed)
    expect(classifyRelevantDecl('all', 'initial initial').syntax).toBe('non-canonical');
    expect(classifyRelevantDecl('border-width', 'initial 1px').syntax).toBe('non-canonical');
  });
  it('모델 불가(inherit/revert)는 sticky — 후행 canonical이 있어도 RED', () => {
    expect(evalBorderCss(`.X{all:inherit;border:1px solid ${V}}`, CIB).visible).toBe(false);
    expect(evalBorderCss(`.X{border:1px solid ${V};border-color:revert}`, CIB).visible).toBe(false);
    expect(evalIndicatorCss(`.X{box-shadow:revert-layer;box-shadow:inset 0 0 0 1px ${IV}}`, IND).visible).toBe(false);
  });
  it('셀렉터 미발견은 GREEN이 아니다(rulesFound 0 → RED)', () => {
    expect(evalBorderCss('.Y{border:1px solid var(--color-input-border)}', CIB).visible).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 명시 예외 **전수**(문구 축소, 18R) — 이 게이트의 보장은 "exact selector + 정적 styles 인벤토리
// (styles/**/*.{scss,css}) 범위 내"로 한정된다. 아래 4건은 그 범위 **밖**이며 이번 라운드에서도 닫지
// 못했다. 각 항목은 "알려진 한계"를 단정으로 고정한 것이지 계약이 아니다 — 수렴 선언 금지.
// ─────────────────────────────────────────────────────────────────────────────
describe('명시 예외 전수 — 게이트 범위 밖 경로(알려진 한계 고정, 계약 아님)', () => {
  // ① 셀렉터 동치성. M2(18R) 정정: 이전 테스트는 `.X` 핀에 무관한 `.b.a` 규칙을 붙여 "순서만 다른
  //    동일 복합 셀렉터"를 전혀 재현하지 못했다(그냥 남남인 셀렉터라 GREEN은 당연). 실제 동치 예외는
  //    **`.a.b` 대 `.b.a`** — CSS 의미론상 같은 요소를 고르는데 문자열 비교로는 다른 셀렉터다.
  it('① 셀렉터 동치성: .a.b 핀에 대해 .b.a 의 override는 후보에 안 들어온다', () => {
    const cssText = `.a.b{border:1px solid ${V}}.b.a{border:none}`;
    const res = evaluatePinnedContract(cssText, '.a.b', { kind: 'border', token: CIB });
    expect(res.rulesFound).toBe(1); // `.b.a` 규칙은 수집되지 않았다
    expect(res.visible).toBe(true); // ← 알려진 한계(실렌더는 border:none)
    // 대조: 문자열이 같으면 정상 수집돼 RED가 된다(위 GREEN이 "아무거나 GREEN"이 아님을 확인).
    expect(evaluatePinnedContract(`.a.b{border:1px solid ${V}}.a.b{border:none}`, '.a.b',
      { kind: 'border', token: CIB }).visible).toBe(false);
  });
  it('② 타 셀렉터 cascade: 더 높은 specificity의 override는 범위 밖', () => {
    const cssText = `.X{border:1px solid ${V}}.Foo .X{border:none}`;
    expect(evalBorderCss(cssText, CIB).visible).toBe(true); // ← 알려진 한계
  });
  it('③ 로컬 custom property 재정의: 핀 게이트 단독으론 GREEN — 폐쇄는 P4 스윕과의 합성에 의존', () => {
    const cssText = `.X{border:1px solid ${V};--color-input-border:transparent}`;
    expect(evalBorderCss(cssText, CIB).visible).toBe(true); // ← 알려진 한계
    // 전체 스위트가 RED로 수렴하는 건 이 재정의 자체를 잡는 P4가 별도로 있기 때문(합성 의존).
    // P4가 약화되거나(대상 파일 판정 밖) 우회되면 이 구멍이 그대로 열린다.
    expect(findProtectedDeclarations(cssText).length).toBeGreaterThan(0);
  });
  it('④ JS 런타임 CSS 쓰기(registerProperty·style.setProperty·JSX inline style·동적 <style> 텍스트)는 정적 styles 인벤토리 밖 — @property at-rule만 폐쇄(I4), M1 스윕은 WRITE_RES 세 정규식의 lexical match만 0건 고정(semantic write 아님·줄바꿈/브래킷 형태는 미보장)', () => {
    // M1(18R→20R) 확장 기록: 예외④는 CSS.registerProperty **하나**가 아니라 런타임 생성 CSS/custom-property
    // 쓰기 **전체**다 — (a) el.style.setProperty('--color-x', …), (b) JSX `style={{ '--color-x': … }}`,
    // (c) 동적 <style> 텍스트 주입, (d) CSS.registerProperty. 이들은 styles/**/*.{scss,css}에 나타나지 않아
    // 이 정적 게이트의 입력 밖이다. CSS 텍스트 경로(@property)는 I4에서 닫혔지만 위 JS 경로는 열려 있다.
    expect(findProtectedDeclarations('@property --color-input-border{syntax:"<color>";inherits:false;initial-value:transparent}')
      .length).toBeGreaterThan(0);
    // .js 파일은 어떤 것도 스윕 대상이 아니다(styles 밖·확장자 밖 둘 다).
    expect(isProtectedSweepTarget('library/theme.js')).toBe(false);
    expect(isProtectedSweepTarget('components/Canvas/CanvasPageView.js')).toBe(false);
    // 단, 보호 토큰 이름을 향한 **WRITE_RES 세 정규식의 lexical match**만은 M1 인벤토리 스윕이 0건 고정한다
    // (아래 describe·semantic write 보장 아님). M1(20R→22R) 주장 범위: 완전 커버는 JS AST 스캔이 필요하고 그건 스코프
    // 밖이므로 — 줄바꿈된 setProperty(…\n '--color-x')·브래킷 접근(style['--color-x']=)은 정규식 증설로
    // 흉내내지 않고 **명시적 미보장**으로 남긴다(아래 describe가 그 미보장 경계를 단정으로 기록).
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M1(19R→22R) — 예외④ 보강: components/·pages/ JS에서 **WRITE_RES 세 정규식의 lexical match 0건**을
// 인벤토리로 잠근다. M1(22R) 문구 정직화(외부 검수 정정): 이 grep 스윕이 **보장**하는 것은 "semantic write
// (실제 런타임 CSS 쓰기)"가 아니라 정확히 "**현재 세 정규식(WRITE_RES)의 lexical form 매치**"뿐이다.
//   · **under-match(미보장)**: 유효한 런타임 쓰기라도 세 정규식의 lexical form을 벗어나면 못 잡는다(아래
//     '미보장 경계' it). 완전 커버는 JS AST 스캔을 요구하므로 스코프 밖(예외④와 동종).
//   · **over-match(false-positive)**: 반대로 실제 write가 아닌 **문자열·블록주석**(`const note='--color-x: docs'`
//     / `/* --color-x: docs */`)도 세 정규식에 걸린다 — 스윕이 lexical match이지 semantic write가 아니라는
//     계약의 정확한 성격이다(아래 'false-positive 경계' it이 단정으로 고정 — 현재 repo엔 그런 라인이 없어
//     실 스윕은 0건이지만 계약의 성격을 못박는다). 정규식 증설로 어느 쪽도 흉내내지 않는다.
// **명시적 미보장**(under-match) — 전부 유효한 런타임 쓰기이지만 세 정규식의 lexical form 밖이라 못 잡는
// 사례를 아래 '미보장 경계' it이 단정으로 고정한다:
//   · `setProperty (` — 함수명과 `(` 사이 공백(정규식은 `.setProperty(` 인접만)
//   · `setProperty(/*c*/'--x'` — `(` 뒤 블록주석(정규식은 `(` 뒤 즉시 따옴표만)
//   · `registerProperty?.({name:'--x'})` — optional chaining `?.`(정규식은 `registerProperty(` 인접만)
//   · `const u='https://x'; setProperty('--x',v)` — 문자열 내 `//`를 `line.split('//')[0]`가 잘라 놓침
//   · 줄바꿈된 setProperty(…\n '--x')·브래킷 접근(style['--x']=)·문자열 연결로 조립한 토큰 이름
// 이로써 스윕을 "완전 보호"로 오인하지 못하게 한다. 비보호 런타임 주입(--branch-color/--status-color/
// --accent/--sticky-header-h)은 보호 접두(--color-/--track-/--shadow-)가 아니라 자연히 제외된다.
// ─────────────────────────────────────────────────────────────────────────────
describe('M1(22R) — components/·pages/ JS WRITE_RES lexical match 0건 스윕 (예외④ 보강·주장 범위=세 정규식 lexical form, semantic write 아님)', () => {
  const repoRoot = resolve(__dirname, '..');
  const jsFiles = ['components', 'pages'].flatMap((d) => {
    const dir = resolve(repoRoot, d);
    return readdirSync(dir, { recursive: true }).map(String)
      .filter((f) => f.endsWith('.js')).map((f) => resolve(dir, f));
  });
  // WRITE_RES 세 정규식의 lexical form만 매치한다(semantic write 아님·소비 var(--color-x)는 제외). 세 형태:
  const WRITE_RES = [
    /--(?:color|track|shadow)-[a-z0-9-]+["'`]?\s*:/,             // 객체 키/CSS 선언: '--color-x': 또는 --color-x:
    /\.setProperty\(\s*["'`]--(?:color|track|shadow)-/,           // el.style.setProperty('--color-x', …)
    /registerProperty\(\s*\{[^}]*["'`]--(?:color|track|shadow)-/, // CSS.registerProperty({ name: '--color-x' })
  ];
  it('컴포넌트/페이지 JS가 충분히 수집된다(스윕 공허 방지)', () => {
    expect(jsFiles.length).toBeGreaterThan(100);
  });
  it('WRITE_RES 세 정규식의 lexical match가 components/·pages/ JS에 0건 (semantic write 주장 아님)', () => {
    const offenders = [];
    for (const f of jsFiles) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const code = line.split('//')[0]; // 라인 주석 제외
        if (WRITE_RES.some((re) => re.test(code))) offenders.push(`${f.replace(repoRoot + '/', '')}:${i + 1}`);
      });
    }
    expect(offenders, `WRITE_RES lexical match 발견(semantic write 보장 아님·런타임 주입은 게이트 밖 — 신설 시 명시 결정 필요): ${offenders.join('; ')}`).toEqual([]);
  });
  it('스윕 검출력(공허하지 않음): 합성 단일행 write는 잡고, read/비보호는 안 잡는다', () => {
    const writes = [
      `style={{ '--color-x': v }}`,
      `el.style.setProperty('--track-y', z)`,
      `CSS.registerProperty({ name: '--shadow-z' })`,
      '`--color-a: ${v}; border: 1px`',
    ];
    for (const s of writes) expect(WRITE_RES.some((re) => re.test(s)), s).toBe(true);
    const nonWrites = [
      'border: 1px solid var(--color-x)',                 // 소비(read)
      `el.style.setProperty('--sticky-header-h', h)`,     // 비보호 런타임 주입
      'var(--branch-color)',                              // 비보호 소비
    ];
    for (const s of nonWrites) expect(WRITE_RES.some((re) => re.test(s)), s).toBe(false);
  });
  it('미보장 경계(M1(21R) 명시 기록): 공백·블록주석·optional chaining·문자열 내 //·줄바꿈·브래킷·문자열 조립은 세 정규식 lexical form 밖이라 스윕이 **못 잡는다**', () => {
    // 아래는 전부 **유효한** 런타임 보호토큰 쓰기인데 세 정규식의 정확한 lexical form을 벗어나 미보장이다
    // (정규식 증설로 흉내내지 않음 — 완전 커버는 JS AST 스캔, 스코프 밖). 앞 4건은 M1(21R) 신규 고정.
    const UNGUARDED = [
      "el.style.setProperty ('--color-x', v)",         // ① 함수명과 '(' 사이 공백 — `.setProperty(` 인접만 매치
      "el.style.setProperty(/*c*/'--color-x', v)",     // ② '(' 뒤 블록주석 — `(` 뒤 즉시 따옴표만 매치
      "CSS.registerProperty?.({ name: '--color-x' })", // ③ optional chaining `?.` — `registerProperty(` 인접만 매치
      "const url = 'https://x'; el.style.setProperty('--color-x', v)", // ④ 문자열 내 `//` → split('//')[0]가 setProperty 앞에서 자름
      "el.style.setProperty(\n  '--color-x', v)",      // 줄바꿈된 setProperty(다음 줄에 토큰)
      "el.style['--color-x'] = v",                     // 브래킷 접근 대입(: 아님)
      "el.style.setProperty('--' + 'color-x', v)",     // 문자열 연결로 조립한 토큰 이름
    ];
    for (const s of UNGUARDED) {
      // 실제 스윕과 **동일한 파이프라인**(줄 분리 → line.split('//')[0] → WRITE_RES)으로 판정한다 — 문자열 내
      // // 사례가 //-스트립 때문에 미보장임을 faithfully 재현하려면 이 전처리가 필수다.
      const anyLineMatched = s.split('\n').some((line) => WRITE_RES.some((re) => re.test(line.split('//')[0])));
      expect(anyLineMatched, `미보장이어야 하는 형태가 잡혔다(주장 범위 재검토 필요): ${JSON.stringify(s)}`).toBe(false);
    }
    // 대조: 정확한 lexical form(공백/주석/`?.` 없는 인접 형태)은 잡힌다 — 위 미보장이 "아무거나 통과"가 아님을 확인.
    const GUARDED = [
      "el.style.setProperty('--color-x', v)",
      "CSS.registerProperty({ name: '--color-x' })",
      "style={{ '--color-x': v }}",
    ];
    for (const s of GUARDED) {
      expect(WRITE_RES.some((re) => re.test(s.split('//')[0])), s).toBe(true);
    }
  });
  it('false-positive 경계(M1(22R) 명시 기록): 실제 write가 아닌 문자열·블록주석도 WRITE_RES에 걸린다 — 스윕은 semantic write가 아니라 lexical match다', () => {
    // over-match 방향의 정직화: 아래는 **런타임 write가 아닌데도** 세 정규식에 매치되는 false-positive다.
    // 스윕이 semantic write를 보장하지 않고 오직 lexical form을 본다는 계약의 정확한 성격을 못박는다.
    // 현재 repo엔 이런 라인이 없어 실 스윕(위 0건 it)은 통과하지만, 이런 문자열/주석이 추가되면 write가
    // 아니어도 offender로 잡힌다(계약상 허용되는 오탐 — 정규식으로 배제하지 않는다).
    const FALSE_POSITIVES = [
      "const note = '--color-x: docs'",  // ① 문자열 리터럴 — CSS 선언이 아님
      "/* --color-x: docs */",           // ② 블록주석(라인주석 아님 → line.split('//')[0]이 못 벗긴다)
    ];
    for (const s of FALSE_POSITIVES) {
      // 실 스윕과 동일 파이프라인(line.split('//')[0] → WRITE_RES)으로 판정 — 블록주석이 //-스트립을 통과함을 재현.
      const matched = s.split('\n').some((line) => WRITE_RES.some((re) => re.test(line.split('//')[0])));
      expect(matched, `false-positive여야 하는 형태가 안 잡혔다(계약 성격 재검토 필요): ${JSON.stringify(s)}`).toBe(true);
    }
    // 대조: 라인주석(`//` 접두)은 line.split('//')[0]이 벗겨 잡히지 않는다 — false-positive가 "아무거나 매치"가 아님을 확인.
    expect(WRITE_RES.some((re) => re.test("// --color-x: docs".split('//')[0]))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18R 상설 회귀 벡터 — I1~I4 각각의 "선재현 실측(현행 HEAD에서 false-green)" ↔ "수정 후 RED"를 그대로
// 테스트로 굳힌다. 선재현 근거는 각 describe 머리주석에 실측값으로 기록돼 있다.
// ─────────────────────────────────────────────────────────────────────────────
// CSS가 공백으로 보지 않는(=ident 문자이거나 아예 불법인) JS-공백 코드포인트. 선재현에서 이 4종 각각이
// 셀렉터·box-shadow 값·border 값 3자리 모두에서 false-green이었다(12/12).
const NON_CSS_WS = {
  'NBSP U+00A0': '\u00A0',
  'EM SPACE U+2003': '\u2003',
  'ZWNBSP U+FEFF': '\uFEFF',
  'VERTICAL TAB U+000B': '\u000B',
};
// M2(19R) — **ECMAScript `\s` 전체 − CSS 공백 5종**의 완전 집합(20종). NON_CSS_WS(위 4종)는 대표 샘플일
// 뿐이라 U+2028/U+2029/U+202F/U+1680/U+2000–200A 등 미등재 문자가 회귀해도 못 잡았다. 이 완전 집합 +
// 완전성 단정으로 "JS_ONLY_WS_RE/NON_CSS_WS를 4종 전용으로 약화하면 RED"를 강제한다(실측 도출: BMP 스캔
// `/\s/.test(ch) && !CSS5.test(ch)`).
const JS_ONLY_WS_CODEPOINTS = [
  0x000B, 0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
];
const JS_ONLY_WS_CHARS = JS_ONLY_WS_CODEPOINTS.map((cp) => String.fromCodePoint(cp))
const hex4 = (ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

describe('I1(18R) — CSS 공백 전용 정규화(손실 정규화 폐쇄)', () => {
  it('CSS 공백 5종만 공백으로 취급한다(헬퍼 단위 계약)', () => {
    expect(normalizeCssWhitespace(' \t\n\f\r a \t\n\f\r ')).toBe('a');
    for (const [name, w] of Object.entries(NON_CSS_WS)) {
      expect(cssTrim(`a${w}`), name).toBe(`a${w}`);           // trim이 삼키지 않는다
      expect(normalizeCssWhitespace(`a${w}b`), name).toBe(`a${w}b`); // space로 바뀌지 않는다
      expect(JS_ONLY_WS_RE.test(w), name).toBe(true);
    }
    expect(JS_ONLY_WS_RE.test('.HomeTabs__Tab.is-on')).toBe(false); // 실핀 셀렉터는 무영향
  });

  it.each(Object.entries(NON_CSS_WS))('셀렉터 %s: 브라우저 기준 다른 셀렉터 → 핀에 수집되지 않는다(rulesFound 0)', (_name, w) => {
    // 선재현: 4종 전부 rulesFound=1(=`.X`로 오인해 PINNED 수집) → false-green의 진입점이었다.
    const res = evaluatePinnedContract(`.X${w}{border:1px solid ${V}}`, '.X', { kind: 'border', token: CIB });
    expect(res.rulesFound ?? 0).toBe(0);
    expect(res.visible).toBe(false);
  });

  it.each(Object.entries(NON_CSS_WS))('box-shadow 값 %s: 브라우저 계산값 none인데 canonical이었다 → non-canonical RED', (_name, w) => {
    const value = `inset${w}0 0 0 1px ${IV}`;
    expect(classifyRelevantDecl('box-shadow', value).syntax).toBe('non-canonical');
    expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible).toBe(false);
  });

  it.each(Object.entries(NON_CSS_WS))('border 값 %s: 동일 — non-canonical RED', (_name, w) => {
    const value = `1px${w}solid ${V}`;
    expect(classifyRelevantDecl('border', value).syntax).toBe('non-canonical');
    expect(evalBorderCss(`.X{border:${value}}`, CIB).visible).toBe(false);
  });

  it('토큰 값 경계의 비-CSS 공백도 JS trim으로 지워지지 않는다 — 다크 대비 단정이 RED로 떨어진다', () => {
    // `--color-selected-indicator: #6B7280<NBSP>`는 브라우저에서 무효(토큰 미적용)인데 JS trim은
    // 정상 hex로 둔갑시켰다. 이제 파싱 실패 → contrastOverBg 0 → 3:1 단정 RED.
    const themes = `
      :root { --color-bg: #FFFFFF; --color-selected-indicator: transparent; }
      html[data-theme=dark] { --color-bg: #0E0F11; --color-selected-indicator: #6B7280\u00A0; }
      :root { --color-alias-unused: 0; }
    `;
    const darkValues = buildDarkValues(themes);
    expect(darkValues['color-selected-indicator']).toBe('#6B7280\u00A0');
    expect(contrastOverBg(darkValues['color-selected-indicator'], darkValues['color-bg'])).toBe(0);
  });

  it('parseColor도 CSS 공백 전용 — 값 경계·구분자 NBSP는 null(과대 허용 폐쇄, 자가 재검토 발견분)', () => {
    // 발견 경위: I1 수정 후에도 `#6B7280<NBSP>`의 다크 대비가 3.97로 통과했다 — parseColor가 여전히
    // JS trim을 쓰고 rgba 구분자를 `\s*`로 받고 있었다(같은 클래스의 잔존 인스턴스).
    expect(parseColor('#6B7280\u00A0')).toBeNull();                 // 값 경계
    expect(parseColor('rgba(107,\u00A0114,128,1)')).toBeNull();     // 구분자 NBSP
    expect(parseColor('rgba(107,\u2003114,128,1)')).toBeNull();     // 구분자 EM SPACE
    // CSS 공백은 그대로 허용(과잉 RED 방지)
    expect(parseColor('  #6B7280\t')).toEqual({ r: 107, g: 114, b: 128, a: 1 });
    expect(parseColor('rgba(107,\t114,\n128, 1)')).toEqual({ r: 107, g: 114, b: 128, a: 1 });
  });

  it('_themes.scss 블록 키 추출도 CSS 공백 전용 — `--color-bg<NBSP>:`는 별개 토큰이라 키에서 빠진다', () => {
    expect([...extractTokenKeys('--color-bg: #fff; --color-x : #000;')]).toEqual(['color-bg', 'color-x']);
    expect([...extractTokenKeys('--color-bg\u00A0: #fff;')]).toEqual([]); // 매치 실패 → 대칭 단정이 RED
  });

  it('structuralGate 블록 형태 판정도 CSS 공백 전용 — NBSP 붙은 다크 셀렉터는 다크로 인정되지 않는다', () => {
    const cssText = `:root{--color-a:1}html[data-theme='dark']\u00A0{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(cssText)).toThrow(/2번째 블록\(다크\)/);
    const lightNbsp = `:root\u00A0{--color-a:1}html[data-theme='dark']{--color-a:2}:root{--color-b:3}`;
    expect(() => structuralGate(lightNbsp)).toThrow(/1번째 블록\(라이트\)/);
  });
});

describe('M2(19R) — NON_CSS_WS 완전성(ECMAScript \\s − CSS 5종 20문자) + resolveColorValue 직접 테스트', () => {
  it('JS_ONLY_WS_CHARS는 "ECMAScript \\s 전체 − CSS 5종"의 완전 집합이다 (4종 약화 시 RED)', () => {
    // BMP 전체를 스캔해 "JS 공백이지만 CSS 공백은 아닌" 코드포인트 집합을 실측하고 fixture와 대조한다.
    const css5 = new RegExp(`[${CSS_WS_CLASS}]`);
    const computed = [];
    for (let cp = 0; cp <= 0xFFFF; cp++) {
      const ch = String.fromCharCode(cp);
      if (/\s/.test(ch) && !css5.test(ch)) computed.push(cp);
    }
    expect([...JS_ONLY_WS_CODEPOINTS].sort((a, b) => a - b)).toEqual(computed.sort((a, b) => a - b));
    expect(JS_ONLY_WS_CHARS).toHaveLength(20);
    // JS_ONLY_WS_RE가 전 문자를 매치하고 CSS 5종은 매치하지 않는다(정규식-fixture 정합).
    for (const ch of JS_ONLY_WS_CHARS) expect(JS_ONLY_WS_RE.test(ch), hex4(ch)).toBe(true);
    for (const ch of [' ', '\t', '\n', '\f', '\r']) expect(JS_ONLY_WS_RE.test(ch)).toBe(false);
    // 대표 4종(NON_CSS_WS)이 완전 집합의 부분집합인지도 확인(약화 감시).
    for (const w of Object.values(NON_CSS_WS)) expect(JS_ONLY_WS_CHARS).toContain(w);
  });

  it.each(JS_ONLY_WS_CHARS.map((w) => [hex4(w), w]))(
    '완전 집합 %s: 셀렉터(rulesFound 0)·box-shadow 값·border 값 3자리 모두 게이트가 공백으로 오정규화하지 않는다',
    (_n, w) => {
      expect(evaluatePinnedContract(`.X${w}{border:1px solid ${V}}`, '.X', { kind: 'border', token: CIB }).rulesFound ?? 0).toBe(0);
      expect(classifyRelevantDecl('box-shadow', `inset${w}0 0 0 1px ${IV}`).syntax).toBe('non-canonical');
      expect(classifyRelevantDecl('border', `1px${w}solid ${V}`).syntax).toBe('non-canonical');
    });

  // resolveColorValue — M2 승격 후 직접 테스트. 옛 `\s`/`trim()`으로 되돌리면 NBSP 케이스가 통과(RED).
  const dv = { 'color-x': '#6B7280', 'color-y': 'var(--color-x)', 'color-loop': 'var(--color-loop)' };
  it('리터럴 색(hex/rgba)은 그대로 반환', () => {
    expect(resolveColorValue('#6B7280', dv)).toBe('#6B7280');
    expect(resolveColorValue('rgba(1,2,3,0.5)', dv)).toBe('rgba(1,2,3,0.5)');
  });
  it('var(--token)은 darkValuesMap으로 재귀 해석(체인 포함)', () => {
    expect(resolveColorValue('var(--color-x)', dv)).toBe('#6B7280');
    expect(resolveColorValue('var(--color-y)', dv)).toBe('#6B7280'); // var→var→리터럴
  });
  it('var() 내부/경계의 CSS 공백은 허용(축약·trim 후 매치)', () => {
    expect(resolveColorValue('  var( --color-x ) \t', dv)).toBe('#6B7280');
  });
  it('NON_CSS_WS(NBSP/EM SPACE 등)는 var() 매치 실패 → null (옛 \\s/trim 회귀 잠금)', () => {
    expect(resolveColorValue('var( --color-x)', dv)).toBeNull();  // 여는 괄호 뒤 NBSP
    expect(resolveColorValue('var(--color-x )', dv)).toBeNull();  // 토큰 뒤 NBSP
    expect(resolveColorValue(' var(--color-x)', dv)).toBeNull();  // 값 경계 NBSP(trim 안 됨)
    expect(resolveColorValue('var(--color-x) ', dv)).toBeNull();  // 값 경계 EM SPACE
  });
  // M2(20R) — 20문자 완전 집합을 var() **앞·내부(괄호 뒤/토큰 뒤)·뒤** 위치로 매개변수화해 resolver에
  // 직접 연결한다. 이전엔 NBSP/EM SPACE 2종만 걸어 resolveColorValue의 공백 클래스를 U+1680 등으로
  // 약화해도(예: `[css-ws]`→`\s`) 이 describe가 못 잡았다 — 이제 20문자 전 위치가 null 단정이라 약화 시 RED.
  it.each(JS_ONLY_WS_CHARS.map((w) => [hex4(w), w]))(
    '완전 집합 %s: var() 앞·내부(여는 괄호 뒤/토큰 뒤)·뒤 4위치 모두 resolveColorValue가 null (resolver 연결 — 약화 시 RED)',
    (_n, w) => {
      const dvw = { 'color-x': '#6B7280' };
      expect(resolveColorValue(`${w}var(--color-x)`, dvw), 'var 앞(값 경계)').toBeNull();
      expect(resolveColorValue(`var(${w}--color-x)`, dvw), '여는 괄호 뒤(내부)').toBeNull();
      expect(resolveColorValue(`var(--color-x${w})`, dvw), '토큰 뒤(내부)').toBeNull();
      expect(resolveColorValue(`var(--color-x)${w}`, dvw), 'var 뒤(값 경계)').toBeNull();
    });
  it('대조(과잉 RED 방지): 동일 4위치의 CSS 공백 5종은 정상 해석 — 20문자 null 단정이 공허하지 않음', () => {
    const dvw = { 'color-x': '#6B7280' };
    for (const w of [' ', '\t', '\n', '\f', '\r']) {
      expect(resolveColorValue(`${w}var(--color-x)`, dvw), `앞 ${JSON.stringify(w)}`).toBe('#6B7280');
      expect(resolveColorValue(`var(${w}--color-x)`, dvw), `괄호 뒤 ${JSON.stringify(w)}`).toBe('#6B7280');
      expect(resolveColorValue(`var(--color-x${w})`, dvw), `토큰 뒤 ${JSON.stringify(w)}`).toBe('#6B7280');
      expect(resolveColorValue(`var(--color-x)${w}`, dvw), `뒤 ${JSON.stringify(w)}`).toBe('#6B7280');
    }
  });
  it('미정의 토큰·복합 표현식·null은 null(판정 불가 → 호출부 RED 유도)', () => {
    expect(resolveColorValue('var(--missing)', dv)).toBeNull();
    expect(resolveColorValue('calc(1px + 2px)', dv)).toBeNull();
    expect(resolveColorValue(null, dv)).toBeNull();
  });
  it('순환 참조는 depth 한계(>5)로 null(무한재귀 방지)', () => {
    expect(resolveColorValue('var(--color-loop)', dv)).toBeNull();
  });
});

describe('I2(18R) — canonical box-shadow를 실측 전체 문자열로 축소(과대 허용 폐쇄)', () => {
  it('허용 전체 값은 정확히 2가지 실측 문자열뿐 — 목록 고정', () => {
    expect(CANON_SHADOW_VALUES).toEqual([
      'inset 0 0 0 1px var(--color-selected-indicator)',
      'var(--shadow-xs), inset 0 0 0 1px var(--color-selected-indicator)',
    ]);
    // 이 2가지가 곧 핀 8곳 중 box-shadow 핀 2곳의 실측 값이다(아래 "도출 근거 고정" describe와 대응).
    expect(CANONICAL_DECLS.filter((e) => e.prop === 'box-shadow').map((e) => e.form)).toEqual(CANON_SHADOW_VALUES);
  });
  it('2가지 실측 문자열은 canonical + visible (무회귀)', () => {
    for (const value of CANON_SHADOW_VALUES) {
      expect(classifyRelevantDecl('box-shadow', value).syntax, value).toBe('canonical');
      expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible, value).toBe(true);
    }
  });
  it.each([
    ['미정의 토큰 opaque layer(브라우저는 선언 전체 폐기)', `var(--does-not-exist), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['다른 shadow 토큰(--shadow-md)', `var(--shadow-md), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['다른 shadow 토큰(--shadow-lg)', `var(--shadow-lg), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['보호 접두 밖 토큰', `var(--anything), ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['레이어 순서 반전', `${CANON_SHADOW_INDICATOR_LAYER}, ${CANON_SHADOW_OPAQUE_LAYER}`],
    ['opaque layer 중복', `${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_OPAQUE_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['indicator layer 중복', `${CANON_SHADOW_INDICATOR_LAYER}, ${CANON_SHADOW_INDICATOR_LAYER}`],
    ['opaque layer 단독(인디케이터 소실)', CANON_SHADOW_OPAQUE_LAYER],
    ['indicator 토큰만 다름', 'inset 0 0 0 1px var(--color-border)'],
    ['spread만 다름(2px)', 'inset 0 0 0 2px var(--color-selected-indicator)'],
    ['offset만 다름(1px)', 'inset 1px 0 0 1px var(--color-selected-indicator)'],
    ['단위만 다름(0.0625rem)', 'inset 0 0 0 0.0625rem var(--color-selected-indicator)'],
    ['콤마 뒤 공백 없음', `${CANON_SHADOW_OPAQUE_LAYER},${CANON_SHADOW_INDICATOR_LAYER}`],
  ])('RED: %s', (_label, value) => {
    // 선재현: 앞 두 벡터는 현행 HEAD에서 visible=true(false-green)였다.
    expect(classifyRelevantDecl('box-shadow', value).syntax, value).toBe('non-canonical');
    expect(evalIndicatorCss(`.X{box-shadow:${value}}`, IND).visible, value).toBe(false);
  });
  it('opaque layer 자리에는 var(--shadow-xs) 정확일치만 — 일반 var(--name) 패턴은 판정에 쓰이지 않는다', () => {
    // CANON_VAR_REF_RE(needle 파서)는 var(--does-not-exist)를 여전히 매치한다 — 그러나 그 사실이
    // 선언 값 판정에 아무 영향을 주지 않는다는 것이 I2 축소의 요지다.
    expect(CANON_VAR_REF_RE.test('var(--does-not-exist)')).toBe(true);
    expect(classifyRelevantDecl('box-shadow', `var(--does-not-exist), ${CANON_SHADOW_INDICATOR_LAYER}`).syntax)
      .toBe('non-canonical');
  });
});

describe('I3(18R) — 벤더 프리픽스 relevant 선언은 전부 non-canonical(이름 비대칭 폐쇄)', () => {
  // 선재현: `-webkit-box-shadow: initial !important`·`-webkit-box-shadow: unset`이 인디케이터 핀에서
  // visible=true였다 — CSS-wide로 인정된 뒤 `prop === 'box-shadow'`에 미매치해 **border 셀**을 초기화하고
  // shadow 셀은 손대지 않았기 때문(relevance는 deprefix, evaluator는 raw 이름 = 비대칭).
  it.each([
    ['-webkit-box-shadow', 'initial'],
    ['-webkit-box-shadow', 'unset'],
    ['-webkit-box-shadow', 'inherit'],
    ['-webkit-box-shadow', 'none'],
    ['-moz-box-shadow', 'initial'],
    ['-moz-border-image', 'initial'],
    ['-webkit-border-image', 'unset'],
    ['-o-border-width', 'initial'],
    ['-ms-border-color', 'unset'],
    ['-webkit-box-shadow', 'inset 0 0 0 1px var(--color-selected-indicator)'], // 값이 canonical이어도 RED
    ['-webkit-border-image', 'url(a.png)'],
  ])('%s: %s 는 non-canonical', (prop, value) => {
    const cls = classifyRelevantDecl(prop, value);
    expect(cls).toEqual({ syntax: 'non-canonical', prop, value: normalizeDeclValue(value) });
  });

  it('인디케이터 핀: -webkit-box-shadow의 CSS-wide 리셋은 이제 RED (선재현 visible=true)', () => {
    for (const decl of ['-webkit-box-shadow:initial !important', '-webkit-box-shadow:unset', '-moz-border-image:initial']) {
      const res = evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_INDICATOR_LAYER};${decl}}`, IND);
      expect(res.visible, decl).toBe(false);
      expect(res.nonCanonical.length, decl).toBeGreaterThan(0); // border 셀 초기화 부작용이 아니라 canonical 위반으로 RED
    }
  });

  it('border 핀도 동일 — RED의 이유가 nonCanonical이다(부작용 경유 아님)', () => {
    const res = evalBorderCss(`.X{border:1px solid ${V};-moz-border-image:initial}`, CIB);
    expect(res.visible).toBe(false);
    expect(res.nonCanonical.join(' ')).toMatch(/-moz-border-image: initial/);
    expect(res.border).toEqual({ width: 1, style: 'solid', token: CIB }); // 부작용 없음(셀 그대로)
  });

  it('수집(relevance)은 계속 deprefix한다 — 수집 누락(층 1 무력화)과 판정 거부는 별개 계약', () => {
    expect(isRelevantProp('-webkit-box-shadow')).toBe(true);
    expect(isRelevantProp('-moz-border-image')).toBe(true);
    expect(isRelevantProp('-ms-border-radius')).toBe(false);
    expect(isRelevantProp('--webkit-color-x')).toBe(false); // 커스텀 프로퍼티는 deprefix 무영향
  });

  it('프리픽스 없는 실핀 형태는 무회귀 GREEN', () => {
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_INDICATOR_LAYER).syntax).toBe('canonical');
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical');
  });
});

describe('I4(18R) — @property 등록 스윕(inventory 누락 폐쇄)', () => {
  const AT = (name) => `@property ${name} { syntax: "<color>"; inherits: false; initial-value: transparent; }`;
  it.each([
    ['--color-input-border'],
    ['--color-selected-indicator'],
    ['--shadow-xs'],
    ['--track-x'],
  ])('보호 접두 등록 %s 는 offender (선재현: offenders 0)', (name) => {
    const offenders = findProtectedDeclarations(AT(name));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatch(/@property/);
  });
  it('at-rule 이름 대문자 변형(@PROPERTY)도 동일하게 검출 — I3식 이름 비대칭 재발 방지', () => {
    expect(findProtectedDeclarations('@PROPERTY --color-x{syntax:"*";inherits:false}')).toHaveLength(1);
  });
  it('at-rule 이름 escape(@\\70 roperty)는 postcss가 파싱 거부 — P4 스윕이 offender로 표면화(fail-closed)', () => {
    // 디코더를 통과시켜도 도달할 수 없는 경로다: postcss.parse가 "At-rule without name"으로 throw한다.
    // 침묵 스킵이 아니라 sweepFileForProtectedDeclarations의 try/catch가 offender로 올려 RED가 된다.
    expect(() => findProtectedDeclarations('@\\70 roperty --color-x{syntax:"*";inherits:false}')).toThrow();
  });
  it('등록 이름 자체가 escape돼도 디코딩 후 검출', () => {
    expect(findProtectedDeclarations('@property \\--color-x{syntax:"*";inherits:false}')).toHaveLength(1);
    expect(findProtectedDeclarations('@property --\\63 olor-x{syntax:"*";inherits:false}')).toHaveLength(1);
  });
  it('@media 등으로 감싸도 walkAtRules 전수 방문으로 검출', () => {
    expect(findProtectedDeclarations(`@media (min-width:0){${AT('--color-x')}}`)).toHaveLength(1);
  });
  it('보호 접두 밖 이름(--brand-x)·대문자(--Color-x)는 미검출(오검출 방지)', () => {
    expect(findProtectedDeclarations(AT('--brand-x'))).toEqual([]);
    expect(findProtectedDeclarations(AT('--Color-x'))).toEqual([]);
  });
  it('다른 at-rule(@supports/@font-face)은 대상 아님', () => {
    expect(findProtectedDeclarations('@supports (display:block){.Foo{color:red}}')).toEqual([]);
    expect(findProtectedDeclarations('@font-face{font-family:X;src:url(a.woff2)}')).toEqual([]);
  });
  it('structuralGate도 @property 등록을 3블록 계약 위반으로 throw', () => {
    const cssText = `:root{--color-a:1}html[data-theme='dark']{--color-a:2}:root{--color-b:3}${AT('--color-input-border')}`;
    expect(() => structuralGate(cssText)).toThrow(/보호 토큰|3블록/);
  });
  it('P4 스윕 경로(sweepFileForProtectedDeclarations 판정 로직)와 동일 함수를 공유한다', () => {
    // findProtectedDeclarations가 단일 판정 지점이므로 styles/ 전체 스윕도 자동으로 @property를 본다.
    expect(findProtectedDeclarations(AT('--color-x')).length).toBeGreaterThan(0);
  });
  it('실 레포 styles/ 전체에 보호 접두 @property 등록이 없다(현행 0건 고정)', () => {
    const stylesDir = resolve(__dirname, '../styles');
    const offenders = readdirSync(stylesDir, { recursive: true }).map(String)
      .filter(isProtectedSweepTarget)
      .flatMap((f) => {
        try { return findProtectedPropertyRegistrations(postcss.parse(siteCssText(f))).map((o) => `${f}: ${o}`); }
        catch (e) { return [`${f}: 파싱 실패 — ${String((e && e.message) || e).split('\n')[0]}`]; }
      });
    expect(offenders).toEqual([]);
  });
});

describe('M1(18R) — classifyRelevantDecl이 CANONICAL_DECLS를 직접 dispatch한다(단일 정본 증명)', () => {
  // 이전 classifier는 배열을 조회하지 않고 별도 regex(CANON_BORDER_RE 등)를 썼다 — entry의 prop/re를
  // 훼손해도 판정이 그대로여서 "CANONICAL_DECLS가 정본"이라는 주석이 사실이 아니었다. 아래 mutation이
  // 판정 결과를 실제로 바꾼다는 것이 단일화의 증거다(mutation 후 반드시 원복).
  const withMutated = (id, patch, fn) => {
    const entry = CANONICAL_DECLS.find((e) => e.id === id);
    const backup = { ...entry };
    try { Object.assign(entry, patch); fn(); } finally { Object.assign(entry, backup); }
  };
  it('canonical 결과에 판정한 entry.id가 실려 나온다(추적 가능성)', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V}`).id).toBe('border-shorthand');
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).id).toBe('box-shadow-indicator-only');
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[1]).id).toBe('box-shadow-opaque-then-indicator');
  });
  it('entry.re 훼손 → border 판정이 canonical에서 non-canonical로 바뀐다', () => {
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical');
    withMutated('border-shorthand', { re: /^__never__$/ }, () => {
      expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('non-canonical');
      expect(evalBorderCss(`.X{border:1px solid ${V}}`, CIB).visible).toBe(false);
    });
    expect(classifyRelevantDecl('border', `1px solid ${V}`).syntax).toBe('canonical'); // 원복 확인
  });
  it('entry.prop 훼손 → 같은 값이 더 이상 box-shadow에서 매치되지 않는다', () => {
    withMutated('box-shadow-indicator-only', { prop: '__never__' }, () => {
      expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).syntax).toBe('non-canonical');
    });
    expect(classifyRelevantDecl('box-shadow', CANON_SHADOW_VALUES[0]).syntax).toBe('canonical');
  });
  it('entry.build 훼손 → 층 2 가시성 계산 입력(모델)이 바뀌어 GREEN이 무너진다', () => {
    withMutated('box-shadow-indicator-only', { build: () => ({ form: 'box-shadow', layers: [] }) }, () => {
      expect(evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_VALUES[0]}}`, IND).visible).toBe(false);
    });
    expect(evalIndicatorCss(`.X{box-shadow:${CANON_SHADOW_VALUES[0]}}`, IND).visible).toBe(true);
  });
  it('배열 항목 수·prop 커버리지 고정 — 근거 없는 확장 금지', () => {
    expect(CANONICAL_DECLS.map((e) => e.id)).toEqual([
      'border-shorthand', 'box-shadow-indicator-only', 'box-shadow-opaque-then-indicator',
    ]);
    expect([...new Set(CANONICAL_DECLS.map((e) => e.prop))]).toEqual(['border', 'box-shadow']);
    for (const e of CANONICAL_DECLS) expect(typeof e.build, e.id).toBe('function');
  });
});

describe('S4 cssColorLiterals', () => {
  it.each([
    ['url("a#fff")', []], ['url(data:image/svg+xml,%23fff)', []], ["'#fff'", []],
    ['0 0 0 1px rgba(0,0,0,0.12), 0 1px 2px #ABC', ['rgba(0,0,0,0.12)', '#ABC']],
    ['#5E6AD2F', ['#5E6AD2F']], ['foo#fffbar', []],
  ])('extract %s', (input, out) => expect(EV.extractColorLiterals(input)).toEqual(out));
});
describe('S4 normColor / resolveLight', () => {
  it.each([['#fff', '#ffffff'], ['#FFFFFF', '#ffffff'], ['rgba(28, 28, 28, 0.32)', 'rgba(28,28,28,0.32)'], ['#ABCD', '#aabbccdd']])
    ('norm %s', (a, b) => expect(EV.normColor(a)).toBe(b));
  it('resolve direct', () => expect(EV.resolveLight('--x', { '--x': '#E5E5E5' })).toBe('#E5E5E5'));
  it('resolve alias chain', () => expect(EV.resolveLight('--a', { '--a': 'var(--b)', '--b': 'var(--c)', '--c': '#6B7280' })).toBe('#6B7280'));
});
describe('S4 projectSource', () => {
  const src = ['a { color: #FFFFFF; }', 'b { border: 1px solid $track-border; }', 'c { background: rgba(94,106,210,0.1); }'].join('\n');
  const one = (o) => EV.projectSource(src, [o], [], '', 'T');
  it('lit', () => expect(one({ id: 'x', f: 'T', l: 1, k: 'lit', from: '#FFFFFF', to: 'var(--track-card)' }).projected).toContain('var(--track-card)'));
  it('txt', () => expect(one({ id: 'x', f: 'T', l: 2, k: 'txt', from: '$track-border', to: '$color-input-border' }).projected).toContain('$color-input-border'));
  it('tint alpha 보존', () => expect(one({ id: 'x', f: 'T', l: 3, k: 'tint', from: '94,106,210', to: 'color-mix(in srgb, var(--color-primary) {P}%, transparent)' }).projected).toContain('10%'));
  it('DUP_LINE', () => expect(EV.projectSource(src, [{ id: 'a', f: 'T', l: 1, k: 'lit', from: '#FFFFFF', to: 'x' }, { id: 'b', f: 'T', l: 1, k: 'lit', from: '#FFFFFF', to: 'y' }], [], '', 'T').errors.join()).toMatch(/DUP_LINE/));
  it('LIT_MATCH', () => expect(one({ id: 'x', f: 'T', l: 1, k: 'lit', from: '#000000', to: 'y' }).errors.join()).toMatch(/LIT_MATCH/));
  it('annotation 파일 필터', () => expect(EV.projectSource(src, [], [{ f: 'X', l: 1, marker: '[m]', anchor: 'color', text: '// [m]' }], '', 'T').projected).not.toContain('[m]'));
});
describe('S4 validateAnnotations', () => {
  const pre = ['a { color: #FFFFFF; }', 'a { color: #FFFFFF; }'].join('\n');   // 완전히 동일한 anchor 2줄
  const ann = [{ f: 'T', l: 2, marker: '[S4:T2]', anchor: '#FFFFFF', text: '// [S4:T2] note' }];
  const files = { T: { rel: 't' }, X: { rel: 'x' } };
  const ok = ['a { color: #FFFFFF; }', '// [S4:T2] note', 'a { color: #FFFFFF; }'].join('\n');
  const moved = ['// [S4:T2] note', 'a { color: #FFFFFF; }', 'a { color: #FFFFFF; }'].join('\n');  // 동일 anchor 이동
  it('정상 GREEN', () => expect(EV.validateAnnotations({ T: ok, X: '' }, { T: pre, X: '' }, ann, files)).toEqual([]));
  it('동일 anchor 이동 RED', () => expect(EV.validateAnnotations({ T: moved, X: '' }, { T: pre, X: '' }, ann, files).join()).toMatch(/ANN_OCCURRENCE/));
  it('타 파일 FOREIGN', () => expect(EV.validateAnnotations({ T: ok, X: '// [S4:T2] note' }, { T: pre, X: '' }, ann, files).join()).toMatch(/ANN_FOREIGN/));
  it('marker 중복', () => expect(EV.validateAnnotations({ T: ok, X: '' }, { T: pre, X: '' }, [...ann, ...ann], files).join()).toMatch(/ANN_MARKER_DUP/));
  it('개수 0 RED', () => expect(EV.validateAnnotations({ T: pre, X: '' }, { T: pre, X: '' }, ann, files).join()).toMatch(/ANN_COUNT/));
  it('text 변조 RED', () => expect(EV.validateAnnotations({ T: ok.replace('note', 'x'), X: '' }, { T: pre, X: '' }, ann, files).join()).toMatch(/ANN_TEXT|ANN_COUNT/));
});
describe('S4 dark structure', () => {
  const mk = (selector, extra = {}) => ({ file: 't', selector, property: 'color', declarationOccurrence: 0, atRules: [], important: false, value: 'red', ...extra });
  it('suffix 정상', () => expect(EV.validateDarkStructure([mk('.a'), mk(EV.DARK_PREFIX + ' .b')], ['t'], { t: 1 })).toEqual([]));
  it('darkish RED', () => expect(EV.validateDarkStructure([mk('.a'), mk('html[data-theme=darkish] .b')], ['t'], { t: 1 }).join()).toMatch(/DARK_FOREIGN_SELECTOR|DARK_COUNT/));
  it('comma branch prefix 제거 RED', () => expect(EV.validateDarkStructure([mk('.a'), mk(EV.DARK_PREFIX + ' .b, .c')], ['t'], { t: 1 }).join()).toMatch(/DARK_FOREIGN_SELECTOR/));
  it('count 불일치 RED', () => expect(EV.validateDarkStructure([mk('.a')], ['t'], { t: 1 }).join()).toMatch(/DARK_COUNT/));
  it('!important RED', () => expect(EV.validateDarkStructure([mk('.a'), mk(EV.DARK_PREFIX + ' .b', { important: true })], ['t'], { t: 1 }).join()).toMatch(/DARK_IMPORTANT/));
  it('@media RED', () => expect(EV.validateDarkStructure([mk('.a'), mk(EV.DARK_PREFIX + ' .b', { atRules: ['@media x'] })], ['t'], { t: 1 }).join()).toMatch(/DARK_ATRULE/));
});
describe('S4 contrast', () => {
  it.each([['#FFFFFF', 255], ['#fff', 255], ['#12345', null], ['#1234567', null]])('parse %s', (h, r) => {
    const c = EV.parseColorLiteral(h); expect(c === null ? null : c.r).toBe(r); });
  it('composite', () => expect(EV.compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 }).r).toBeCloseTo(127.5));
  it('ratio 흑백 21', () => expect(EV.contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 1));
  it('gradient worst-case', () => expect(EV.evaluateContrastCases([{ name: 'g', text: '--fg', min: 1, stack: [{ gradient: ['--a', '--b'] }] }],
    { '--fg': '#FFFFFF', '--a': '#000000', '--b': '#FFFFFF' }).results[0].ratio).toBeCloseTo(1, 1));
  it('실패 케이스', () => expect(EV.evaluateContrastCases([{ name: 'f', text: '--fg', min: 4.5, stack: [{ token: '--bg' }] }],
    { '--fg': '#777777', '--bg': '#888888' }).errors.join()).toMatch(/CONTRAST_FAIL/));
  it('mix 레이어', () => expect(EV.evaluateContrastCases([{ name: 'm', text: '--fg', min: 1, stack: [{ token: '--bg' }, { mix: '--ink', pct: 50 }] }],
    { '--fg': '#FFFFFF', '--bg': '#000000', '--ink': '#FFFFFF' }).results[0].ratio).toBeGreaterThan(1));
});
describe('S4 atoms / coverage / counts / fingerprint / canonicalize', () => {
  it('중첩 --blocked atom 포함', () => expect(EV.atomsFromSelectors([{ selector: '.TrackTimeline__Bar--blocked' }]).has('TrackTimeline__Bar--blocked')).toBe(true));
  it('축약 atom miss', () => expect(EV.atomsFromSelectors([{ selector: '.TrackHeader__ViewBtn--active' }]).has('TrackHeader__ViewBtn--activ')).toBe(false));
  it('coverage 정상', () => expect(EV.validateSmokeCoverage({ new: [], changed: [] }, [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] }])).toEqual([]));
  it('mask로는 해소 불가', () => expect(EV.validateSmokeCoverage({ new: [{ selector: EV.DARK_PREFIX + ' .Zz' }], changed: [] },
    [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: ['.Zz'] }]).join()).toMatch(/SMOKE_UNMAPPED/));
  it('observed로 해소', () => expect(EV.validateSmokeCoverage({ new: [{ selector: EV.DARK_PREFIX + ' .Zz' }], changed: [] },
    [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [{ selector: '.Zz' }], darkReviewSelectors: [] }])).toEqual([]));
  it('state 미증명 RED', () => expect(EV.validateSmokeCoverage({ new: [], changed: [] },
    [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [{ selector: '.b', state: 'hover' }], darkReviewSelectors: [] }]).join()).toMatch(/SURFACE_STATE_UNPROVEN/));
  it('surface 이름 중복 RED', () => expect(EV.validateSmokeCoverage({ new: [], changed: [] },
    [{ name: 'a', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] }, { name: 'a', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] }]).join()).toMatch(/SURFACE_NAME_DUP/));
  it('counts 불일치', () => expect(EV.validateCounts({ counts: { conversions: 1 }, changed: [] }, { conversions: 2 }).join()).toMatch(/conversions/));
  it('allowId 누락', () => expect(EV.validateCounts({ counts: { conversions: 1, changed: 0, new: 0, newRules: 0, residual: 0, raw: 0, processed: 0, allowBearing: 0 },
    changed: [] }, { conversions: 1, changedDecls: 0, newDecls: 0, newRules: 0, residual: 0, rawLiterals: 0, processedLiterals: 0, allowIds: 1 }).join()).toMatch(/allowId/));
  it('fingerprint BASE 민감', () => expect(EV.specFingerprint(SPEC, sha256)).not.toBe(EV.specFingerprint({ ...SPEC, BASE: 'zzz' }, sha256)));
  it('fingerprint surfaces 민감', () => expect(EV.specFingerprint(SPEC, sha256)).not.toBe(
    EV.specFingerprint({ ...SPEC, REQUIRED_SMOKE_SURFACES: SPEC.REQUIRED_SMOKE_SURFACES.slice(1) }, sha256)));
  it('canonicalize 순서 보존', () => expect(JSON.stringify(CANON.canonicalize([{ b: 1, a: 2 }, { a: 3 }]))).toBe('[{"a":2,"b":1},{"a":3}]'));
  it('배열 순서 변화 = 다른 해시', () => expect(CANON.bundleString([{ url: '/x', body: [1, 2] }])).not.toBe(CANON.bundleString([{ url: '/x', body: [2, 1] }])));
});
describe('S4 action resolver', () => {
  // 실제 구조의 대표 context — 러너가 쓰는 것과 같은 shape
  const CTX = { trackId: 42, normalItemTitle: 'Synthetic Item A', branchName: 'SB', epicName: 'SE',
    addMenuEpicLabel: 'Epic', scrumBoardId: 7, scrumInactivePreset: '#DC2626',
    settingsPreset: { editBranchIndex: 0, inactivePresetValue: '#16A34A' } };
  it('24 surface 전 액션이 미해결 0으로 치환', () => {
    const flat = EV.buildActionContext(CTX);
    const all = SPEC.REQUIRED_SMOKE_SURFACES.flatMap((s2) => EV.resolveActions(s2.actions, flat).errors);
    expect(all).toEqual([]);
  });
  it('치환 후 모든 nth가 0 이상 정수', () => {
    const flat = EV.buildActionContext(CTX);
    for (const s2 of SPEC.REQUIRED_SMOKE_SURFACES)
      for (const a of EV.resolveActions(s2.actions, flat).resolved)
        if (a.nth !== undefined) { expect(Number.isInteger(a.nth)).toBe(true); expect(a.nth).toBeGreaterThanOrEqual(0); }
  });
  it('치환 후 문자열 필드에 {...} 잔존 0', () => {
    const flat = EV.buildActionContext(CTX);
    for (const s2 of SPEC.REQUIRED_SMOKE_SURFACES)
      for (const a of EV.resolveActions(s2.actions, flat).resolved)
        for (const f of ['url', 'selector', 'hasText', 'key', 'value'])
          if (typeof a[f] === 'string') expect(a[f]).not.toMatch(/\{[A-Za-z0-9_]+\}/);
  });
  it('두 번째 branch(editBranchIndex=1)도 정상 치환', () => {
    const flat = EV.buildActionContext({ ...CTX, settingsPreset: { ...CTX.settingsPreset, editBranchIndex: 1 } });
    const st = SPEC.REQUIRED_SMOKE_SURFACES.find((x) => x.name === 'settings-branches-edit');
    const { resolved, errors } = EV.resolveActions(st.actions, flat);
    expect(errors).toEqual([]);
    const edit = resolved.find((a) => a.op === 'click' && a.selector.includes('IconBtn'));
    expect(edit.selector).toContain("title='Edit display name / color'");   // Remove 버튼과 섞이지 않는다
    expect(edit.nth).toBe(1);
    const sw = resolved.find((a) => a.op === 'click' && a.selector.includes('Swatch'));
    expect(sw.selector).toBe(".SettingsBranches__Swatch[aria-label='#16A34A']");
    expect(sw.nth).toBeUndefined();                                          // 순번이 아니라 값으로 지정
  });
  it('nested key 누락 → UNRESOLVED', () => {
    const bad = { ...CTX, settingsPreset: undefined };
    const errs = SPEC.REQUIRED_SMOKE_SURFACES.flatMap((s2) => EV.resolveActions(s2.actions, EV.buildActionContext(bad)).errors);
    expect(errs.join()).toMatch(/UNRESOLVED_PLACEHOLDER/);
  });
  it('nth placeholder 미해결 → UNRESOLVED(이전 false-green)', () => expect(
    EV.resolveActions([{ op: 'click', selector: '.X', nth: '{someMissingKey}' }], {}).errors.join()).toMatch(/UNRESOLVED_PLACEHOLDER/));
  it('nth 음수 → INVALID_NTH', () => expect(
    EV.resolveActions([{ op: 'click', selector: '.X', nth: '-1' }], {}).errors.join()).toMatch(/INVALID_NTH/));
  it('nth 소수 → INVALID_NTH', () => expect(
    EV.resolveActions([{ op: 'click', selector: '.X', nth: '1.5' }], {}).errors.join()).toMatch(/INVALID_NTH/));
});
describe('S4 privacy audit', () => {
  const NAMES = SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.captureName);
  const h = (i) => String(i).padStart(64, '0');
  const EXP = { captures: NAMES.map((c, i) => ({ captureName: c, sha256: h(i) })), contextSubjectSha256: h(99) };
  const ok = () => ({ scope: 'dedicated-synthetic-account-workspace', contextPass: true,
    contextSubjectSha256: h(99),
    captures: NAMES.map((c, i) => ({ captureName: c, sha256: h(i), pass: true, findings: [] })) });
  it('정상 → []', () => expect(EV.validatePrivacyAudit(ok(), EXP)).toEqual([]));
  it('누락', () => expect(EV.validatePrivacyAudit(undefined, EXP).join()).toMatch(/PRIVACY_AUDIT_MISSING/));
  it('scope 불일치', () => { const a = ok(); a.scope = 'single-track';
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_SCOPE/); });
  it('contextPass false', () => { const a = ok(); a.contextPass = false;
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_CONTEXT_FAIL/); });
  it('captures 타입 오류', () => { const a = ok(); a.captures = 'x';
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_CAPTURES_TYPE/); });
  it('22건(개수 부족)', () => { const a = ok(); a.captures.pop();
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_CAPTURE_COUNT|PRIVACY_AUDIT_CAPTURE_SET/); });
  it('중복 captureName', () => { const a = ok(); a.captures[1].captureName = a.captures[0].captureName;
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_CAPTURE_DUP/); });
  it('pass false', () => { const a = ok(); a.captures[2].pass = false;
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_FAIL/); });
  it('pass true + findings 존재(모순)', () => { const a = ok(); a.captures[3].findings = ['실사용자 이름 노출'];
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_FINDINGS_NONEMPTY/); });
  it('findings 누락·타입 오류', () => { const a = ok(); delete a.captures[4].findings; a.captures[5].findings = [1];
    const e = EV.validatePrivacyAudit(a, EXP).join();
    expect(e).toMatch(/PRIVACY_AUDIT_FINDINGS_TYPE/); expect(e).toMatch(/PRIVACY_AUDIT_FINDINGS_ITEM/); });
  // ── 감사 대상 바이트 결속(검수 Important)
  it('감사 후 PNG 교체 → SUBJECT_DRIFT', () => { const a = ok();
    const exp2 = { ...EXP, captures: EXP.captures.map((c, i) => (i === 6 ? { ...c, sha256: h(777) } : c)) };
    expect(EV.validatePrivacyAudit(a, exp2).join()).toMatch(/PRIVACY_AUDIT_SUBJECT_DRIFT/); });
  it('감사 후 context 필드 변경 → CONTEXT_SUBJECT_DRIFT', () =>
    expect(EV.validatePrivacyAudit(ok(), { ...EXP, contextSubjectSha256: h(1234) }).join())
      .toMatch(/PRIVACY_AUDIT_CONTEXT_SUBJECT_DRIFT/));
  it('capture sha 누락 → SUBJECT_DRIFT', () => { const a = ok(); delete a.captures[7].sha256;
    expect(EV.validatePrivacyAudit(a, EXP).join()).toMatch(/PRIVACY_AUDIT_SUBJECT_DRIFT/); });
});
describe('S4 smoke manifest', () => {
  it('surface 수 고정', () => expect(SPEC.REQUIRED_SMOKE_SURFACES.length).toBe(24));
  it('이름 exact manifest', () => expect(SPEC.REQUIRED_SMOKE_SURFACES.map((s) => s.name)).toEqual(SURFACE_NAMES));
  it('schema 필수 필드', () => SPEC.REQUIRED_SMOKE_SURFACES.forEach((s) => {
    expect(Array.isArray(s.actions)).toBe(true); expect(Array.isArray(s.coverageSelectors)).toBe(true);
    expect(Array.isArray(s.darkReviewSelectors)).toBe(true); expect(Array.isArray(s.requiredElements)).toBe(true);
    expect(typeof s.captureName).toBe('string'); }));
  it('상태 의존은 provenBy 보유', () => SPEC.REQUIRED_SMOKE_SURFACES.forEach((s) => s.coverageSelectors
    .filter((o) => o.state).forEach((o) => expect(s.actions[o.provenBy]).toBeDefined())));
});

describe('S4 pixel diff', () => {
  const mk = (w, h, fill) => { const p = new PNG({ width: w, height: h });
    for (let i = 0; i < p.data.length; i += 4) { p.data[i] = fill[0]; p.data[i+1] = fill[1]; p.data[i+2] = fill[2]; p.data[i+3] = 255; }
    return PNG.sync.write(p); };
  const withPixel = (w, h, fill, x, y, c) => { const p = PNG.sync.read(mk(w, h, fill));
    const i = (w * y + x) << 2; p.data[i] = c[0]; p.data[i+1] = c[1]; p.data[i+2] = c[2]; return PNG.sync.write(p); };
  it('동일 이미지 → diff 0', () => expect(PIX.diffPng(mk(8, 8, [255,255,255]), mk(8, 8, [255,255,255]), []).diff).toBe(0));
  it('1픽셀 차이 → diff 1', () => expect(PIX.diffPng(mk(8, 8, [255,255,255]), withPixel(8, 8, [255,255,255], 3, 3, [0,0,0]), []).diff).toBe(1));
  it('그 픽셀을 덮는 rect → diff 0', () => expect(PIX.diffPng(mk(8, 8, [255,255,255]),
    withPixel(8, 8, [255,255,255], 3, 3, [0,0,0]), [{ x: 2, y: 2, width: 3, height: 3 }]).diff).toBe(0));
  it('크기 불일치 → ok:false SIZE', () => { const r = PIX.diffPng(mk(8, 8, [255,255,255]), mk(9, 8, [255,255,255]), []);
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/SIZE/); });
});

// Task 2 Step 5가 출력한 sha256으로 이 값을 채운다(그 커밋 diff에 값이 드러나야 한다)
const S4_EXPECTED_SHA256 = '7dcb3ef6fb5d040f594e9d43872384545467fb199510a733ad4733524f132213';
describe('S4 fixture 동결', () => {
  it('상수가 64자리 hex이고 미교체 placeholder가 아님', () => {
    expect(S4_EXPECTED_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(S4_EXPECTED_SHA256).not.toBe('0'.repeat(64));
  });
  it('fixture 해시가 상수와 일치', () => {
    const raw = readFileSync(new URL('./__fixtures__/s4-expected.json', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(S4_EXPECTED_SHA256);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S4 마스크 계약 — allow 선언 → 마스크 정본 → 브라우저 좌표 → pixel diff 소비까지.
// 이전 판에서는 이 사슬의 각 고리가 서로를 검사하지 않아 (a) live allow #6의 마스크 누락
// (b) spec 밖 selector가 context에 유입 (c) border rect를 paint rect로 오인 (d) no-op validator
// 주입 (e) unknown surface 빈 비교가 전부 GREEN이었다. 아래는 그 폐쇄를 고정한다.
// ─────────────────────────────────────────────────────────────────────────────
const S4_MK = (x, y, w, h, scale, outset) => ({ x, y, width: w, height: h, scale,
  paintRect: { x: x - outset * scale, y: y - outset * scale, width: w + 2 * outset * scale, height: h + 2 * outset * scale } });

// ── 단위 mutation 전용 독립 정본 ────────────────────────────────────────────
// 프로덕션 SPEC/fixture에서 파생하지 않는다. 파생하면 spec 자체의 좌표·property 오류가
// "정답"으로 함께 이동해 self-oracle이 된다(리뷰 지적). ID를 1,4로 비연속으로 둬서
// 연속 번호 가정(1..N)이 다시 들어오면 즉시 드러나게 한다.
const UNIT_SPEC = {
  LIGHT_DIFF_MASKS: {
    1: { selector: '.UnitPlain', paintOutsetPx: 0, expectedScale: 1 },
    4: { selector: '.UnitRing', paintOutsetPx: 3, expectedScale: 1.08 },
  },
  REQUIRED_SMOKE_SURFACES: [
    { name: 'unit-a', captureName: 'unit-a.png', actions: [], requiredElements: [], coverageSelectors: [{ selector: '.UnitPlain' }], darkReviewSelectors: [] },
    { name: 'unit-b', captureName: 'unit-b.png', actions: [], requiredElements: [], coverageSelectors: [{ selector: '.UnitRing' }], darkReviewSelectors: [] },
  ],
  // evaluateConformance가 참조하는 최소 형태(내용은 단위 격리용 더미)
  FILES: { P: { rel: 'unit.scss', blob: 'x' }, R: { rel: 'unit-settings.scss', blob: 'y' } },
  DARK_DECL_COUNTS: { P: 0, R: 0 },
  COUNTS: { conversions: 2, changedDecls: 2, newDecls: 0, newRules: 0, residual: 0, rawLiterals: 0, processedLiterals: 0, allowIds: 2 },
  CONVERSIONS: [{ ident: { t: 'allow', id: 1 } }, { ident: { t: 'allow', id: 4 } }],
  ANNOTATIONS: [], OVERRIDES: {}, CONTRAST_CASES: [], CONTRAST_REFERENCE: {},
};
// ── UNIT 세계: 실제 declaration에 결속 ────────────────────────────────────
// 이전 판은 file/property를 문자열로만 분리하고 actualDecls를 비워둬서, ring의 property를
// box-shadow→background로 fixture·changed·actual map에서 함께 바꿰도 conformance가 clean이었다.
// 여기서는 선언 목록·expectedAfter·actual attribution 맵을 **각각 독립 리터럴**로 적어,
// 한 축만 어긋나면 공용 경로가 RED가 되게 한다.
const UNIT_DECLS = [
  { key: 'unit.scss||.UnitPlain|background|0', file: 'unit.scss', atRules: [], selector: '.UnitPlain',
    property: 'background', declarationOccurrence: 0, value: 'var(--u-plain)', important: false },
  { key: 'unit-settings.scss||.UnitRing|box-shadow|0', file: 'unit-settings.scss', atRules: [], selector: '.UnitRing',
    property: 'box-shadow', declarationOccurrence: 0, value: '0 0 0 3px var(--u-ring)', important: false },
];
// BASE 선언(변환 전) — before/beforeImportant 대조용 독립 리터럴
const UNIT_BASE_DECLS = [
  { key: 'unit.scss||.UnitPlain|background|0', file: 'unit.scss', atRules: [], selector: '.UnitPlain',
    property: 'background', declarationOccurrence: 0, value: '#111111', important: false },
  { key: 'unit-settings.scss||.UnitRing|box-shadow|0', file: 'unit-settings.scss', atRules: [], selector: '.UnitRing',
    property: 'box-shadow', declarationOccurrence: 0, value: '0 0 0 3px #222222', important: false },
];
// 독립 리터럴 — UNIT_DECLS에서 파생하지 않는다(파생하면 다시 self-oracle).
const UNIT_EXPECTED_AFTER = [
  { key: 'unit.scss||.UnitPlain|background|0', value: 'var(--u-plain)', important: false },
  { key: 'unit-settings.scss||.UnitRing|box-shadow|0', value: '0 0 0 3px var(--u-ring)', important: false },
];
const UNIT_ACTUAL_ALLOW_MAP = new Map([
  [1, 'unit.scss||.UnitPlain|background|0'],
  [4, 'unit-settings.scss||.UnitRing|box-shadow|0'],
]);
const U_KEY = (sel) => (sel === '.UnitPlain'
  ? 'unit.scss||.UnitPlain|background|0' : 'unit-settings.scss||.UnitRing|box-shadow|0');
const U_SHA = (n) => String(n).repeat(64).slice(0, 64);
const unitFixture = () => ({
  allowIdToKey: { 1: U_KEY('.UnitPlain'), 4: U_KEY('.UnitRing') },
  changed: [
    { key: U_KEY('.UnitPlain'), file: 'unit.scss', atRules: [], selector: '.UnitPlain', property: 'background',
      declarationOccurrence: 0, before: '#111111', after: 'var(--u-plain)',
      beforeImportant: false, afterImportant: false, evidence: ['allow'], allowIds: [1] },
    { key: U_KEY('.UnitRing'), file: 'unit-settings.scss', atRules: [], selector: '.UnitRing', property: 'box-shadow',
      declarationOccurrence: 0, before: '0 0 0 3px #222222', after: '0 0 0 3px var(--u-ring)',
      beforeImportant: false, afterImportant: false, evidence: ['allow'], allowIds: [4] },
  ],
  new: [], residual: [], expectedAfter: JSON.parse(JSON.stringify(UNIT_EXPECTED_AFTER)),
  counts: { conversions: 2, changed: 2, new: 0, newRules: 0, residual: 0, raw: 0, processed: 0, allowBearing: 2 },
  smoke: { contextSha256: U_SHA('a'), captures: [
    { captureName: 'unit-a.png', sha256: U_SHA('b') },
    { captureName: 'unit-b.png', sha256: U_SHA('c') } ] },
});
const U_OWNER = (sel) => UNIT_SPEC.REQUIRED_SMOKE_SURFACES.find((x) => x.coverageSelectors.some((o) => o.selector === sel)).name;
// full matrix: 2 surface × 2 live selector, 미발견은 []
const unitCtx = () => {
  const ctx = { viewport: { width: 1440, height: 900 }, baseLightMaskRects: {} };
  for (const x of UNIT_SPEC.REQUIRED_SMOKE_SURFACES) {
    const bysel = {};
    for (const m of Object.values(UNIT_SPEC.LIGHT_DIFF_MASKS))
      bysel[m.selector] = U_OWNER(m.selector) === x.name
        ? [S4_MK(100, 100, 20, 20, m.expectedScale, m.paintOutsetPx)] : [];
    ctx.baseLightMaskRects[x.name] = bysel;
  }
  return ctx;
};
const unitObs = (ctx, surf) => Object.fromEntries(Object.values(UNIT_SPEC.LIGHT_DIFF_MASKS).map((m) => {
  const rects = (ctx.baseLightMaskRects[surf] || {})[m.selector] || [];
  return [m.selector, rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, scale: r.scale }))];
}));
const U_RING = '.UnitRing';

const s4Png = (w, h, fill) => { const p = new PNG({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) { p.data[i] = fill[0]; p.data[i+1] = fill[1]; p.data[i+2] = fill[2]; p.data[i+3] = 255; }
  return PNG.sync.write(p); };

describe('S4 마스크 정본 — allow ID 완전분할·selector 일치·coverage 소유', () => {
  const fx = unitFixture();
  it('allow ID 전체가 live — dead 예외 개념이 존재하지 않는다', () => {
    expect(SPEC.DEAD_ALLOW_IDS).toBeUndefined();
    expect(SPEC.DEAD_SELECTORS).toBeUndefined();
    const specIds = Object.keys(SPEC.LIGHT_DIFF_MASKS).map(Number).sort((a, b) => a - b);   // 프로덕션 정본 대조는 여기서만
    const convIds = [...new Set(SPEC.CONVERSIONS.filter((c) => c.ident.t === 'allow').map((c) => c.ident.id))].sort((a, b) => a - b);
    expect(specIds).toEqual(convIds);
  });
  it('정상 UNIT spec/fixture/context는 오류 0 (clean baseline)', () => expect(EV.validateMaskContract(fx, UNIT_SPEC, unitCtx())).toEqual([]));
  it('RED: live allow의 mask 삭제(ID 4)', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS } }; delete spec.LIGHT_DIFF_MASKS[4];
    expect(EV.validateMaskContract(fx, spec, unitCtx()).join()).toMatch(/MASK_ID_UNCLASSIFIED 4/);
  });
  it('RED: mask selector가 선언 selector와 불일치', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS, 4: { ...UNIT_SPEC.LIGHT_DIFF_MASKS[4], selector: '.Wrong' } } };
    expect(EV.validateMaskContract(fx, spec, unitCtx()).join()).toMatch(/MASK_SELECTOR_MISMATCH 4/);
  });
  it('RED: 비정규 ID 키 "01"은 "1"과 합쳐지지 않고 거부', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS, '01': UNIT_SPEC.LIGHT_DIFF_MASKS[1] } };
    expect(EV.validateMaskContract(fx, spec, unitCtx()).join()).toMatch(/MASK_ID_NONCANONICAL/);
  });
});

describe('S4 마스크 좌표 계약 — context rect', () => {
  const fx = unitFixture();
  const bad = (mut) => { const c = unitCtx(); mut(c, U_OWNER(U_RING)); return EV.validateMaskContract(fx, UNIT_SPEC, c).join(); };
  it('RED: spec 밖 selector 유입', () => expect(bad((c, s) => { c.baseLightMaskRects[s]['.Bogus'] = [S4_MK(1, 1, 5, 5, 1, 0)]; })).toMatch(/MASK_FOREIGN_SELECTOR/));
  it('RED: manifest에 없는 surface 이름', () => expect(bad((c) => { c.baseLightMaskRects.NOPE = { [U_RING]: [S4_MK(1, 1, 5, 5, 1.08, 3)] }; })).toMatch(/MASK_UNKNOWN_SURFACE NOPE/));
  it('RED: selector 키 생략(미조사) — [] 과 구분된다', () =>
    expect(bad((c, s) => { delete c.baseLightMaskRects[s][U_RING]; })).toMatch(/MASK_SELECTOR_NOT_SCANNED .*UnitRing/));
  it('RED: surface 통째 누락(미조사)', () =>
    expect(bad((c, s) => { delete c.baseLightMaskRects[s]; })).toMatch(/MASK_SURFACE_NOT_SCANNED/));
  it('RED: 전 surface에서 occurrence 0 → 그 마스크는 관측된 적이 없다', () =>
    expect(bad((c) => { for (const s of Object.keys(c.baseLightMaskRects)) c.baseLightMaskRects[s][U_RING] = []; }))
      .toMatch(/MASK_RECT_ABSENT .*UnitRing/));
  it('GREEN: 조사했고 0건인 화면은 빈 배열로 정상 표현', () => {
    const c = unitCtx();
    expect(c.baseLightMaskRects['unit-a'][U_RING]).toEqual([]);
    expect(EV.validateMaskContract(fx, UNIT_SPEC, c)).toEqual([]);
  });
  it('행렬 완전성: UNIT 2 surface × live 2 키를 전부 보유', () => {
    const c = unitCtx();
    expect(Object.keys(c.baseLightMaskRects).sort()).toEqual(UNIT_SPEC.REQUIRED_SMOKE_SURFACES.map((x) => x.name).sort());
    for (const s of Object.keys(c.baseLightMaskRects))
      expect(Object.keys(c.baseLightMaskRects[s]).sort()).toEqual(Object.values(UNIT_SPEC.LIGHT_DIFF_MASKS).map((m) => m.selector).sort());
  });
  it('RED: paintRect 누락(= border rect만)', () => expect(bad((c, s) => { delete c.baseLightMaskRects[s][U_RING][0].paintRect; })).toMatch(/MASK_PAINT_MISSING/));
  it('RED: paintRect 과소 확장', () => expect(bad((c, s) => { c.baseLightMaskRects[s][U_RING][0].paintRect.width -= 2; })).toMatch(/MASK_PAINT_MISMATCH/));
  it('RED: scale과 paintRect 동시 확대(내부 일관이어도 spec 기대와 다름)', () => expect(bad((c, s) => {
    const r = c.baseLightMaskRects[s][U_RING][0]; r.scale = 3;
    r.paintRect = { x: r.x - 9, y: r.y - 9, width: r.width + 18, height: r.height + 18 };
  })).toMatch(/MASK_SCALE_UNEXPECTED/));
  it('RED: width 0 / NaN / viewport 밖', () => {
    expect(bad((c, s) => { c.baseLightMaskRects[s][U_RING][0].width = 0; })).toMatch(/MASK_RECT_DEGENERATE/);
    expect(bad((c, s) => { c.baseLightMaskRects[s][U_RING][0].x = NaN; })).toMatch(/MASK_RECT_NONFINITE/);
    expect(bad((c, s) => { c.baseLightMaskRects[s][U_RING][0] = S4_MK(1439, 899, 20, 20, 1.08, 3); })).toMatch(/MASK_RECT_OUT_OF_VIEWPORT/);
  });
  it('GREEN: coverage owner가 아닌 surface의 정상 occurrence도 허용(모달 뒤 캔버스)', () => {
    const c = unitCtx();   // unit-a 소유 selector가 unit-b에도 실제로 보이는 상황
    c.baseLightMaskRects['unit-b']['.UnitPlain'].push(S4_MK(200, 200, 10, 10, 1, 0));
    expect(EV.validateMaskContract(fx, UNIT_SPEC, c)).toEqual([]);
  });
});

describe('S4 pixel diff 소비 — 단일 경로만 허용', () => {
  const fx = unitFixture();
  const IMG = () => s4Png(40, 40, [255, 255, 255]);
  const call = (over) => PIX.diffSurfaceLight({ baseBuf: IMG(), afterBuf: IMG(), fixture: fx, spec: UNIT_SPEC,
    context: unitCtx(), surfaceName: U_OWNER(U_RING), observed: unitObs(unitCtx(), U_OWNER(U_RING)), ...over });
  it('validator를 주입할 수 없다(정적 결속) — 인자를 넘겨도 무시된다', () => {
    const r = call({ validateMaskContract: () => [] });
    expect(r.errors).toEqual([]);                       // 정상 입력이라 GREEN
    const forged = unitCtx();
    forged.baseLightMaskRects[U_OWNER(U_RING)][U_RING][0].paintRect.width = 9999;
    const r2 = PIX.diffSurfaceLight({ baseBuf: IMG(), afterBuf: IMG(), fixture: fx, spec: UNIT_SPEC, context: forged,
      surfaceName: U_OWNER(U_RING), observed: unitObs(forged, U_OWNER(U_RING)), validateMaskContract: () => [] });
    expect(r2.errors.join()).toMatch(/MASK_PAINT_MISMATCH/);   // no-op validator로도 우회 불가
  });
  it('RED: observed 생략', () => expect(call({ observed: undefined }).errors.join()).toMatch(/OBSERVE_REQUIRED/));
  it('RED: selector 값이 배열이 아님 → KEY_MISSING', () => {
    const o = unitObs(unitCtx(), U_OWNER(U_RING)); o[U_RING] = {};
    expect(call({ observed: o }).errors.join()).toMatch(/OBSERVE_KEY_MISSING/);
  });
  it('RED: 같은 개수인데 좌표 누락 [{}] → NONFINITE', () => {
    const o = unitObs(unitCtx(), U_OWNER(U_RING)); o[U_RING] = [{}];
    expect(call({ observed: o }).errors.join()).toMatch(/OBSERVE_NONFINITE/);
  });
  it('RED: occurrence 개수 불일치', () => {
    const o = unitObs(unitCtx(), U_OWNER(U_RING)); o[U_RING] = [];
    expect(call({ observed: o }).errors.join()).toMatch(/OBSERVE_COUNT/);
  });
  it('RED: 요소 이동(정규화 경계 초과)', () => {
    const o = unitObs(unitCtx(), U_OWNER(U_RING));
    o[U_RING][0] = { ...o[U_RING][0], x: o[U_RING][0].x + 0.02 };
    expect(call({ observed: o }).errors.join()).toMatch(/OBSERVE_GEOMETRY/);
  });
  it('GREEN: 양자(1/64px) 미만 흔들림은 동일 좌표로 정규화', () => {
    const o = unitObs(unitCtx(), U_OWNER(U_RING));
    o[U_RING][0] = { ...o[U_RING][0], x: o[U_RING][0].x + 0.005 };
    expect(call({ observed: o }).errors).toEqual([]);
  });
  it('RED: manifest에 없는 surface는 빈 비교로 통과하지 못한다', () =>
    expect(call({ surfaceName: 'NOPE' }).errors.join()).toMatch(/SURFACE_UNKNOWN/));
  it('RED: context에 없는 surface', () => {
    const c = unitCtx(); const s = U_OWNER(U_RING); const o = unitObs(c, s); delete c.baseLightMaskRects[s];
    expect(PIX.diffSurfaceLight({ baseBuf: IMG(), afterBuf: IMG(), fixture: fx, spec: UNIT_SPEC, context: c, surfaceName: s, observed: o })
      .errors.join()).toMatch(/SURFACE_NOT_IN_CONTEXT/);
  });
  it('GREEN: 그 화면에 live selector가 하나도 없어도 정상(전부 빈 배열, maskCount 0)', () => {
    // UNIT 정본에 3번째 surface를 추가해 "조사했고 전부 0건"인 화면을 만든다.
    const spec = { ...UNIT_SPEC, REQUIRED_SMOKE_SURFACES: [...UNIT_SPEC.REQUIRED_SMOKE_SURFACES,
      { name: 'unit-empty', captureName: 'unit-empty.png', actions: [], requiredElements: [], coverageSelectors: [], darkReviewSelectors: [] }] };
    const c = unitCtx();
    c.baseLightMaskRects['unit-empty'] = Object.fromEntries(Object.values(spec.LIGHT_DIFF_MASKS).map((m) => [m.selector, []]));
    const o = Object.fromEntries(Object.values(spec.LIGHT_DIFF_MASKS).map((m) => [m.selector, []]));
    const r = PIX.diffSurfaceLight({ baseBuf: IMG(), afterBuf: IMG(), fixture: fx, spec, context: c, surfaceName: 'unit-empty', observed: o });
    expect(r.errors).toEqual([]); expect(r.maskCount).toBe(0);
  });
});

describe('S4 게이트 배선 — helper가 아니라 공용 경로가 잡는다', () => {
  const fx = unitFixture();
  // helper 직접 호출 테스트만 있으면 evaluateConformance에서 호출을 빼도 GREEN이다.
  // 배선 자체를 잠그기 위해 반드시 공용 conformance 경로로 단정한다.
  const conform = (spec) => EV.evaluateConformance(UNIT_DECLS, '', {}, spec, fx, UNIT_ACTUAL_ALLOW_MAP, UNIT_BASE_DECLS).join('\n');
  it('RED: 마스크 정본 위반도 evaluateConformance 경로에서 검출된다', () => {
    // evaluateConformance는 counts 등 다른 검사도 하지만, 여기서 잠그는 것은
    // "마스크 정본 위반이 helper 직접 호출이 아니라 **공용 경로**에서도 나오는가"다.
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS } }; delete spec.LIGHT_DIFF_MASKS[4];
    expect(conform(spec)).toMatch(/MASK_ID_UNCLASSIFIED 4/);
    expect(conform(UNIT_SPEC)).not.toMatch(/MASK_ID_UNCLASSIFIED/);
  });
});

describe('S4 public diffSurfaceLight — 마스크가 실제 픽셀 비교에 적용된다', () => {
  const fx = unitFixture();
  const SURF = U_OWNER(U_RING);
  // unitCtx의 ring rect = MK(100,100,20,20,1.08,3) → paintRect x/y 96.76, w/h 26.48 → 픽셀 96..123
  const W = 200, H = 200;
  const withPx = (x, y) => { const p = PNG.sync.read(s4Png(W, H, [255, 255, 255]));
    const i = (W * y + x) << 2; p.data[i] = 0; p.data[i + 1] = 0; p.data[i + 2] = 0; return PNG.sync.write(p); };
  const run = (afterBuf) => PIX.diffSurfaceLight({ baseBuf: s4Png(W, H, [255, 255, 255]), afterBuf,
    fixture: fx, spec: UNIT_SPEC, context: unitCtx(), surfaceName: SURF, observed: unitObs(unitCtx(), SURF) });
  it('마스크 내부 1픽셀 차이 → diff 0 (허용된 라이트 변화)', () => {
    const r = run(withPx(110, 110));
    expect(r.errors).toEqual([]); expect(r.maskCount).toBe(1); expect(r.diff).toBe(0); expect(r.ok).toBe(true);
  });
  it('마스크 외부 1픽셀 차이 → diff 1 (회귀 검출)', () => {
    const r = run(withPx(150, 150));
    expect(r.errors).toEqual([]); expect(r.diff).toBe(1); expect(r.ok).toBe(false);
  });
  it('마스크 경계 바로 바깥(124,124)도 검출된다', () => expect(run(withPx(124, 124)).diff).toBe(1));
});

describe('S4 observed 키 집합 — 누락·초과', () => {
  const fx = unitFixture();
  const SURF = U_OWNER(U_RING);
  const IMG = () => s4Png(40, 40, [255, 255, 255]);
  const call = (observed) => PIX.diffSurfaceLight({ baseBuf: IMG(), afterBuf: IMG(), fixture: fx, spec: UNIT_SPEC,
    context: unitCtx(), surfaceName: SURF, observed });
  it('RED: live selector 키를 실제로 삭제 → OBSERVE_KEY_MISSING', () => {
    const o = unitObs(unitCtx(), SURF); delete o[U_RING];
    expect(call(o).errors.join()).toMatch(/OBSERVE_KEY_MISSING .*UnitRing/);
  });
  it('RED: 정본에 없는 키 추가 → OBSERVE_EXTRA', () => {
    const o = unitObs(unitCtx(), SURF); o['.NotAMask'] = [];
    expect(call(o).errors.join()).toMatch(/OBSERVE_EXTRA .*\.NotAMask/);
  });
});

describe('S4 allow ID 네 집합 exact equality — 비연속 집합과 단독 변조', () => {
  // 재번호화 대신 CONVERSIONS · LIGHT_DIFF_MASKS · allowIdToKey · changed[].allowIds
  // 네 집합의 sorted exact equality를 강제한다. ID가 비연속(1,4)이어도 정상이어야 한다.
  const C = () => UNIT_SPEC.COUNTS;
  const run = (fx, spec) => EV.validateCounts(fx, (spec || UNIT_SPEC).COUNTS, spec).join('|');
  it('GREEN: 비연속 집합(1,4) 정상', () => expect(run(unitFixture(), UNIT_SPEC)).toBe(''));
  it('GREEN: 프로덕션 비연속 집합도 개수·집합 정합', () => {
    const ids = [...new Set(SPEC.CONVERSIONS.filter((c) => c.ident.t === 'allow').map((c) => c.ident.id))].sort((a, b) => a - b);
    expect(ids).toEqual(Object.keys(SPEC.LIGHT_DIFF_MASKS).map(Number).sort((a, b) => a - b));
    expect(ids.length).toBe(SPEC.COUNTS.allowIds);
    expect(ids).not.toEqual(ids.map((_, i) => i + 1));            // 연속이 아님을 명시
  });
  it('RED: changed 단독 변조', () => {
    const fx = unitFixture(); fx.changed[1].allowIds = [9];
    expect(run(fx, UNIT_SPEC)).toMatch(/ALLOW_SET_CHANGED_VS_CONVERSIONS|ALLOW_SET_CHANGED_VS_MASKS|ALLOW_SET_CHANGED_VS_KEYMAP/);
  });
  it('RED: keyMap 단독 변조', () => {
    const fx = unitFixture(); fx.allowIdToKey = { 1: fx.allowIdToKey[1], 9: fx.allowIdToKey[4] };
    expect(run(fx, UNIT_SPEC)).toMatch(/ALLOW_SET_CHANGED_VS_KEYMAP/);
  });
  it('RED: CONVERSIONS 단독 변조', () => {
    const spec = { ...UNIT_SPEC, CONVERSIONS: [{ ident: { t: 'allow', id: 1 } }, { ident: { t: 'allow', id: 9 } }] };
    expect(run(unitFixture(), spec)).toMatch(/ALLOW_SET_CHANGED_VS_CONVERSIONS/);
  });
  it('RED: LIGHT_DIFF_MASKS 단독 변조', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { 1: UNIT_SPEC.LIGHT_DIFF_MASKS[1], 9: UNIT_SPEC.LIGHT_DIFF_MASKS[4] } };
    expect(run(unitFixture(), spec)).toMatch(/ALLOW_SET_CHANGED_VS_MASKS/);
  });
  it('RED: spec 미전달(배선 제거) → ALLOW_SET_SPEC_REQUIRED', () =>
    expect(EV.validateCounts(unitFixture(), C(), undefined).join('|')).toMatch(/ALLOW_SET_SPEC_REQUIRED/));
  it('배선 행동 고정: validateCandidate에 변이 spec을 주입하면 네 집합 오류가 나온다', () => {
    // 정규식으로 소스를 보면 호출을 지우고 같은 문자열을 주석에 남겨도 통과한다.
    // generator가 실제로 쓰는 순수 함수에 변이를 주입해 배선을 잠근다.
    const ctx = unitCtx();
    const results = [];
    expect(EV.validateCandidate({ fixture: unitFixture(), spec: UNIT_SPEC, context: ctx, contrastResults: results })).toEqual([]);
    const spec = { ...UNIT_SPEC, CONVERSIONS: [{ ident: { t: 'allow', id: 1 } }, { ident: { t: 'allow', id: 9 } }] };
    expect(EV.validateCandidate({ fixture: unitFixture(), spec, context: ctx, contrastResults: results }).join('|'))
      .toMatch(/ALLOW_SET_CHANGED_VS_CONVERSIONS/);
  });
  // validator를 주입할 수 없다 — 데이터와 순수 IO만 넘긴다.
  const IOSPY = () => { const c = { serialize: 0, write: 0, bytes: [] };
    return { c, serialize: () => { c.serialize++; return 'BYTES'; }, write: (b) => { c.write++; c.bytes.push(b); } }; };
  const U_CTX_RAW = () => JSON.stringify({ ...unitCtx(), capture: { type: 'png', scale: 'css', dpr: 1 },
    privacyAudit: { scope: 'dedicated-synthetic-account-workspace', contextPass: true, contextSubjectSha256: 'x', captures: [] } });
  const AW = (over = {}) => { const io = IOSPY();
    const r = EV.approveAndWrite({
      fixture: unitFixture(), spec: UNIT_SPEC, contrastResults: [],
      actualDecls: UNIT_DECLS, actualRaw: '', preAnnSources: {},
      actualAllowIdToKey: UNIT_ACTUAL_ALLOW_MAP, baseDecls: UNIT_BASE_DECLS,
      contextRaw: U_CTX_RAW(), sha256, readPng: () => ({ bytes: Buffer.from('p'), width: 1440, height: 900 }),
      serialize: io.serialize, write: io.write, ...over });
    return { r, c: io.c }; };
  it('validator 주입은 무시된다(정적 결속) — conformance/frozen 인자를 넘겨도 실제 validator가 돈다', () => {
    const { r, c } = AW({ conformance: () => [], frozen: () => [], validateCandidate: () => [] });
    // UNIT_SPEC에는 RASTER_CONTRACT·FILES blob이 없어 artifacts 단계에서 정상적으로 막힌다
    expect(r.wrote).toBe(false); expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
    expect(r.calls.artifacts).toBe(1);
  });
  it('candidate-only 오류 → conformance·artifacts 0회, write 0회', () => {
    const spec = { ...UNIT_SPEC, CONVERSIONS: [{ ident: { t: 'allow', id: 1 } }, { ident: { t: 'allow', id: 9 } }] };
    const { r, c } = AW({ spec });
    expect(r.errors.join('|')).toMatch(/ALLOW_SET_CHANGED_VS_CONVERSIONS/);
    expect(r.calls).toEqual({ candidate: 1, conformance: 0, artifacts: 0 });
    expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
  });
  it('conformance-only 오류 → artifacts 0회, write 0회 (쓰기가 conformance보다 앞서지 않는다)', () => {
    const { r, c } = AW({ baseDecls: undefined });
    expect(r.errors.join('|')).toMatch(/BASE_DECLS_REQUIRED/);
    expect(r.calls).toEqual({ candidate: 1, conformance: 1, artifacts: 0 });
    expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
  });
  it('artifacts-only 오류 → write 0회 (candidate·conformance는 통과)', () => {
    const { r, c } = AW({ readPng: () => ({ bytes: Buffer.from('p'), width: 2880, height: 1800 }) });
    expect(r.calls).toEqual({ candidate: 1, conformance: 1, artifacts: 1 });
    expect(c).toEqual({ serialize: 0, write: 0, bytes: [] });
  });
  it('contextRaw가 파싱 불가면 candidate 단계에서 막힌다', () => {
    const { r, c } = AW({ contextRaw: '{ not json' });
    expect(r.errors.join('|')).toMatch(/CANDIDATE_CONTEXT_REQUIRED/);
    expect(r.calls).toEqual({ candidate: 1, conformance: 0, artifacts: 0 });
    expect(c.write).toBe(0);
  });
  it('내부 validator 예외/비배열도 fail-closed (write 0회)', () => {
    const { r, c } = AW({ spec: {} });
    expect(r.errors.join('|')).toMatch(/APPROVE_VALIDATOR_THREW|APPROVE_VALIDATOR_NONARRAY/);
    expect(c.write).toBe(0);
  });
  it('serialize/write 미주입은 APPROVE_IO_REQUIRED', () => {
    const r = EV.approveAndWrite({ fixture: unitFixture(), spec: UNIT_SPEC, contrastResults: [] });
    expect(r.errors).toEqual(['APPROVE_IO_REQUIRED']); expect(r.wrote).toBe(false);
  });
  it('보조 lint: generator가 approveAndWrite만 쓰고 s4-expected.json 쓰기 지점이 1곳', () => {
    const src = readFileSync(new URL('../scripts/s4-gen.mjs', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).toMatch(/EV\.approveAndWrite\(/);
    for (const fn of ['validateCounts', 'validateSmokeCoverage', 'validateMaskContract', 'validateContrastReference', 'validateCandidate'])
      expect(code).not.toMatch(new RegExp(`EV\\.${fn}\\(`));
    // s4-expected.json 쓰기는 approveAndWrite의 writer 안에서만 일어난다
    const writes = code.match(/writeFileSync\([^)]*s4-expected\.json/g) || [];
    expect(writes.length).toBe(1);
  });
  it('실제 산출물 바이트 불변 — generator RED 실행이 fixture를 건드리지 않는다', () => {
    const f = new URL('./__fixtures__/s4-expected.json', import.meta.url);
    const before = createHash('sha256').update(readFileSync(f)).digest('hex');
    const r = execSync('node scripts/s4-gen.mjs; echo "exit=$?"',
      { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(r).toMatch(/exit=1/);
    expect(createHash('sha256').update(readFileSync(f)).digest('hex')).toBe(before);
  });
});

describe('S4 공용 경로 clean baseline + 한 축 변이', () => {
  const conform = (fx, spec, decls, map) => EV.evaluateConformance(
    decls || UNIT_DECLS, '', {}, spec || UNIT_SPEC, fx, map || UNIT_ACTUAL_ALLOW_MAP, UNIT_BASE_DECLS);
  it('GREEN: 완결된 UNIT 입력은 evaluateConformance가 정확히 []', () =>
    expect(conform(unitFixture())).toEqual([]));
  it('RED: 마스크 정본 한 축 변이(ID 4 삭제)', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { ...UNIT_SPEC.LIGHT_DIFF_MASKS } }; delete spec.LIGHT_DIFF_MASKS[4];
    expect(conform(unitFixture(), spec).join('|')).toMatch(/MASK_ID_UNCLASSIFIED 4/);
  });
  it('RED: smoke 한 축 변이(capture 집합 불일치)', () => {
    const fx = unitFixture(); fx.smoke.captures.pop();
    expect(conform(fx).join('|')).toMatch(/SMOKE_CAPTURE_SET_MISMATCH/);
  });
  it('RED: residual 한 축 변이', () => {
    const fx = unitFixture(); fx.residual = [{ x: 1 }];
    expect(conform(fx).join('|')).toMatch(/RESIDUAL_MISMATCH/);
  });
});

describe('S4 contrast — dead 우회 폐쇄', () => {
  it('RED: case에 dead:true가 있으면 거부되고 실패도 함께 보고된다', () => {
    const spec = { ...UNIT_SPEC, CONTRAST_CASES: [
      { name: 'unit-1to1', text: '--u-fg', min: 4.5, dead: true, stack: [{ token: '--u-bg' }] }] };
    const vals = { '--u-fg': '#808080', '--u-bg': '#808080' };   // 대비 1:1
    const r = EV.evaluateContrastCases(spec.CONTRAST_CASES, vals);
    expect(r.errors.join('|')).toMatch(/CONTRAST_DEAD_FORBIDDEN unit-1to1/);
    expect(r.errors.join('|')).toMatch(/CONTRAST_FAIL unit-1to1/);
    expect(r.results[0].pass).toBe(false);
  });
  it('정본에 dead 필드가 남아 있지 않다', () =>
    expect(SPEC.CONTRAST_CASES.some((c) => 'dead' in c)).toBe(false));
});

describe('S4 fixture ↔ 실제 선언 결속', () => {
  // 표기(file/property)만 분리하고 실체와 결속하지 않으면, changed·allowIdToKey의 property를
  // 함께 바꿔치기해도 내부 일관이라 conformance가 clean이었다(리뷰 실증).
  const conform = (fx, decls, map) => EV.evaluateConformance(decls || UNIT_DECLS, '', {}, UNIT_SPEC, fx,
    map || UNIT_ACTUAL_ALLOW_MAP, UNIT_BASE_DECLS).join('|');
  it('GREEN: 정상 결속', () => expect(conform(unitFixture())).toBe(''));
  it('RED: changed·allowIdToKey의 property를 함께 변조(box-shadow → background)', () => {
    const wrong = 'unit-settings.scss||.UnitRing|background|0';
    const fx = unitFixture();
    fx.changed[1].key = wrong; fx.allowIdToKey[4] = wrong;
    expect(conform(fx, UNIT_DECLS, new Map([[1, UNIT_DECLS[0].key], [4, wrong]])))
      .toMatch(/CHANGED_KEY_NOT_IN_ACTUAL|ALLOW_KEY_NOT_IN_ACTUAL/);
  });
  it('RED: actual declaration 삭제', () =>
    expect(conform(unitFixture(), [UNIT_DECLS[0]])).toMatch(/CHANGED_KEY_NOT_IN_ACTUAL/));
  it('RED: changed.selector 단독 변조 (canonical key 재계산이 선점 검출)', () => {
    const fx = unitFixture(); fx.changed[1].selector = '.Other';
    expect(conform(fx)).toMatch(/CHANGED_KEY_NONCANONICAL|CHANGED_VS_ACTUAL/);
  });
});

describe('S4 contrast 참고치 집합 계약', () => {
  // result는 min·pass까지 case와 정합해야 한다(메타데이터 결속).
  const res = () => SPEC.CONTRAST_CASES.map((c) => ({ name: c.name, ratio: SPEC.CONTRAST_REFERENCE[c.name],
    min: c.min, pass: SPEC.CONTRAST_REFERENCE[c.name] >= c.min }));
  it('GREEN: 정본 case ↔ reference 이름 집합 exact', () =>
    expect(EV.validateContrastReference(SPEC.CONTRAST_CASES, SPEC.CONTRAST_REFERENCE, res())).toEqual([]));
  it('RED: case 1개 삭제', () => expect(EV.validateContrastReference(SPEC.CONTRAST_CASES.slice(1), SPEC.CONTRAST_REFERENCE, res().slice(1)).join('|'))
    .toMatch(/CONTRAST_REFERENCE_SET_MISMATCH/));
  it('RED: reference 1개 삭제', () => {
    const r = { ...SPEC.CONTRAST_REFERENCE }; delete r['TrackTree GroupKey hover'];
    expect(EV.validateContrastReference(SPEC.CONTRAST_CASES, r, res()).join('|')).toMatch(/CONTRAST_REFERENCE_SET_MISMATCH/);
  });
  it('RED: case 이름 중복', () => {
    const cs = [...SPEC.CONTRAST_CASES, SPEC.CONTRAST_CASES[0]];
    expect(EV.validateContrastReference(cs, SPEC.CONTRAST_REFERENCE, res()).join('|')).toMatch(/CONTRAST_CASE_NAME_DUP/);
  });
  it('RED: 결과 누락', () => expect(EV.validateContrastReference(SPEC.CONTRAST_CASES, SPEC.CONTRAST_REFERENCE, res().slice(1)).join('|'))
    .toMatch(/CONTRAST_RESULT_MISSING/));
  it('참고치가 fingerprint에 포함된다', () => {
    const mut = { ...SPEC, CONTRAST_REFERENCE: { ...SPEC.CONTRAST_REFERENCE, 'TrackTree GroupKey hover': 9.999 } };
    expect(EV.specFingerprint(mut, sha256)).not.toBe(EV.specFingerprint(SPEC, sha256));
  });
});

describe('S4 allow ID 타입·형식', () => {
  const C = () => UNIT_SPEC.COUNTS;
  it('RED: changed allowIds에 "04" 문자열', () => {
    const fx = unitFixture(); fx.changed[1].allowIds = ['04'];
    expect(EV.validateCounts(fx, C(), UNIT_SPEC).join('|')).toMatch(/ALLOW_ID_TYPE changed "04"/);
  });
  it('RED: allowIdToKey 키가 "04"', () => {
    const fx = unitFixture(); fx.allowIdToKey = { 1: fx.allowIdToKey[1], '04': fx.allowIdToKey[4] };
    expect(EV.validateCounts(fx, C(), UNIT_SPEC).join('|')).toMatch(/ALLOW_ID_KEY allowIdToKey "04"/);
  });
  it('RED: 비정수 ID', () => {
    const fx = unitFixture(); fx.changed[1].allowIds = [4.5];
    expect(EV.validateCounts(fx, C(), UNIT_SPEC).join('|')).toMatch(/ALLOW_ID_TYPE changed 4\.5/);
  });
  it('RED: mask 키가 "04"', () => {
    const spec = { ...UNIT_SPEC, LIGHT_DIFF_MASKS: { 1: UNIT_SPEC.LIGHT_DIFF_MASKS[1], '04': UNIT_SPEC.LIGHT_DIFF_MASKS[4] } };
    expect(EV.validateCounts(unitFixture(), C(), spec).join('|')).toMatch(/ALLOW_ID_KEY LIGHT_DIFF_MASKS "04"/);
  });
});

describe('S4 선언 결속 — actual key canonical·changed 전체 schema·base 대조', () => {
  const conform = (over = {}) => EV.evaluateConformance(
    over.decls || UNIT_DECLS, '', {}, UNIT_SPEC, over.fx || unitFixture(),
    over.map || UNIT_ACTUAL_ALLOW_MAP, 'base' in over ? over.base : UNIT_BASE_DECLS).join('|');
  it('GREEN: 정상', () => expect(conform()).toBe(''));
  it('RED: actual declaration의 file만 변조 → key가 canonical과 불일치', () => {
    const decls = JSON.parse(JSON.stringify(UNIT_DECLS)); decls[1].file = 'evil.scss';
    expect(conform({ decls })).toMatch(/DECL_KEY_NONCANONICAL/);
  });
  it('RED: actual declaration의 atRules만 변조', () => {
    const decls = JSON.parse(JSON.stringify(UNIT_DECLS)); decls[1].atRules = ['@media x'];
    expect(conform({ decls })).toMatch(/DECL_KEY_NONCANONICAL/);
  });
  it('RED: actual declaration의 occurrence만 변조', () => {
    const decls = JSON.parse(JSON.stringify(UNIT_DECLS)); decls[1].declarationOccurrence = 8;
    expect(conform({ decls })).toMatch(/DECL_KEY_NONCANONICAL/);
  });
  it('RED: actual key 중복', () => {
    const decls = [...UNIT_DECLS, { ...UNIT_DECLS[0] }];
    expect(conform({ decls })).toMatch(/DECL_KEY_DUP/);
  });
  for (const f of ['file', 'property', 'declarationOccurrence']) {
    it(`RED: changed.${f} 단독 변조`, () => {
      const fx = unitFixture(); fx.changed[1][f] = f === 'declarationOccurrence' ? 7 : 'zz';
      expect(conform({ fx })).toMatch(/CHANGED_KEY_NONCANONICAL|CHANGED_VS_ACTUAL/);
    });
  }
  for (const [f, v] of [['after', 'zz'], ['afterImportant', true]]) {
    it(`RED: changed.${f} 단독 변조 (actual 대조)`, () => {
      const fx = unitFixture(); fx.changed[1][f] = v;
      expect(conform({ fx })).toMatch(new RegExp(`CHANGED_VS_ACTUAL .* ${f}`));
    });
  }
  for (const [f, v] of [['before', 'zz'], ['beforeImportant', true]]) {
    it(`RED: changed.${f} 단독 변조 (base 대조)`, () => {
      const fx = unitFixture(); fx.changed[1][f] = v;
      expect(conform({ fx })).toMatch(new RegExp(`CHANGED_VS_BASE .* ${f}`));
    });
  }
  it('RED: changed schema 필드 누락', () => {
    const fx = unitFixture(); delete fx.changed[1].beforeImportant;
    expect(conform({ fx })).toMatch(/CHANGED_SCHEMA_MISSING/);
  });
  it('RED: baseDecls 미전달은 fail-closed', () => expect(conform({ base: undefined })).toMatch(/BASE_DECLS_REQUIRED/));
  it('RED: actual·fixture·expected·map 동시 변이도 base 대조로 잡힌다', () => {
    // 모든 "after" 축을 일관되게 바꿔도 BASE는 못 바꾸므로 before 대조가 남는다.
    const decls = JSON.parse(JSON.stringify(UNIT_DECLS)); decls[1].value = 'HACKED';
    const fx = unitFixture(); fx.changed[1].after = 'HACKED';
    fx.expectedAfter[1].value = 'HACKED';
    expect(conform({ decls, fx })).toBe('');            // after 축만 보면 통과
    fx.changed[1].before = 'HACKED';                     // before까지 위조하면 base가 잡는다
    expect(conform({ decls, fx })).toMatch(/CHANGED_VS_BASE .* before/);
  });
});

describe('S4 contrast 숫자·스키마 fail-closed', () => {
  const vals = { '--a': '#000000', '--b': '#ffffff' };
  it('RED: min 누락', () => {
    const r = EV.evaluateContrastCases([{ name: 'n', text: '--a', stack: [{ token: '--b' }] }], vals);
    expect(r.errors.join('|')).toMatch(/CONTRAST_MIN_INVALID/);
  });
  it('RED: min <= 1', () => {
    const r = EV.evaluateContrastCases([{ name: 'n', text: '--a', min: 1, stack: [{ token: '--b' }] }], vals);
    expect(r.errors.join('|')).toMatch(/CONTRAST_MIN_INVALID/);
  });
  it('RED: mix.pct 누락/범위 초과', () => {
    for (const pct of [undefined, -1, 101, NaN]) {
      const r = EV.evaluateContrastCases([{ name: 'n', text: '--a', min: 4.5, stack: [{ token: '--b' }, { mix: '--a', pct }] }], vals);
      expect(r.errors.join('|')).toMatch(/CONTRAST_PCT_INVALID|CONTRAST_BASE/);
    }
  });
  it('RED: result ratio가 NaN/문자열/undefined면 드리프트 검사가 사라지지 않는다', () => {
    for (const ratio of [NaN, '6', undefined, Infinity]) {
      expect(EV.validateContrastReference([{ name: 'z' }], { z: 6 }, [{ name: 'z', ratio }]).join('|'))
        .toMatch(/CONTRAST_RESULT_RATIO_INVALID/);
    }
  });
  it('RED: reference 값이 비수치', () => expect(EV.validateContrastReference([{ name: 'z' }], { z: NaN }, [{ name: 'z', ratio: 6 }]).join('|'))
    .toMatch(/CONTRAST_REFERENCE_INVALID/));
  it('RED: tolerance가 비수치', () => expect(EV.validateContrastReference([{ name: 'z' }], { z: 6 }, [{ name: 'z', ratio: 6 }], NaN).join('|'))
    .toMatch(/CONTRAST_TOL_INVALID/));
});

describe('S4 candidate 승인 경로 — context 필수 + 축별 mutation', () => {
  const ok = () => ({ fixture: unitFixture(), spec: UNIT_SPEC, context: unitCtx(), contrastResults: [] });
  it('GREEN: 정상 candidate', () => expect(EV.validateCandidate(ok())).toEqual([]));
  it('RED: context 생략', () => expect(EV.validateCandidate({ ...ok(), context: undefined }).join('|')).toMatch(/CANDIDATE_CONTEXT_REQUIRED/));
  it('RED: context가 배열', () => expect(EV.validateCandidate({ ...ok(), context: [] }).join('|')).toMatch(/CANDIDATE_CONTEXT_REQUIRED/));
  it('RED: contrastResults 생략', () => expect(EV.validateCandidate({ ...ok(), contrastResults: undefined }).join('|')).toMatch(/CANDIDATE_CONTRAST_RESULTS_REQUIRED/));
  it('RED: counts 축', () => { const a = ok(); a.fixture.counts.changed = 9;
    expect(EV.validateCandidate(a).join('|')).toMatch(/changed 9!=2/); });
  it('RED: mask 축', () => { const a = ok(); delete a.context.baseLightMaskRects['unit-a'];
    expect(EV.validateCandidate(a).join('|')).toMatch(/MASK_SURFACE_NOT_SCANNED/); });
  it('RED: contrast 축', () => { const a = ok();
    a.spec = { ...UNIT_SPEC, CONTRAST_CASES: [{ name: 'q', min: 4.5 }], CONTRAST_REFERENCE: {} };
    expect(EV.validateCandidate(a).join('|')).toMatch(/CONTRAST_REFERENCE_SET_MISMATCH/); });
});

describe('S4 contrast result 메타데이터 결속', () => {
  const cases = [{ name: 'z', text: '--a', min: 4.5, stack: [{ token: '--b' }] }];
  const ref = { z: 6 };
  it('GREEN: min·pass가 case와 계산 결과에 일치', () =>
    expect(EV.validateContrastReference(cases, ref, [{ name: 'z', ratio: 6, min: 4.5, pass: true }])).toEqual([]));
  it('RED: result.min이 case.min과 다름', () =>
    expect(EV.validateContrastReference(cases, ref, [{ name: 'z', ratio: 6, min: 3, pass: true }]).join('|'))
      .toMatch(/CONTRAST_RESULT_MIN_MISMATCH/));
  it('RED: result.pass가 ratio>=min과 다름', () =>
    expect(EV.validateContrastReference(cases, ref, [{ name: 'z', ratio: 6, min: 4.5, pass: false }]).join('|'))
      .toMatch(/CONTRAST_RESULT_PASS_MISMATCH/));
  it('RED: 실패인데 pass:true로 위조', () =>
    expect(EV.validateContrastReference(cases, { z: 2 }, [{ name: 'z', ratio: 2, min: 4.5, pass: true }]).join('|'))
      .toMatch(/CONTRAST_RESULT_PASS_MISMATCH/));
  it('RED: reference ratio가 1..21 밖', () => {
    for (const v of [0.5, 22, -3])
      expect(EV.validateContrastReference(cases, { z: v }, [{ name: 'z', ratio: 6, min: 4.5, pass: true }]).join('|'))
        .toMatch(/CONTRAST_REFERENCE_INVALID/);
  });
  it('RED: tolerance 상한 0.3 초과', () =>
    expect(EV.validateContrastReference(cases, ref, [{ name: 'z', ratio: 6, min: 4.5, pass: true }], 0.5).join('|'))
      .toMatch(/CONTRAST_TOL_INVALID 0\.5/));
  it('정본 결과도 메타데이터까지 정합', () => {
    const res = SPEC.CONTRAST_CASES.map((c) => ({ name: c.name, ratio: SPEC.CONTRAST_REFERENCE[c.name],
      min: c.min, pass: SPEC.CONTRAST_REFERENCE[c.name] >= c.min }));
    expect(EV.validateContrastReference(SPEC.CONTRAST_CASES, SPEC.CONTRAST_REFERENCE, res)).toEqual([]);
  });
});

describe('S4 case.min 독립 검증', () => {
  const res = (min, pass) => [{ name: 'z', ratio: 6, min, pass }];
  it('RED: min undefined + result를 맞춰 넣어도 통과하지 않는다', () =>
    expect(EV.validateContrastReference([{ name: 'z', min: undefined }], { z: 6 }, res(undefined, false)).join('|'))
      .toMatch(/CONTRAST_CASE_MIN_INVALID/));
  it('RED: min <= 1 / min > 21 / 비수치', () => {
    for (const m of [1, 0, 25, '4.5', NaN])
      expect(EV.validateContrastReference([{ name: 'z', min: m }], { z: 6 }, res(m, 6 >= m)).join('|'))
        .toMatch(/CONTRAST_CASE_MIN_INVALID/);
  });
  it('GREEN: 정본 case 전부 유효 범위', () => {
    for (const c of SPEC.CONTRAST_CASES) {
      expect(typeof c.min).toBe('number');
      expect(c.min > 1 && c.min <= 21).toBe(true);
    }
  });
});

describe('S4 커밋 산출물 게이트 — 실제 fixture 원문·context 원문·PNG 바이트', () => {
  const FIX = new URL('./__fixtures__/', import.meta.url);
  const fixRaw = () => readFileSync(new URL('s4-expected.json', FIX), 'utf8');
  const ctxRaw = () => readFileSync(new URL('s4-smoke-context.json', FIX), 'utf8');
  const readPng = (name) => { const b = readFileSync(new URL(`s4-shots/base/${name}`, FIX));
    return { bytes: b, width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
  // 실제 BASE 3파일을 컴파일해 선언을 얻는다 — baseDecls=[] 로는 canonical/dup 검사가 공허하다.
  const realBaseDecls = () => {
    const out = [];
    for (const k of Object.keys(SPEC.FILES)) {
      const rel = SPEC.FILES[k].rel;
      const src = execSync(`git -C ${REPO} show ${SPEC.BASE}:frontend/${rel}`, { encoding: 'utf8' });
      const css = compileString(src, { syntax: 'scss', url: pathToFileURL(resolve(__dirname, '..', rel)),
        loadPaths: [resolve(__dirname, '../styles')] }).css;
      out.push(...EV.collectDeclarations(postcss.parse(css), rel));
    }
    return out;
  };
  const run = (over = {}) => EV.validateCommittedArtifacts({
    committedFixtureRaw: 'committedFixtureRaw' in over ? over.committedFixtureRaw : fixRaw(),
    spec: over.spec || SPEC,
    contextRaw: 'contextRaw' in over ? over.contextRaw : ctxRaw(),
    sha256, readPng: over.readPng || readPng,
    baseDecls: 'baseDecls' in over ? over.baseDecls : BASE_DECLS,
  });
  const BASE_DECLS = realBaseDecls();
  const mutFx = (f) => { const o = JSON.parse(fixRaw()); f(o); return JSON.stringify(o); };
  const mutCtx = (f) => { const o = JSON.parse(ctxRaw()); f(o); return JSON.stringify(o); };

  it('실제 BASE 선언이 비어 있지 않고 canonical·중복 0', () => {
    expect(BASE_DECLS.length).toBeGreaterThan(2000);
    for (const d of BASE_DECLS) expect(d.key).toBe(EV.declarationKey(d));
    expect(new Set(BASE_DECLS.map((d) => d.key)).size).toBe(BASE_DECLS.length);
  });
  it('IO 미주입은 fail-closed', () =>
    expect(EV.validateCommittedArtifacts({ committedFixtureRaw: fixRaw(), spec: SPEC, contextRaw: ctxRaw() }))
      .toEqual(['ARTIFACTS_IO_REQUIRED']));
  it('fixture 원문 미전달·파싱 불가는 fail-closed', () => {
    expect(EV.validateCommittedArtifacts({ spec: SPEC, contextRaw: ctxRaw(), sha256, readPng, baseDecls: BASE_DECLS }))
      .toEqual(['COMMITTED_FIXTURE_RAW_REQUIRED']);
    expect(run({ committedFixtureRaw: '{ nope' })).toEqual(['COMMITTED_FIXTURE_UNPARSEABLE']);
  });
  it('현재 커밋 산출물은 stale — fingerprint drift 검출', () => {
    // ⚠️ 재수집·재동결 후에는 이 단정을 `expect(run()).toEqual([])`로 바꿔야 한다.
    expect(run().join('|')).toMatch(/FROZEN_FINGERPRINT_DRIFT/);
  });
  it('blob 계약 exact — rel/extra/missing/blob 단독 변조', () => {
    expect(run({ committedFixtureRaw: mutFx((o) => { o.blobs.T.rel = 'evil.scss'; }) }).join('|')).toMatch(/FROZEN_BLOB_REL/);
    expect(run({ committedFixtureRaw: mutFx((o) => { o.blobs.EXTRA = { rel: 'x', blob: 'y' }; }) }).join('|')).toMatch(/FROZEN_BLOB_KEYSET/);
    expect(run({ committedFixtureRaw: mutFx((o) => { delete o.blobs.X; }) }).join('|')).toMatch(/FROZEN_BLOB_KEYSET|FROZEN_BLOB_MISSING/);
    expect(run({ committedFixtureRaw: mutFx((o) => { o.blobs.T.blob = 'zz'; }) }).join('|')).toMatch(/FROZEN_BLOB_SHA/);
  });
  it('BASE 선언 계약 — 빈 배열·파일 누락·noncanonical·중복', () => {
    expect(run({ baseDecls: [] }).join('|')).toMatch(/FROZEN_BASE_DECLS_REQUIRED/);
    expect(run({ baseDecls: BASE_DECLS.filter((d) => !d.file.endsWith('tracksIndex.scss')) }).join('|')).toMatch(/FROZEN_BASE_FILE_ABSENT/);
    expect(run({ baseDecls: [{ ...BASE_DECLS[0], key: 'wrong' }, ...BASE_DECLS.slice(1)] }).join('|')).toMatch(/FROZEN_BASE_KEY_NONCANONICAL/);
    expect(run({ baseDecls: [...BASE_DECLS, { ...BASE_DECLS[0] }] }).join('|')).toMatch(/FROZEN_BASE_KEY_DUP/);
  });
  it('raster 정본 대조 — context만/PNG만/둘 다/dpr/scale', () => {
    const big = (n) => ({ ...readPng(n), width: 2880, height: 1800 });
    expect(run({ contextRaw: mutCtx((o) => { o.viewport = { width: 2880, height: 1800 }; }) }).join('|')).toMatch(/RASTER_CONTEXT_VIEWPORT/);
    expect(run({ readPng: big }).join('|')).toMatch(/RASTER_PNG_SIZE/);
    expect(run({ contextRaw: mutCtx((o) => { o.viewport = { width: 2880, height: 1800 }; }), readPng: big }).join('|')).toMatch(/RASTER_/);
    expect(run({ contextRaw: mutCtx((o) => { o.capture = { ...o.capture, dpr: 2 }; }) }).join('|')).toMatch(/RASTER_DPR/);
    expect(run({ contextRaw: mutCtx((o) => { o.capture = { ...o.capture, scale: 'device' }; }) }).join('|')).toMatch(/RASTER_SCREENSHOT_SCALE/);
  });
  it('context 원문 단일 원천 — 임의 필드 추가는 privacy subject 재계산으로 검출', () =>
    expect(run({ contextRaw: mutCtx((o) => { o.__evil = 'x'; }) }).join('|')).toMatch(/PRIVACY_AUDIT_CONTEXT_SUBJECT_DRIFT/));
  it('contextRaw 바이트 변조는 해시 drift로 검출', () =>
    expect(run({ contextRaw: `${ctxRaw()} ` }).join('|')).toMatch(/FROZEN_CONTEXT_SHA_DRIFT/));
  it('PNG 바이트 drift 검출', () =>
    expect(run({ readPng: () => ({ bytes: Buffer.from('x'), width: 1440, height: 900 }) }).join('|')).toMatch(/FROZEN_PNG_SHA_DRIFT/));
  it('privacy audit 부재 검출', () =>
    expect(run({ contextRaw: mutCtx((o) => { delete o.privacyAudit; }) }).join('|')).toMatch(/FROZEN_PRIVACY_AUDIT_MISSING/));
});
