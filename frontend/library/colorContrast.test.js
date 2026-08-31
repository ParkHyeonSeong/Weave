import { describe, it, expect } from 'vitest';
import {
  normalizeStoredColor, hexToRgb, rgbToHex, relativeLuminance,
  contrastRatio, mixSrgb, adjustLightness, tintFor, inkFor,
  TINT_LADDER, BADGE_MIN, TEXT_MIN,
} from './colorContrast.js';
import { entityTintStyle, entityInkStyle } from './entityTint.js';
// 코퍼스·실측 표면 정본은 공유 픽스처다 — entityTint.test.js도 같은 값을 본다.
import { CORPUS, LABEL_PRESET, LIGHT_SURFACES, LIGHT_ENTRIES, SURFACE_PARENTS } from './__fixtures__/storedColorCorpus.js';

describe('normalizeStoredColor — 저장색 지원 집합은 정확히 #RRGGBB다', () => {
  it('#RRGGBB를 대문자로 정규화한다', () => {
    expect(normalizeStoredColor('#16a34a')).toBe('#16A34A');
    expect(normalizeStoredColor('#16A34A')).toBe('#16A34A');
  });
  // ⚠️ 아래 4종을 "받아주면" 라이트가 바뀐다 — S7 계획 「저장색 입력 계약」 브라우저 실측표.
  //   `#1a6` 확장 → `#1a620`(무효, 배경 없음)이 유효한 배경으로 바뀐다
  //   trim      → `'  #16A34A 20'`(무효)이 `#16A34A20`(유효)으로 바뀐다
  //   `#` 생략 허용 → 접미를 붙일 때 같은 문제를 만든다
  //   8자리     → 오늘 유효한 글자색인데 null로 접으면 글자색이 사라진다
  it('넓히면 라이트가 바뀌는 형식은 지원하지 않는다(null)', () => {
    for (const wide of ['16A34A', '#1a6', '  #16A34A ', '#1a6f', '#11223344', 'red']) {
      expect(normalizeStoredColor(wide), String(wide)).toBeNull();
    }
  });
  it('유효하지 않은 입력은 null이다', () => {
    for (const bad of [null, undefined, '', '  ', '#12345', '#GGGGGG', 42, {}, []]) {
      expect(normalizeStoredColor(bad), String(bad)).toBeNull();
    }
  });
  it('Task 5의 normalizeCssColor와 혼동하지 않는다 — 그쪽은 닫힌 26값 매칭 전용이라 3자리·rgb()를 계속 흡수한다', () => {
    expect(normalizeStoredColor('rgb(22, 163, 74)')).toBeNull();
  });
});

