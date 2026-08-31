import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio, tintFor, inkFor, hexToRgb, mixSrgb, relativeLuminance, BADGE_MIN, TEXT_MIN } from './colorContrast.js';
// 코퍼스 정본은 공유 픽스처다 — colorContrast.test.js도 같은 31색을 본다.
import { CORPUS, SURFACE_PARENTS } from './__fixtures__/storedColorCorpus.js';
// 파생 토큰(color.adjust)은 소스에 hex가 없다 — 컴파일 산출에서 읽는다.
import { tokenOf, tokenOver } from './__fixtures__/compiledThemeTokens.js';
import {
  entityTintStyle, entityInkStyle, entityBorderStyle, entitySolidStyle,
  ENTITY_SURFACES, ENTITY_SURFACE_PROFILES, LEGACY_ALPHA_ENTRY,
} from './entityTint.js';

const here = dirname(fileURLToPath(import.meta.url));

// ── SCSS 최상위 블록 추출 ────────────────────────────────────────────────────
// track.scss에는 `&--selected { background: color-mix(… --color-primary 6% …) }`가
// **두 곳**(.TrackTimeline LaneRow · .TrackTree__Row) 있고 Timeline이 파일에서 앞선다.
// 앵커 없이 첫 매치를 읽으면 TrackTree를 검사한다고 믿으면서 Timeline을 읽게 된다.
// 중괄호를 세어 해당 최상위 블록만 잘라낸 뒤 그 안에서만 읽는다.
export function topLevelBlock(src, selector) {
  const start = src.search(new RegExp(`^\\${selector}\\s*\\{`, 'm'));
  if (start < 0) throw new Error(`${selector} 최상위 블록이 없다`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${selector} 블록이 닫히지 않았다`);
}

const SELECTED_PCT = /&--selected \{\s*\n\s*background: color-mix\(in srgb, var\(--color-primary\) ([0-9.]+)%/;
const pctIn = (block) => {
  const m = block.match(SELECTED_PCT);
  if (!m) throw new Error('블록 안에 --selected primary 합성 배경이 없다');
  return Number(m[1]);
};
export const trackTreeSelectedPct = (src) => pctIn(topLevelBlock(src, '.TrackTree'));
export const trackTimelineSelectedPct = (src) => pctIn(topLevelBlock(src, '.TrackTimeline'));

describe('entityTintStyle — 두 테마 값을 인라인 변수로 내린다', () => {
  // ⚠️ `--et-on`은 supported 결과에 **반드시** 들어간다(S7 계획 「클래스 판정은 --et-on 하나로 통일한다」).
  //    이 기대 목록에서 빠뜨리면 구현이 플래그를 지우는 방향으로 끌려간다 — 지우지 마라.
  it('4개 변수 + --et-on + 라이트 프로퍼티를 함께 낸다', () => {
    const s = entityTintStyle('#16A34A');
    expect(Object.keys(s).sort()).toEqual(
      ['--et-bg', '--et-bg-dark', '--et-fg', '--et-fg-dark', '--et-on', 'background', 'color'].sort(),
    );
    expect(s['--et-on']).toBe('1');
    expect(s.background).toBe('var(--et-bg)');
    expect(s.color).toBe('var(--et-fg)');
  });
  // P11-B 확정(2026-08-26) — 라이트도 표면 기준 산출값이다.
  it('라이트 값은 light 표면 기준, 다크 값은 dark 표면 기준이다', () => {
    const s = entityTintStyle('#16A34A');
    expect(s['--et-bg']).toBe(tintFor('#16A34A', ENTITY_SURFACES.light, 12));
    expect(s['--et-bg-dark']).toBe(tintFor('#16A34A', ENTITY_SURFACES.dark, 12));
    expect(s['--et-fg']).toBe(inkFor('#16A34A', s['--et-bg']));
    expect(s['--et-fg-dark']).toBe(inkFor('#16A34A', s['--et-bg-dark']));
  });
  // P11-B이므로 라이트 변수도 계산된 6자리 hex다 — 전 변수에 같은 단정을 건다.
  it('hex 8자리 alpha도 color-mix()도 만들지 않는다 — DOM 직접 대입에서 조용히 사라지지 않게', () => {
    for (const v of Object.values(entityTintStyle('#16A34A'))) {
      expect(String(v)).not.toMatch(/#[0-9A-Fa-f]{8}/);
      expect(String(v)).not.toContain('color-mix');
    }
  });
  // 3상태 계약(S7 계획 「저장색 입력 계약」): blank→undefined / 지원 밖→`--et-*` 없는 passthrough.
  it('빈 입력만 undefined다 — 지원 밖 문자열은 오늘의 선언을 그대로 돌려준다', () => {
    for (const blank of [null, undefined, '', '  ', 42]) {
      expect(entityTintStyle(blank), String(blank)).toBeUndefined();
    }
    expect(entityTintStyle('nope')).toEqual({ background: 'nope20', color: 'nope' });
    expect(entityTintStyle('nope')['--et-on']).toBeUndefined();   // 짝 클래스를 붙이면 안 된다
  });
  it('진입점을 지정할 수 있다', () => {
    expect(entityTintStyle('#16A34A', { from: 25 })['--et-bg'])
      .toBe(tintFor('#16A34A', ENTITY_SURFACES.light, 25));
  });
});

// P11-B 확정 — 라이트(`--et-fg` / `--et-bd`)도 표면 기준 산출값이다.
describe('entityInkStyle / entityBorderStyle / entitySolidStyle', () => {
  it('entityInkStyle은 라이트도 표면 기준 대비로 글자색을 낸다', () => {
    const s = entityInkStyle('#16A34A');
    expect(s.color).toBe('var(--et-fg)');
    expect(s['--et-fg']).toBe(inkFor('#16A34A', ENTITY_SURFACES.light));
    expect(s['--et-fg-dark']).toBe(inkFor('#16A34A', ENTITY_SURFACES.dark));
    expect(s['--et-bg']).toBeUndefined();
  });
  it('entityBorderStyle은 from 생략 시 라이트 원색 보존, from을 주면 틴트 테두리', () => {
    const bare = entityBorderStyle('#16A34A');
    expect(bare['--et-bd']).toBe('#16A34A');
    expect(bare['--et-bd-dark']).toBe(inkFor('#16A34A', ENTITY_SURFACES.dark));
    expect(bare.borderColor).toBe('var(--et-bd)');
    const tinted = entityBorderStyle('#16A34A', { from: 20 });
    expect(tinted['--et-bd']).toBe(tintFor('#16A34A', ENTITY_SURFACES.light, 20));
    expect(tinted['--et-bd-dark']).toBe(tintFor('#16A34A', ENTITY_SURFACES.dark, 20));
  });
  // from은 truthiness가 아니라 생략 여부로 갈린다 — `from: 0`은 사다리 최하단 요구이지
  // "원색 테두리"가 아니다. truthiness로 재면 0이 조용히 bare 경로로 접힌다.
  it('from: 0은 bare가 아니라 tintFor 경로다', () => {
    const zero = entityBorderStyle('#16A34A', { from: 0 });
    expect(zero['--et-bd']).toBe(tintFor('#16A34A', ENTITY_SURFACES.light, 0));
    expect(zero['--et-bd-dark']).toBe(tintFor('#16A34A', ENTITY_SURFACES.dark, 0));
    expect(zero['--et-bd']).not.toBe('#16A34A');   // bare 경로로 접히지 않았다
  });
  it('entitySolidStyle은 다크에서 표면 대비 AA를 보장한다', () => {
    for (const c of ['#000080', '#0E0F11', '#16A34A']) {
      const s = entitySolidStyle(c);
      expect(s['--et-solid']).toBe(c);
      expect(contrastRatio(s['--et-solid-dark'], ENTITY_SURFACES.dark)).toBeGreaterThanOrEqual(4.5);
      expect(s.background).toBe('var(--et-solid)');
    }
  });
});

// 네 함수 모두 supported일 때만 `--et-on: '1'`을 싣는다 — 짝 클래스 판정의 유일한 근거다.
describe('--et-on — 짝 클래스 판정 플래그', () => {
  const FNS = [
    ['entityTintStyle', entityTintStyle],
    ['entityInkStyle', entityInkStyle],
    ['entityBorderStyle', entityBorderStyle],
    ['entitySolidStyle', entitySolidStyle],
  ];
  it.each(FNS)('%s: 지원 색에만 --et-on이 실린다', (_name, fn) => {
    expect(fn('#16A34A')['--et-on']).toBe('1');
    expect(fn('#1a6f')['--et-on']).toBeUndefined();   // 지원 밖 — passthrough
    expect(fn('')).toBeUndefined();                    // blank
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P11-B 보정 (2026-08-31) — 라이트 기준 표면을 --color-bg → --color-surface로 옮긴 건
// ─────────────────────────────────────────────────────────────────────────────

// 상수를 _themes.scss 토큰에 묶는다. 손으로 다른 값을 적으면 여기가 RED다.
// 이 게이트가 없으면 "표면 토큰이 바뀌었는데 상수는 그대로"인 조용한 회귀가 다시 열린다.
describe('ENTITY_SURFACES — _themes.scss의 양 테마 --color-surface와 동치다', () => {
  const themes = readFileSync(resolve(here, '../styles/_themes.scss'), 'utf8');
  // 라이트 블록 = 파일 앞쪽, 다크 블록 = html[data-theme='dark'] 이후. 순서로 가른다.
  const darkAt = themes.indexOf("[data-theme='dark']");
  const surfaceIn = (chunk) => chunk.match(/--color-surface:\s*(#[0-9A-Fa-f]{6})\s*;/)[1].toUpperCase();

  it('light = 라이트 --color-surface (#F9FAFB) — 페이지 배경 #FFFFFF가 아니다', () => {
    expect(darkAt).toBeGreaterThan(0);
    expect(ENTITY_SURFACES.light).toBe(surfaceIn(themes.slice(0, darkAt)));
    expect(ENTITY_SURFACES.light).toBe('#F9FAFB');
    expect(ENTITY_SURFACES.light).not.toBe('#FFFFFF');   // 회귀 방향을 명시적으로 막는다
  });
  it('dark = 다크 --color-surface (#17181C)', () => {
    expect(ENTITY_SURFACES.dark).toBe(surfaceIn(themes.slice(darkAt)));
    expect(ENTITY_SURFACES.dark).toBe('#17181C');
  });
});

// **default 프로파일**의 다크 산출 동결표다. 범위를 정확히 읽어라:
//   ✅ 이 표가 지키는 것 — 일반 배지(라벨·상태·필터칩·라벨입력칩 등)의 다크 값.
//      라이트 기준 표면을 옮긴 2026-08-31 변경은 이 값들을 한 개도 건드리지 않았다
//      (4 API × 31색 × 진입점 8종 × 접미 5종 = 3813키 SHA 동일 확인).
//   ⛔ 이 표가 지키지 **않는** 것 — track-card·task-ref 프로파일.
//      그 둘은 부모가 달라 다크 값이 **의도적으로 바뀐다**(그게 blocker 수정의 내용이다).
//      "다크는 무조건 전건 불변"으로 읽어 프로파일 수정을 막는 근거로 쓰지 마라.
// default 배지의 다크가 딸려 움직이면 여기가 RED다.
const DARK_FROZEN = [
  ['#000000', '#2D2D2F', '#999999', '#2D2D2F', '#999999', '#8A8A8A', '#8A8A8A', '#2D2D2F', '#8A8A8A'],
  ['#FFFFFF', '#333437', '#FFFFFF', '#333437', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#454649', '#FFFFFF'],
  ['#000080', '#2D2D53', '#9494FF', '#2D2D53', '#9494FF', '#7676FF', '#7676FF', '#2D2D53', '#7676FF'],
  ['#FFFF00', '#333419', '#FFFF00', '#333419', '#FFFF00', '#FFFF00', '#FFFF00', '#454616', '#FFFF00'],
  ['#0E0F11', '#303134', '#A0A6B1', '#303134', '#A0A6B1', '#7F8695', '#7F8695', '#303134', '#7F8695'],
  ['#F9FAFB', '#323337', '#F9FAFB', '#323337', '#F9FAFB', '#F9FAFB', '#F9FAFB', '#444549', '#F9FAFB'],
  ['#808080', '#2C2D30', '#9F9F9F', '#2C2D30', '#9F9F9F', '#8F8F8F', '#8F8F8F', '#2C2D30', '#8F8F8F'],
  ['#DC2626', '#561C1F', '#E97575', '#561C1F', '#E97575', '#E55B5B', '#E55B5B', '#561C1F', '#E55B5B'],
  ['#F59E0B', '#3B2D19', '#F59E0B', '#3B2D19', '#F59E0B', '#F59E0B', '#F59E0B', '#433319', '#F59E0B'],
  ['#5E6AD2', '#292D4A', '#8E96DF', '#292D4A', '#8E96DF', '#7680D9', '#7680D9', '#292D4A', '#7680D9'],
  ['#9CA3AF', '#2C2E34', '#9CA3AF', '#2C2E34', '#9CA3AF', '#9CA3AF', '#9CA3AF', '#323439', '#9CA3AF'],
  ['#2563EB', '#1B2B50', '#799FF3', '#1B2B50', '#799FF3', '#5D8BF0', '#5D8BF0', '#1B2B50', '#5D8BF0'],
  ['#16A34A', '#173425', '#1ABE56', '#173425', '#1ABE56', '#16A34A', '#16A34A', '#173425', '#16A34A'],
  ['#8B5CF6', '#2E2648', '#B496F9', '#2E2648', '#B496F9', '#A079F8', '#A079F8', '#2E2648', '#A079F8'],
  ['#EC4899', '#422235', '#EF64A8', '#422235', '#EF64A8', '#EC4899', '#EC4899', '#422235', '#EC4899'],
  ['#0891B2', '#14303A', '#09A9CF', '#14303A', '#09A9CF', '#0891B2', '#0891B2', '#14303A', '#0891B2'],
  ['#C2410C', '#4E2517', '#F48354', '#4E2517', '#F48354', '#F1591A', '#F1591A', '#4E2517', '#F1591A'],
  ['#4F46E5', '#29275C', '#9C96F0', '#29275C', '#9C96F0', '#827CED', '#827CED', '#29275C', '#827CED'],
  ['#059669', '#13312B', '#06B47E', '#13312B', '#06B47E', '#059669', '#059669', '#13312B', '#059669'],
  ['#D97706', '#3E2B18', '#F78707', '#3E2B18', '#F78707', '#D97706', '#D97706', '#3E2B18', '#D97706'],
  ['#7C3AED', '#37235F', '#B48EF5', '#37235F', '#B48EF5', '#A172F2', '#A172F2', '#37235F', '#A172F2'],
  ['#DB2777', '#481C33', '#E876A9', '#481C33', '#E876A9', '#E45B98', '#E45B98', '#481C33', '#E45B98'],
  ['#0D9488', '#153132', '#0FB0A2', '#153132', '#0FB0A2', '#0D9488', '#0D9488', '#153132', '#0D9488'],
  ['#9333EA', '#3F215E', '#BF86F3', '#3F215E', '#BF86F3', '#B06AF0', '#B06AF0', '#3F215E', '#B06AF0'],
  ['#3B82F6', '#1E2D48', '#5895F7', '#1E2D48', '#5895F7', '#3B82F6', '#3B82F6', '#1E2D48', '#3B82F6'],
  ['#6B7280', '#2C2F35', '#9BA1AC', '#2C2F35', '#9BA1AC', '#7A8190', '#7A8190', '#2C2F35', '#7A8190'],
  ['#B45309', '#3E2717', '#EE6E0C', '#3E2717', '#EE6E0C', '#D1600A', '#D1600A', '#3E2717', '#D1600A'],
  ['#BE185D', '#4C1831', '#EC659D', '#4C1831', '#EC659D', '#E84A8C', '#E84A8C', '#4C1831', '#E84A8C'],
  ['#0369A1', '#113247', '#05A4FA', '#113247', '#05A4FA', '#0490DD', '#0490DD', '#113247', '#0490DD'],
  ['#A16207', '#3A2B17', '#DC860A', '#3A2B17', '#DC860A', '#BE7408', '#BE7408', '#3A2B17', '#BE7408'],
  ['#475569', '#262C35', '#93A1B6', '#262C35', '#93A1B6', '#6F829D', '#6F829D', '#262C35', '#6F829D'],
];

describe('default 프로파일 다크 산출 불변 — 라이트 기준 표면 이동이 일반 배지의 다크를 건드리지 않았다', () => {
  it.each(DARK_FROZEN)(
    '%s: default 다크 8값이 수정 전과 같다',
    (c, bg8, fg8, bg12, fg12, ink, bdBare, bd20, solid) => {
      const t8 = entityTintStyle(c, { from: 8 });
      const t12 = entityTintStyle(c, { from: 12 });
      expect(t8['--et-bg-dark'], `${c} bg@8`).toBe(bg8);
      expect(t8['--et-fg-dark'], `${c} fg@8`).toBe(fg8);
      expect(t12['--et-bg-dark'], `${c} bg@12`).toBe(bg12);
      expect(t12['--et-fg-dark'], `${c} fg@12`).toBe(fg12);
      expect(entityInkStyle(c)['--et-fg-dark'], `${c} ink`).toBe(ink);
      expect(entityBorderStyle(c)['--et-bd-dark'], `${c} bd bare`).toBe(bdBare);
      expect(entityBorderStyle(c, { from: 20 })['--et-bd-dark'], `${c} bd@20`).toBe(bd20);
      expect(entitySolidStyle(c)['--et-solid-dark'], `${c} solid`).toBe(solid);
    },
  );
  // 동결표가 default **전용**임을 못박는다 — 프로파일 배지는 이 표를 따르지 않아야 정상이다.
  it('track-card·task-ref는 이 동결표를 따르지 않는다 (부모가 달라 다크가 바뀌는 게 정상)', () => {
    for (const profile of ['track-card', 'task-ref']) {
      const changed = DARK_FROZEN.filter(([c, , , bg12]) =>
        entityTintStyle(c, { surface: profile })['--et-bg-dark'] !== bg12);
      expect(changed.length, `${profile}에서 다크가 바뀐 색 수`).toBeGreaterThan(0);
    }
  });

  it('코퍼스 31색을 빠짐없이 얼렸다', () => {
    expect(DARK_FROZEN).toHaveLength(CORPUS.length);
    expect(DARK_FROZEN.map((r) => r[0])).toEqual(CORPUS);
  });
});

// hue 의미 보존 — 틴트·잉크는 밝기만 움직이고 색상환 위치는 유지한다.
// 실측 최대 편차는 --et-bg 3.529°(#000080)·--et-bd 2.872°(#16A34A)라 6°면 여유가 있고,
// "회색으로 뭉갰다"(hue 소실)는 확실히 잡힌다.
describe('hue 의미 보존 — 라이트 산출이 색상환 위치를 지킨다', () => {
  const hslOf = (hex) => {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    const d = mx - mn;
    let h = 0;
    let sat = 0;
    if (d !== 0) {
      sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, sat * 100];
  };
  const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const HUE_TOL = 6;
  // 무채색(#000000·#808080·#F9FAFB 등)은 hue가 정의되지 않는다 — 유채색만 잰다.
  const CHROMATIC = CORPUS.filter((c) => hslOf(c)[1] >= 10);

  it('유채색 코퍼스가 비어 있지 않다', () => {
    expect(CHROMATIC.length).toBeGreaterThanOrEqual(20);
  });
  it.each(CHROMATIC)('%s: --et-bg / --et-fg / ink / --et-bd가 원 hue를 유지한다', (c) => {
    const [h] = hslOf(c);
    const st = entityTintStyle(c);
    expect(hueGap(h, hslOf(st['--et-bg'])[0]), `${c} bg`).toBeLessThanOrEqual(HUE_TOL);
    expect(hueGap(h, hslOf(st['--et-fg'])[0]), `${c} fg`).toBeLessThanOrEqual(HUE_TOL);
    expect(hueGap(h, hslOf(entityInkStyle(c)['--et-fg'])[0]), `${c} ink`).toBeLessThanOrEqual(HUE_TOL);
    expect(hueGap(h, hslOf(entityBorderStyle(c, { from: 20 })['--et-bd'])[0]), `${c} bd`)
      .toBeLessThanOrEqual(HUE_TOL);
  });
  it('색상 계열이 서로 구분된 채 남는다 — 회색으로 수렴하지 않았다', () => {
    const hues = ['#DC2626', '#16A34A', '#2563EB'].map((c) => hslOf(entityTintStyle(c)['--et-bg'])[0]);
    expect(hueGap(hues[0], hues[1])).toBeGreaterThan(60);
    expect(hueGap(hues[1], hues[2])).toBeGreaterThan(60);
  });
});

// 네 API의 **라이트** 동작 — 기준 표면 이동이 shape 계약을 안 바꿨음을 고정한다.
// (entityTintStyle·entityInkStyle의 실제 표면 전건 대비는 colorContrast.test.js의
//  LIGHT_SURFACES describe가 진다. 여기서는 나머지 두 API와 값의 형식을 본다.)
describe('라이트 4 API — 기준 표면 이동 후에도 shape 계약이 같다', () => {
  it('entityBorderStyle: from 생략은 여전히 라이트 원색이다 — 기준 표면과 무관하다', () => {
    for (const c of CORPUS) expect(entityBorderStyle(c)['--et-bd'], c).toBe(c);
  });
  it('entityBorderStyle: from을 주면 라이트도 표면 기준 틴트다', () => {
    for (const c of CORPUS) {
      expect(entityBorderStyle(c, { from: 20 })['--et-bd'], c)
        .toBe(tintFor(c, ENTITY_SURFACES.light, 20));
    }
  });
  it('entitySolidStyle: 라이트는 원색 그대로다 — 기준 표면과 무관하다', () => {
    for (const c of CORPUS) expect(entitySolidStyle(c)['--et-solid'], c).toBe(c);
  });
  it('라이트 변수 전부 6자리 hex다 — alpha·color-mix가 새로 끼지 않았다', () => {
    for (const c of CORPUS) {
      const vals = [
        entityTintStyle(c)['--et-bg'], entityTintStyle(c)['--et-fg'],
        entityInkStyle(c)['--et-fg'], entityBorderStyle(c, { from: 20 })['--et-bd'],
        entitySolidStyle(c)['--et-solid'],
      ];
      for (const v of vals) expect(v, `${c} -> ${v}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 표면 프로파일 (S7 blocker correction, 2026-08-31)
// ─────────────────────────────────────────────────────────────────────────────

// 프로파일 값은 손으로 적은 hex가 아니라 **_themes.scss 토큰(과 그 합성)의 복제본**이다.
// 여기서 토큰을 다시 읽어 동치를 고정한다 — 토큰이 움직이면 이 게이트가 먼저 RED가 된다.
describe('ENTITY_SURFACE_PROFILES — _themes.scss 토큰·합성식과 동치다', () => {
  const themes = readFileSync(resolve(here, '../styles/_themes.scss'), 'utf8');
  const darkAt = themes.indexOf("[data-theme='dark']");
  const L = themes.slice(0, darkAt);
  const D = themes.slice(darkAt);
  const tok = (chunk, name) => chunk.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`))[1].toUpperCase();
  // rgba(r, g, b, a) 토큰 → { hex, pct }
  const rgba = (chunk, name) => {
    const m = chunk.match(new RegExp(`--${name}:\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([0-9.]+)\\s*\\)`));
    const [, r, g, b, a] = m;
    const hex = `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    return { hex, pct: Number(a) * 100 };
  };

  it('default = 양 테마 --color-surface', () => {
    expect(ENTITY_SURFACE_PROFILES.default.light).toBe(tok(L, 'color-surface'));
    expect(ENTITY_SURFACE_PROFILES.default.dark).toBe(tok(D, 'color-surface'));
  });

  // track-card 최악값은 **selected 행**이다: track.scss가 --color-primary를 6%로 섞어
  // 행 배경을 대체하고, 그 아래는 --track-paper다. 퍼센트는 SCSS에서 직접 읽어 결속한다.
  //
  // ⛔ 앵커 없이 첫 `&--selected`를 읽지 마라. track.scss에는 같은 형태의 블록이 둘 있고
  //    (.TrackTimeline LaneRow가 .TrackTree__Row보다 **앞**에 온다) 앵커가 없으면
  //    TrackTree를 변조해도 Timeline 값이 대신 읽혀 통과한다(false-green).
  //    아래 mutation 테스트가 이 앵커가 살아 있음을 증명한다.
  it('track-card = selected 행 합성(primary 6% over --track-paper) — 양 테마', () => {
    const track = readFileSync(resolve(here, '../styles/components/track/track.scss'), 'utf8');
    const pct = trackTreeSelectedPct(track);
    expect(pct).toBe(6);
    // --track-paper: 라이트는 $_l-surface 보간, 다크는 리터럴.
    const lPaper = themes.match(/\$_l-surface:\s*(#[0-9A-Fa-f]{6})\s*;/)[1].toUpperCase();
    expect(themes).toMatch(/--track-paper:\s*#\{\$_l-surface\}/);
    expect(lPaper).toBe(tok(L, 'color-surface'));
    expect(ENTITY_SURFACE_PROFILES['track-card'].light).toBe(mixSrgb(tok(L, 'color-primary'), lPaper, pct));
    expect(ENTITY_SURFACE_PROFILES['track-card'].dark).toBe(mixSrgb(tok(D, 'color-primary'), tok(D, 'track-paper'), pct));
  });

  // ⚑ 앵커가 살아 있다는 **증명**. TrackTree 값만 바꾸고 Timeline은 그대로 둔 사본에서
  //    ① 앵커 판독은 변조를 보고(=RED가 될 수 있고) ② 앵커 없는 옛 판독은 못 본다(=false-green).
  //    이 테스트가 없으면 위 계약은 Timeline을 검사하면서 통과할 수 있다.
  it('TrackTree selected 비율만 변조하면 앵커 판독이 따라 움직인다 (Timeline은 불변)', () => {
    const track = readFileSync(resolve(here, '../styles/components/track/track.scss'), 'utf8');
    const treeBlock = topLevelBlock(track, '.TrackTree');
    const mutatedTree = treeBlock.replace(SELECTED_PCT, (m) => m.replace('6%', '9%'));
    expect(mutatedTree, '변조가 실제로 적용됐다').not.toBe(treeBlock);
    const mutated = track.replace(treeBlock, mutatedTree);

    expect(trackTreeSelectedPct(mutated), 'TrackTree 판독은 변조를 본다').toBe(9);
    expect(trackTimelineSelectedPct(mutated), 'Timeline은 건드리지 않았다').toBe(6);
    // 앵커 없는 옛 정규식은 파일 앞쪽 Timeline을 읽어 변조를 놓친다 = 재현된 false-green.
    expect(Number(mutated.match(SELECTED_PCT)[1]), '앵커 없는 판독은 변조를 못 본다').toBe(6);

    // 그리고 앵커 판독이 계약과 물려 있으므로, 변조본으로 계산하면 프로파일 값이 실제로 갈린다.
    expect(mixSrgb(tok(D, 'color-primary'), tok(D, 'track-paper'), trackTreeSelectedPct(mutated)))
      .not.toBe(ENTITY_SURFACE_PROFILES['track-card'].dark);
  });

  // 이 부등식이 다크 결함의 원인이었다 — 뒤집히면 프로파일 전제를 재검토해야 한다.
  it('다크에서 --track-card는 --color-surface보다 밝다 (default로는 못 덮는 이유)', () => {
    expect(relativeLuminance(tok(D, 'track-card')))
      .toBeGreaterThan(relativeLuminance(tok(D, 'color-surface')));
  });

  // task-ref 부모는 토큰이 아니라 **합성 결과**다: 반투명 --color-primary-subtle을 그 아래 표면에 얹은 색.
  it('--color-primary-subtle은 --color-primary를 그 알파로 얹은 것이다', () => {
    expect(rgba(L, 'color-primary-subtle').hex).toBe(tok(L, 'color-primary'));
    expect(rgba(D, 'color-primary-subtle').hex).toBe(tok(D, 'color-primary'));
  });

  it('task-ref 라이트 = primary-subtle over --color-surface (라이트 최악 = 가장 어두운 부모)', () => {
    const { hex, pct } = rgba(L, 'color-primary-subtle');
    expect(ENTITY_SURFACE_PROFILES['task-ref'].light).toBe(mixSrgb(hex, tok(L, 'color-surface'), pct));
  });

  it('task-ref 다크 = primary-subtle over --track-card (다크 최악 = 가장 밝은 부모)', () => {
    const { hex, pct } = rgba(D, 'color-primary-subtle');
    expect(ENTITY_SURFACE_PROFILES['task-ref'].dark).toBe(mixSrgb(hex, tok(D, 'track-card'), pct));
  });

  it('ENTITY_SURFACES는 default 프로파일과 같은 객체다 — 기존 호출부 호환', () => {
    expect(ENTITY_SURFACES).toBe(ENTITY_SURFACE_PROFILES.default);
  });

  it('프로파일은 정확히 6종이다 — 몰래 늘어나면 원장이 낡는다', () => {
    expect(Object.keys(ENTITY_SURFACE_PROFILES).sort()).toEqual(
      ['default', 'surface-overlay', 'task-list-raised', 'task-ref', 'track-card', 'track-header'],
    );
    expect(Object.keys(ENTITY_SURFACE_PROFILES).sort()).toEqual(Object.keys(SURFACE_PARENTS).sort());
  });

  // ── 새 프로파일 3종도 토큰·합성식과 동치다 ───────────────────────────────
  // 라이트 raised 계열은 color.adjust 파생이라 소스에 hex가 없다 → 컴파일 산출을 읽는다.
  it('surface-overlay = 라이트 --color-surface(hover 최악) · 다크 --color-surface-overlay(idle 최악)', () => {
    expect(ENTITY_SURFACE_PROFILES['surface-overlay'].light).toBe(tokenOf('light', 'color-surface'));
    expect(ENTITY_SURFACE_PROFILES['surface-overlay'].dark).toBe(tokenOf('dark', 'color-surface-overlay'));
    // 이 부등식이 idle 결함의 원인이었다 — 뒤집히면 최악 부모가 hover 쪽으로 옮겨간다.
    expect(relativeLuminance(tokenOf('dark', 'color-surface-overlay')))
      .toBeGreaterThan(relativeLuminance(tokenOf('dark', 'color-surface')));
  });

  it('track-header = 그라데이션 양 끝(--track-paper ↔ --track-paper-raised) 중 최악', () => {
    const header = readFileSync(resolve(here, '../styles/components/track/track.scss'), 'utf8');
    // 그라데이션 선언 자체를 결속한다 — 단색으로 바뀌면 이 계약을 다시 봐야 한다.
    expect(topLevelBlock(header, '.TrackHeader'))
      .toMatch(/background: linear-gradient\(180deg, \$track-paper 0%, var\(--track-paper-raised\) 100%\)/);
    expect(ENTITY_SURFACE_PROFILES['track-header'].light).toBe(tokenOf('light', 'track-paper'));
    expect(ENTITY_SURFACE_PROFILES['track-header'].dark).toBe(tokenOf('dark', 'track-paper-raised'));
    // 라이트는 위쪽 끝이, 다크는 아래쪽 끝이 최악이다.
    expect(relativeLuminance(tokenOf('light', 'track-paper')))
      .toBeLessThan(relativeLuminance(tokenOf('light', 'track-paper-raised')));
    expect(relativeLuminance(tokenOf('dark', 'track-paper-raised')))
      .toBeGreaterThan(relativeLuminance(tokenOf('dark', 'track-paper')));
  });

  it('task-list-raised = selected 워시 합성 — subtask(--color-surface-raised)보다 최악이다', () => {
    const taskList = readFileSync(resolve(here, '../styles/components/branch/taskList.scss'), 'utf8');
    const row = topLevelBlock(taskList, '.TaskListRow');
    expect(row, 'selected 워시 선언').toMatch(/&--selected \{\s*\n\s*background: \$color-primary-subtle;/);
    for (const theme of ['light', 'dark']) {
      const sel = tokenOver(theme, 'color-primary-subtle', tokenOf(theme, 'color-surface'));
      expect(ENTITY_SURFACE_PROFILES['task-list-raised'][theme]).toBe(sel);
      const sub = tokenOf(theme, 'color-surface-raised');
      const worse = theme === 'light'
        ? relativeLuminance(sel) <= relativeLuminance(sub)     // 라이트는 더 어두운 쪽이 최악
        : relativeLuminance(sel) >= relativeLuminance(sub);    // 다크는 더 밝은 쪽이 최악
      expect(worse, `${theme}: selected ${sel} vs subtask ${sub}`).toBe(true);
    }
  });

  it('모르는 프로파일 이름은 조용히 default로 접히지 않고 던진다', () => {
    expect(() => entityTintStyle('#16A34A', { surface: 'track_card' })).toThrow(/unknown entity surface profile/);
    expect(() => entityTintStyle('', { surface: 'nope' })).toThrow();          // blank보다 먼저 검사한다
    expect(() => entityTintStyle('#1a6f', { surface: 'nope' })).toThrow();     // passthrough보다도 먼저
  });
});

// 각 프로파일의 기준값이 정말 "그 프로파일 부모 중 최악"인지 — 원장과 상수를 맞물린다.
describe('프로파일 기준값 = 그 프로파일 부모 중 대비 최악값', () => {
  it.each(Object.keys(SURFACE_PARENTS))('%s', (profile) => {
    const parents = SURFACE_PARENTS[profile];
    // 라이트: 틴트가 부모보다 어둡다 → 가장 어두운 부모가 최악
    const darkestLight = parents.light.map(([, h]) => h)
      .reduce((a, b) => (relativeLuminance(a) <= relativeLuminance(b) ? a : b));
    // 다크: 틴트가 부모보다 밝다 → 가장 밝은 부모가 최악
    const lightestDark = parents.dark.map(([, h]) => h)
      .reduce((a, b) => (relativeLuminance(a) >= relativeLuminance(b) ? a : b));
    expect(ENTITY_SURFACE_PROFILES[profile].light).toBe(darkestLight);
    expect(ENTITY_SURFACE_PROFILES[profile].dark).toBe(lightestDark);
  });
});

// ── 프로파일이 실제로 다른 값을 낸다 ─────────────────────────────────────────
// 호출부가 그 프로파일을 **쓰는지**는 여기서 못 본다(그건 산출 재계산이라 동어반복이다).
// 실제 호출부 결속은 entityTintFallback.dom.test.js(task-ref 두 경로)와
// themePalette.test.js(TrackTree SSR)가 **진짜 호출부를 태워서** 진다.
// 여기서는 그 게이트들이 공허하지 않다는 전제 — "프로파일이 다르면 값이 실제로 갈린다" — 를 고정한다.
const PROFILE_SITES = [
  ['track-card (TrackTree__StatusPill)', 'track-card', { from: 8, alpha: '14' }],
  ['task-ref (ref-chip__badge)', 'task-ref', { alpha: '20' }],
];

describe('프로파일 산출은 default와 실제로 갈린다', () => {
  it.each(PROFILE_SITES)('%s: default로 되돌리면 산출이 달라진다', (_site, profile, opts) => {
    const differing = CORPUS.filter((c) => {
      const a = entityTintStyle(c, { ...opts, surface: profile });
      const b = entityTintStyle(c, { ...opts });   // default로 되돌린 mutation
      return a['--et-bg'] !== b['--et-bg'] || a['--et-bg-dark'] !== b['--et-bg-dark'];
    });
    expect(differing.length, `${profile}: default와 다른 색 수`).toBeGreaterThan(0);
  });

  it.each(PROFILE_SITES)('%s: default로 되돌리면 실제 부모에서 BADGE_MIN이 깨진다', (_site, profile, opts) => {
    const broken = [];
    for (const theme of ['light', 'dark']) {
      const key = theme === 'light' ? '--et-bg' : '--et-bg-dark';
      for (const [, parent] of SURFACE_PARENTS[profile][theme]) {
        for (const c of CORPUS) {
          const reverted = entityTintStyle(c, { ...opts });   // default
          if (contrastRatio(reverted[key], parent) < BADGE_MIN) broken.push(`${theme}/${parent}/${c}`);
        }
      }
    }
    expect(broken.length, `${profile} 되돌림이 만드는 미달 건수`).toBeGreaterThan(0);
  });

  it('반대로 default 배지를 track-card/task-ref로 바꾸면 default 부모 계약은 계속 선다', () => {
    // 프로파일을 잘못 **넓게** 적용해도 안전하다는 뜻이 아니라, 이 세 기준이 서로 모순되지 않는다는 확인이다.
    for (const profile of Object.keys(ENTITY_SURFACE_PROFILES)) {
      for (const [, parent] of SURFACE_PARENTS.default.light) {
        for (const c of CORPUS) {
          expect(contrastRatio(entityTintStyle(c, { surface: profile })['--et-bg'], parent))
            .toBeGreaterThanOrEqual(BADGE_MIN);
        }
      }
    }
  });
});

// Issue ref는 setBadge를 공유하지만 color:null로 들어와 tint 경로에 진입하지 않는다.
// task-ref 프로파일이 Issue ref의 open/closed 색을 오염시키지 않는다는 계약.
describe('Issue ref는 task-ref 프로파일에 오염되지 않는다', () => {
  it('color가 없으면 어떤 프로파일이든 undefined — --et-* 도 짝 클래스도 없다', () => {
    for (const profile of Object.keys(ENTITY_SURFACE_PROFILES)) {
      expect(entityTintStyle(null, { alpha: '20', surface: profile }), profile).toBeUndefined();
      expect(entityTintStyle('', { alpha: '20', surface: profile }), profile).toBeUndefined();
    }
  });
  it('refHydration.setBadge는 Issue ref에 color:null을 넘긴다 — 소스 계약', () => {
    const src = readFileSync(resolve(here, './refHydration.js'), 'utf8');
    const issueCalls = src.split('\n').filter((l) => /setBadge\(el, \{ category: /.test(l));
    expect(issueCalls.length).toBe(2);                       // resolve 경로 + fallback 경로
    for (const l of issueCalls) expect(l).toMatch(/color: null/);
  });
});

// ── P11-A 전용 회귀 게이트는 **넣지 않는다** ─────────────────────────────────
// P11이 B로 결정됐으므로(2026-08-26) 라이트 exact 보존 게이트 2 describe
// (`P11-A — 텍스트 전용 저장색 표면…` / `P11-A — 라이트 exact 보존: 접미 5종 × 코퍼스 전건`)는
// 성립하지 않는다 — B의 라이트 값은 `tintFor`/`inkFor` 산출이다.

// passthrough는 B에서도 접미를 그대로 이어 붙여야 한다 — `#1a6f`는 접미 5종에서
// 서로 다른 **유효** 배경을 만든다(S7 계획 「저장색 입력 계약」 실측).
const ALPHA_SUFFIXES = ['14', '15', '20', '33', '40'];

describe('passthrough — 지원 밖 값은 오늘의 선언을 문자 그대로 복원한다', () => {
  it.each(ALPHA_SUFFIXES)('alpha %s — entityTintStyle이 접미를 그대로 잇는다', (a) => {
    for (const c of ['#1a6f', '#1a6', 'red', '  #16A34A ']) {
      const s = entityTintStyle(c, { alpha: a });
      expect(s, `${c}/${a}`).toEqual({ background: `${c}${a}`, color: c });
    }
  });
  it.each(ALPHA_SUFFIXES)('alpha %s — entityBorderStyle이 접미를 그대로 잇는다', (a) => {
    for (const c of ['#1a6f', '#1a6', 'red']) {
      expect(entityBorderStyle(c, { alpha: a }), `${c}/${a}`).toEqual({ borderColor: `${c}${a}` });
    }
  });
  it('접미 생략 시 entityBorderStyle은 원색, entityInkStyle·entitySolidStyle은 원 문자열이다', () => {
    for (const c of ['#1a6f', 'red']) {
      expect(entityBorderStyle(c)).toEqual({ borderColor: c });
      expect(entityInkStyle(c)).toEqual({ color: c });
      expect(entitySolidStyle(c)).toEqual({ background: c });
    }
  });
  it('접미 5종이 #1a6f에서 서로 다른 5개 배경을 만든다', () => {
    const bgs = ALPHA_SUFFIXES.map((a) => entityTintStyle('#1a6f', { alpha: a }).background);
    expect(new Set(bgs).size).toBe(5);
  });
});

describe('레거시 alpha 진입점 대응표', () => {
  it('14/15/20/33/40이 8/8/12/20/25로 매핑된다', () => {
    expect(LEGACY_ALPHA_ENTRY).toEqual({ 14: 8, 15: 8, 20: 12, 33: 20, 40: 25 });
  });
});

describe('storedColor.scss — 다크 규칙이 네 클래스를 모두 덮는다', () => {
  const scss = readFileSync(resolve(here, '../styles/components/common/storedColor.scss'), 'utf8');
  it.each(['EntityTint', 'EntityInk', 'EntityBorder', 'EntitySolid'])('%s 다크 규칙이 있다', (cls) => {
    expect(scss).toMatch(new RegExp(`\\.${cls}\\b`));
  });
  it('다크 규칙은 html[data-theme=\'dark\'] 스코프 안에만 있다', () => {
    // 라이트에는 어떤 선언도 도달하면 안 된다
    const darkIdx = scss.indexOf("html[data-theme='dark']");
    expect(darkIdx).toBeGreaterThanOrEqual(0);
    expect(scss.slice(0, darkIdx)).not.toMatch(/\.Entity(Tint|Ink|Border|Solid)\s*\{/);
  });
  // 폴백은 누락 변수에 대한 방어값이다 — 기존 category/background 스타일의 복원을 보장하지는
  // 않는다(클래스가 붙으면 !important가 이긴다). 실제 안전장치는 --et-on 조건부 클래스이고,
  // 그 배선은 Task 3이 행동 테스트로 증명한다.
  it('폴백 없는 var()를 쓰지 않는다 — 변수 누락 시 무효 선언이 되지 않게', () => {
    for (const m of scss.matchAll(/var\((--et-[a-z-]+)([^)]*)\)/g)) {
      expect(m[2].startsWith(','), `${m[1]}에 폴백이 없다`).toBe(true);
    }
  });
});

// 계약(index 「`_app.js` SCSS import 순서」): storedColor.scss는 항상 마지막 `import "@/styles…"`다.
// 마지막 한 줄만 단정하므로 앞에 무엇이 끼어도 GREEN이다.
describe('_app.js — storedColor.scss가 마지막 SCSS import다', () => {
  it('마지막 @/styles import가 storedColor.scss다', () => {
    const app = readFileSync(resolve(here, '../pages/_app.js'), 'utf8');
    const lines = app.split('\n').filter((l) => l.startsWith('import "@/styles'));
    expect(lines[lines.length - 1]).toContain('components/common/storedColor.scss');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — 회귀 스윕
// ─────────────────────────────────────────────────────────────────────────────

// 저장색 뒤에 2자리 hex를 붙여 alpha로 쓰던 패턴은 다시 나타나면 회귀다.
// TaskRefExtension.js:87은 예외 — renderHTML(저장 직렬화)이라 의도적으로 남긴다.
describe('저장색 소비 — hex alpha 접미가 남아 있지 않다', () => {
  const FILES = [
    'components/Branch/Archive/ArchiveList.js',
    'components/Branch/Board/BoardCard.js',
    'components/Branch/TaskFilterBar.js',
    'components/Branch/Tasks/TaskListRow.js',
    'components/MyTasks/MyTasksView.js',
    'components/common/LabelTagInput.js',
    'components/Canvas/extensions/TaskRefPopup.js',
    'components/Messenger/TaskRefCard.js',
    'components/Messenger/TaskSearchPopup.js',
    'components/Track/Detail/TrackItemDetail.js',
    'components/Track/TrackHeader.js',
    'components/Track/Tree/TrackTree.js',
    'components/Track/Flow/CrossBranchTaskNode.js',
    'library/refHydration.js',
  ];
  const PATTERNS = [
    /[Cc]olor\s*\+\s*['"][0-9a-fA-F]{2}['"]/,      // color + '20'
    /\$\{[^}]*[Cc]olor[^}]*\}[0-9a-fA-F]{2}/,      // `${task.status_color}20`
  ];

  // 금지 대상은 **코드**다. 되돌리지 말라고 경고하는 주석(TaskFilterBar.js의 ⛔ 블록)까지 잡으면
  // 그 경고를 지워야 GREEN이 되는 자기모순이 된다. themePalette.test.js:365와 같은 관용구.
  const codeLines = (src) => src.split('\n').map((l) => l.split('//')[0]);

  it('지정 14파일에 hex alpha 접미 패턴이 없다', () => {
    const offenders = [];
    for (const f of FILES) {
      codeLines(readFileSync(resolve(here, '..', f), 'utf8')).forEach((line, i) => {
        if (PATTERNS.some((p) => p.test(line))) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('TaskRefExtension.js는 renderHTML 1건만 남긴다 (저장 직렬화 — 의도적)', () => {
    const src = readFileSync(resolve(here, '../components/Canvas/extensions/TaskRefExtension.js'), 'utf8');
    const hits = codeLines(src)
      .map((line, i) => (PATTERNS.some((p) => p.test(line)) ? i + 1 : null))
      .filter(Boolean);
    expect(hits).toHaveLength(1);
    // 그 1건은 renderHTML 안에 있어야 한다 — addNodeView로 옮겨가면 RED
    const renderStart = src.indexOf('renderHTML(');
    const nodeViewStart = src.indexOf('addNodeView(');
    const hitOffset = src.split('\n').slice(0, hits[0] - 1).join('\n').length;
    expect(hitOffset).toBeGreaterThan(renderStart);
    expect(hitOffset).toBeLessThan(nodeViewStart);
  });
});

// 지원 밖 저장색에서만 접미가 보인다 — 표의 alpha를 지우면 여기가 RED다.
describe('Task 3 호출표 — 지원 밖 저장색에서 오늘의 선언이 문자 그대로 복원된다', () => {
  const C = '#1a6f';   // CSS Color 4 4자리. 접미 5종이 서로 다른 유효 배경을 만든다(§5)
  // ⚠️ TaskFilterBar 2행은 **helper 계약**만 여기서 고정한다. 그 표면은 색 도메인이 둘이라
  //    (호출표 9·10행 = 하이브리드) passthrough 결과를 렌더하지 않고 chipTintStyle 경로로 보낸다 —
  //    표면 행동은 themePalette.test.js의 SSR 4상태가, 인자 문자열은 아래 SITES가 고정한다.
  const CALLS = [
    ['TaskFilterBar.js:403 bg',    () => entityTintStyle(C, { from: 8, alpha: '15' }).background,     `${C}15`],
    ['TaskFilterBar.js:403 bd',    () => entityBorderStyle(C).borderColor,                            C],
    ['TaskFilterBar.js:410 ink',   () => entityTintStyle(C, { from: 8, alpha: '15' }).color,          C],
    ['LabelTagInput.js:116 bg',    () => entityTintStyle(C, { alpha: '20' }).background,              `${C}20`],
    ['LabelTagInput.js:117 bd',    () => entityBorderStyle(C).borderColor,                            C],
    ['TrackItemDetail.js:70 bg',   () => entityTintStyle(C, { from: 8, alpha: '14' }).background,     `${C}14`],
    ['TrackItemDetail.js:100 bg',  () => entityTintStyle(C, { from: 8, alpha: '14' }).background,     `${C}14`],
    ['TrackItemDetail.js:101 sol', () => entitySolidStyle(C).background,                              C],
    ['TrackItemDetail.js:104 ink', () => entityInkStyle(C).color,                                     C],
    ['TrackItemDetail.js:104 bd',  () => entityBorderStyle(C, { from: 25, alpha: '40' }).borderColor, `${C}40`],
    ['TrackHeader.js:59 bg',       () => entityTintStyle(C, { from: 8, alpha: '14' }).background,     `${C}14`],
    ['TrackHeader.js:59 bd',       () => entityBorderStyle(C, { from: 20, alpha: '33' }).borderColor, `${C}33`],
    ['TrackTree.js:150 bg',        () => entityTintStyle(C, { from: 8, alpha: '14' }).background,     `${C}14`],
    ['TrackTree.js:151 sol',       () => entitySolidStyle(C).background,                              C],
    ['CrossBranchTaskNode.js:47',  () => entityTintStyle(C, { from: 8, alpha: '14' }).background,     `${C}14`],
    ['라벨 배지 4곳 bg',            () => entityTintStyle(C, { alpha: '20' }).background,              `${C}20`],
    ['상태 배지 4곳 bg',            () => entityTintStyle(C, { alpha: '20' }).background,              `${C}20`],
  ];
  it.each(CALLS)('%s', (_name, run, expected) => { expect(run()).toBe(expected); });

  it('접미 5종이 서로 다른 배경을 만든다 — 하나로 접히면 회귀다', () => {
    const bgs = ['14', '15', '20', '33', '40'].map((a) => entityTintStyle(C, { alpha: a }).background);
    expect(new Set(bgs).size).toBe(5);
  });

  it.each([['red'], ['#1a6'], ['#11223344'], ['  #16A34A '], ['not-a-color'], ['#1a6f']])(
    '%s는 4함수 어디서도 --et-on을 싣지 않는다', (raw) => {
      for (const fn of [entityTintStyle, entityInkStyle, entityBorderStyle, entitySolidStyle]) {
        expect(fn(raw)['--et-on'], `${fn.name}(${raw})`).toBeUndefined();
      }
    });

  it.each([['#16A34A'], ['#16a34a'], ['#112233']])('%s는 4함수 전부 --et-on과 --et-* 변수를 싣는다', (raw) => {
    for (const fn of [entityTintStyle, entityInkStyle, entityBorderStyle, entitySolidStyle]) {
      const st = fn(raw);
      expect(st['--et-on'], fn.name).toBe('1');
      expect(Object.keys(st).some((k) => k.startsWith('--et-') && k !== '--et-on'), fn.name).toBe(true);
    }
  });
});