describe('색 원시 함수', () => {
  it('hexToRgb / rgbToHex 왕복', () => {
    expect(hexToRgb('#16A34A')).toEqual([22, 163, 74]);
    expect(rgbToHex([22, 163, 74])).toBe('#16A34A');
  });
  it('relativeLuminance·contrastRatio 극단과 교환법칙', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
    expect(contrastRatio('#808080', '#808080')).toBeCloseTo(1, 6);
    expect(contrastRatio('#DC2626', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#DC2626'), 9);
  });
  it('mixSrgb 0%/100% 경계 + 12%는 hex-alpha 0x20 합성과 ±2/255 이내다', () => {
    expect(mixSrgb('#DC2626', '#FFFFFF', 0)).toBe('#FFFFFF');
    expect(mixSrgb('#DC2626', '#FFFFFF', 100)).toBe('#DC2626');
    // 0x20 = 32/255 = 12.549% — 기존 `color + '20'`이 흰 배경에서 만들던 값
    const mixed = hexToRgb(mixSrgb('#DC2626', '#FFFFFF', 12));
    const legacy = [0, 1, 2].map((i) => Math.round(255 + (hexToRgb('#DC2626')[i] - 255) * (32 / 255)));
    for (let i = 0; i < 3; i++) expect(Math.abs(mixed[i] - legacy[i])).toBeLessThanOrEqual(2);
  });
  it('adjustLightness는 hue를 보존하고 0~100에서 포화된다', () => {
    expect(adjustLightness('#16A34A', 0)).toBe('#16A34A');
    expect(adjustLightness('#FFFFFF', 20)).toBe('#FFFFFF');
    expect(adjustLightness('#000000', -20)).toBe('#000000');
  });
});


// P11-B 확정(2026-08-26) — 라이트/다크 **양쪽**에 같은 부등식을 건다. 세 행 모두 유지한다.
// 라이트가 두 행인 이유는 아래 「실제 라이트 표면」 주석 참조 — 배지는 두 토큰 위에 다 놓인다.
describe.each([
  ['light-bg', '#FFFFFF'],
  ['light-surface', '#F9FAFB'],
  ['dark', '#17181C'],
])('deterministic 대비 — %s 표면', (_theme, surface) => {
  it.each(CORPUS)('%s: 배지가 표면과 구분되고 글자가 읽힌다', (c) => {
    const bg = tintFor(c, surface, 12);
    const fg = inkFor(c, bg);
    expect(contrastRatio(bg, surface), `bg ${bg} vs surface ${surface}`).toBeGreaterThanOrEqual(BADGE_MIN);
    expect(contrastRatio(fg, bg), `fg ${fg} on bg ${bg}`).toBeGreaterThanOrEqual(TEXT_MIN);
  });
});

// ── 실제 라이트 표면 전건 (S7 P11-B 보정, 2026-08-31) ──────────────────────────
// 위 describe는 "기준 표면 = 대조 표면"일 때의 **알고리즘** 불변식이다. 제품에서 깨진 것은
// 그 불변식이 아니라 **기준 표면 선택**이었다: `ENTITY_SURFACES.light`가 페이지 배경 토큰
// (`--color-bg` = #FFFFFF)이었는데, 저장색 배지는 카드·행 표면 토큰
// (`--color-surface` = #F9FAFB) 위에도 그대로 놓인다. 흰색 기준 산출을 #F9FAFB에 얹으면
// 분리가 1.1968까지 떨어져 BADGE_MIN(1.25) 미달이었다(31색 중 23색).
//
// 아래 표는 `frontend/styles/_themes.scss` 라이트 블록에서 실측한, EntityTint 배지가
// **실제로 놓이는** 배경이다(호출부 17곳/15파일 → 최근접 도색 조상 추적):
//   --color-bg      #FFFFFF : BoardCard / TrackTree__Row / TrackDetail(--track-card) /
//                             TaskRefPopup / TaskFilterBar / TaskSearchPopup(--color-surface-overlay)
//   --color-surface #F9FAFB : TaskListRow·ArchiveList__Row·MyTasksRow **hover** /
//                             TaskRefCard / TrackTree 컨테이너(--track-paper)
// `--color-surface-hover`(#F3F4F6)는 배지 부모가 아니다 — 위 세 행의 hover 배경은
// `$color-surface`(#F9FAFB)이고, #F3F4F6를 쓰는 자리(Unassigned 아바타·카운트 칩·
// 드롭다운 옵션·MyTasksRow__Branch)에는 EntityTint가 붙지 않는다. 넓히지 마라.

describe.each(LIGHT_SURFACES)(
  '라이트 실제 표면 %s(%s) — entityTintStyle 산출이 그 위에서 계약을 지킨다',
  (_token, surface) => {
    describe.each(LIGHT_ENTRIES)('진입점 from=%s', (from) => {
      it.each(CORPUS)('%s: 배지가 표면과 구분되고 글자가 읽힌다', (c) => {
        const s = entityTintStyle(c, { from });
        expect(contrastRatio(s['--et-bg'], surface), `bg ${s['--et-bg']} vs ${surface}`)
          .toBeGreaterThanOrEqual(BADGE_MIN);
        expect(contrastRatio(s['--et-fg'], s['--et-bg']), `fg ${s['--et-fg']} on ${s['--et-bg']}`)
          .toBeGreaterThanOrEqual(TEXT_MIN);
      });
    });
  },
);

// entityInkStyle은 배지 배경이 아니라 **표면** 위에 직접 글자를 얹는다(TrackDetail__PrioPill 등).
describe.each(LIGHT_SURFACES)('라이트 실제 표면 %s(%s) — entityInkStyle 글자 대비', (_token, surface) => {
  it.each(CORPUS)('%s: 표면 위 글자가 AA를 만족한다', (c) => {
    expect(contrastRatio(entityInkStyle(c)['--et-fg'], surface)).toBeGreaterThanOrEqual(TEXT_MIN);
  });
});


// ── 표면 프로파일 × 실제 도색 부모 전건 (S7 blocker correction, 2026-08-31) ──
// 위 두 describe는 **default 프로파일**만 본다. 그런데 배지가 실제로 얹히는 부모는
// 역할마다 다르고, 브라우저 QA가 두 곳에서 계약 위반을 잡아냈다:
//   ① TrackTree 상태 배지 — 다크 부모가 --track-card(#1B1D22)로 --color-surface보다 **밝다**.
//      다크 틴트는 표면보다 밝으므로 더 밝은 부모 위에서 분리가 줄어든다 → 17/31 미달, 최저 1.1902.
//   ② Task ref 칩 **안쪽** 배지 — 부모가 페이지 표면이 아니라 칩 자신의 틴트 배경이다
//      (라이트 #EDEEF8 / 다크 #1F212C·#232632) → 라이트 31/31·다크 31/31 미달, 최저 1.0628.
// 두 곳 모두 S7 범위 안이다(TrackTree.js = Task 3, TaskRefExtension/refHydration = Task 4).
//
// 해법은 "전역 기준 표면을 최악값으로 올리기"가 **아니다** — 그러면 모든 배지가 함께 진해진다.
// 역할별 표면 프로파일로 그 배지들만 자기 부모 기준으로 계산한다.
describe.each(Object.keys(SURFACE_PARENTS))('표면 프로파일 %s — 실제 도색 부모 전건', (profile) => {
  describe.each(['light', 'dark'])('%s', (theme) => {
    const varKey = theme === 'light' ? '--et-bg' : '--et-bg-dark';
    const fgKey = theme === 'light' ? '--et-fg' : '--et-fg-dark';
    describe.each(SURFACE_PARENTS[profile][theme])('부모 %s(%s)', (_name, parent) => {
      it.each(CORPUS)('%s: 배지가 부모와 구분되고 글자가 읽힌다', (c) => {
        const s = entityTintStyle(c, { surface: profile });
        expect(contrastRatio(s[varKey], parent), `bg ${s[varKey]} vs parent ${parent}`)
          .toBeGreaterThanOrEqual(BADGE_MIN);
        expect(contrastRatio(s[fgKey], s[varKey]), `fg ${s[fgKey]} on ${s[varKey]}`)
          .toBeGreaterThanOrEqual(TEXT_MIN);
      });
    });
  });
});

describe('tintFor / inkFor — 결정성과 종료', () => {
  it('같은 입력에 같은 출력(결정적)', () => {
    for (const c of CORPUS) {
      expect(tintFor(c, '#17181C', 12)).toBe(tintFor(c, '#17181C', 12));
      expect(inkFor(c, '#17181C')).toBe(inkFor(c, '#17181C'));
    }
  });
  it('사다리 진입점을 존중한다 — from을 올리면 비율이 내려가지 않는다', () => {
    for (const c of LABEL_PRESET) {
      const a = tintFor(c, '#FFFFFF', 8);
      const b = tintFor(c, '#FFFFFF', 25);
      // 진입점이 높으면 표면과의 분리가 같거나 커진다
      expect(contrastRatio(b, '#FFFFFF')).toBeGreaterThanOrEqual(contrastRatio(a, '#FFFFFF') - 1e-9);
    }
  });
  it('사다리는 고정 6칸이고 상한이 상수다', () => {
    expect(TINT_LADDER).toEqual([8, 12, 16, 20, 25, 32]);
  });
  it('표면색과 같은 저장색도 분리된다(사다리 소진 폴백)', () => {
    for (const [c, s] of [['#FFFFFF', '#FFFFFF'], ['#17181C', '#17181C'], ['#0E0F11', '#0E0F11']]) {
      expect(contrastRatio(tintFor(c, s, 12), s)).toBeGreaterThanOrEqual(BADGE_MIN);
    }
  });
  it('이미 대비가 충분한 색은 inkFor가 원값을 그대로 돌려준다', () => {
    expect(inkFor('#16A34A', '#0E0F11')).toBe('#16A34A');
    expect(inkFor('#999999', '#0E0F11')).toBe('#999999');
  });
  it('유효하지 않은 색은 null이다', () => {
    expect(tintFor('nope', '#FFFFFF', 12)).toBeNull();
    expect(inkFor(null, '#FFFFFF')).toBeNull();
  });
});
