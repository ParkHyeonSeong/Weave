import { describe, it, expect } from 'vitest';
import { COLOR_CATEGORIES, COLOR_EXCEPTIONS, findException } from './colorExceptions.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, hitsFor, sweepFile } from './literalColorSweep.js';
import { TEXT_COLORS, HIGHLIGHT_COLORS, CELL_BG_COLORS } from './tiptapColorMap.js';

const REQUIRED_KEYS = ['file', 'selector', 'prop', 'value', 'category', 'reason'];

describe('colorExceptions — 분류 체계 계약', () => {
  it('분류는 정확히 8종이고 이름이 고정이다', () => {
    expect(COLOR_CATEGORIES).toEqual([
      'theme-dependent', 'fixed-on-color', 'overlay-scrim',
      'print-paper', 'palette-source', 'stored-color', 'third-party', 'dead',
    ]);
  });

  it('theme-dependent는 레지스트리에 등록될 수 없다 (이행 대상이지 예외가 아니다)', () => {
    const bad = COLOR_EXCEPTIONS.filter((e) => e.category === 'theme-dependent');
    expect(bad.map((e) => `${e.file}:${e.prop}:${e.value}`)).toEqual([]);
  });
});

describe('colorExceptions — 항목 shape 계약', () => {
  it('모든 항목이 6키를 갖고 여분 키가 없다', () => {
    const bad = COLOR_EXCEPTIONS.filter(
      (e) => Object.keys(e).sort().join(',') !== [...REQUIRED_KEYS].sort().join(','),
    );
    expect(bad.map((e) => `${e.file}:${e.value}:[${Object.keys(e).join(',')}]`)).toEqual([]);
  });

  it('모든 항목이 유효한 category를 갖는다', () => {
    // 유효 집합 = COLOR_CATEGORIES 8종. 단 theme-dependent는 위 describe가 별도로 원천 차단한다.
    const bad = COLOR_EXCEPTIONS.filter((e) => !COLOR_CATEGORIES.includes(e.category));
    expect(bad.map((e) => `${e.file}: ${e.category}`)).toEqual([]);
  });

  it('reason은 20자 이상이다 (왜 토큰을 쓸 수 없는가를 적는다)', () => {
    const bad = COLOR_EXCEPTIONS.filter((e) => typeof e.reason !== 'string' || e.reason.trim().length < 20);
    expect(bad.map((e) => `${e.file}:${e.value} reason=${JSON.stringify(e.reason)}`)).toEqual([]);
  });

  it('file은 frontend/ 기준 상대경로이고 실재한다', async () => {
    const { existsSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const bad = COLOR_EXCEPTIONS.filter(
      (e) => e.file.startsWith('/') || e.file.startsWith('frontend/') || !existsSync(resolve(here, '..', e.file)),
    );
    expect(bad.map((e) => e.file)).toEqual([]);
  });

  it('CSS/SCSS 항목은 selector가 문자열, 비-CSS 항목은 selector가 null이다', () => {
    const bad = COLOR_EXCEPTIONS.filter((e) => {
      const isCss = e.file.endsWith('.scss') || e.file.endsWith('.css');
      return isCss ? typeof e.selector !== 'string' || !e.selector : e.selector !== null;
    });
    expect(bad.map((e) => `${e.file}: selector=${JSON.stringify(e.selector)}`)).toEqual([]);
  });

  it('중복 튜플은 허용되며, 그 개수가 곧 소비 예산이다', () => {
    // ⚠️ 교차 계약 D2. 유일성을 단정하지 **않는다**.
    // S9의 literalColorSweep은 consume-once 매칭이다 — 같은 (file, selector, prop, value)가
    // 소스에 N번 나오면 레지스트리에도 N개 있어야 한다. 유일성을 강제하면 S9가 RED가 된다.
    // 이 테스트는 "중복이 있어도 통과"를 명시적으로 고정해 다음 사람이 유일성 단정을 되살리지 못하게 한다.
    const budget = new Map();
    for (const e of COLOR_EXCEPTIONS) {
      const k = JSON.stringify([e.file, e.selector, e.prop, e.value]);
      budget.set(k, (budget.get(k) || 0) + 1);
    }
    expect([...budget.values()].reduce((a, b) => a + b, 0)).toBe(COLOR_EXCEPTIONS.length);
    expect([...budget.values()].every((n) => n >= 1)).toBe(true);
  });
});

describe('colorExceptions — findException 조회', () => {
  it('등록되지 않은 튜플은 undefined를 돌려준다', () => {
    expect(findException('styles/__nope__.scss', '.X', 'color', '#ABCDEF')).toBeUndefined();
  });

  it('등록된 튜플은 그 항목을 돌려준다 (합성 항목으로 조회 규약만 검증)', () => {
    const probe = COLOR_EXCEPTIONS[0];
    if (!probe) return;   // Task 1 시점엔 비어 있다 — Task 4 이후 실효
    expect(findException(probe.file, probe.selector, probe.prop, probe.value)).toBe(probe);
  });
});

// S7이 소유를 주장하는 파일과, 그 파일에서 S7이 **등록하지 않는** hit의 판별식.
// CanvasEditorToolbar의 콜아웃 아이콘 4건은 S9 Task 7 소유다(§15-2 B6).
const S7_FILES = [
  'styles/components/common/storedColor.scss',
  'library/tiptapColorMap.js',
  'components/Canvas/CanvasEditorToolbar.js',
  'library/colorContrast.js',
  'library/entityTint.js',
];
// S9 Task 7로 넘긴 **정확한 네 튜플**. 각 튜플을 최대 1회만 면제한다(consume-once).
// ⛔ `selector !== null`을 통째로 제외하지 마라 — 새 인라인 색이나 같은 색의 추가 출현이
//    조용히 함께 빠져나간다(실측: `#ABCDEF` 프로브를 넣어 hit이 30→31이 돼도 게이트는 over=0).
const TOOLBAR = 'components/Canvas/CanvasEditorToolbar.js';
const S9_DEFERRED = ['#2563EB', '#D97706', '#16A34A', '#DC2626'].map((value) => ({
  file: TOOLBAR, selector: '[style]', prop: 'color', value,
}));
const tupleKey = (h) => `${h.file}|${h.selector ?? '-'}|${h.prop ?? '-'}|${h.value}`;

// hits를 (S7이 등록할 것, S9로 넘긴 것)으로 가른다. 면제 예산은 튜플당 1회뿐이다.
function partitionS7(hits) {
  const budget = new Map();
  for (const d of S9_DEFERRED) budget.set(tupleKey(d), (budget.get(tupleKey(d)) || 0) + 1);
  const s7 = [];
  const deferred = [];
  for (const h of hits) {
    const k = tupleKey(h);
    if ((budget.get(k) || 0) > 0) { budget.set(k, budget.get(k) - 1); deferred.push(h); }
    else s7.push(h);
  }
  return { s7, deferred, unusedBudget: [...budget].filter(([, n]) => n > 0).map(([k]) => k) };
}

// ⚠️ key에 category를 **포함**한다. (file, selector, prop, value)만 보면 분류를 바꿔도
//    GREEN이라 "근거를 구분한다"는 계약이 기계로 지켜지지 않는다.
const key = (e) => `${e.file}|${e.selector ?? '-'}|${e.prop ?? '-'}|${e.value}|${e.category}`;
const bag = (arr) => arr.reduce((m, e) => m.set(key(e), (m.get(key(e)) || 0) + 1), new Map());

// 파일/역할별 기대 분류 — Step 4a의 분류 규칙과 같은 정본이다.
const LIGHT_PALETTE = new Set([...TEXT_COLORS, ...HIGHLIGHT_COLORS, ...CELL_BG_COLORS]);
const expectedCategory = (h) => {
  if (h.file === 'styles/components/common/storedColor.scss') return 'stored-color';
  if (h.file === 'library/colorContrast.js') return 'fixed-on-color';
  if (h.file === 'library/entityTint.js') return 'palette-source';
  if (h.file === 'components/Canvas/CanvasEditorToolbar.js') return 'palette-source';
  // tiptapColorMap.js — 라이트 팔레트 리터럴과 TEXT_INK_BASE는 원천, 산출값은 저장색 대응
  if (h.prop === 'TEXT_INK_BASE') return 'palette-source';
  return LIGHT_PALETTE.has(h.value.toUpperCase()) ? 'palette-source' : 'stored-color';
};
const CATEGORY_TOTALS = { 'stored-color': 86, 'palette-source': 85, 'fixed-on-color': 4 };

describe('S7 예외가 스윕 hit와 정확히 일치한다', () => {
  const hits = S7_FILES.flatMap((rel) =>
    partitionS7(hitsFor(rel, readFileSync(resolve(ROOT, rel), 'utf8'))).s7);
  const registered = COLOR_EXCEPTIONS.filter((e) => S7_FILES.includes(e.file));

  it('hit multiset === 등록 multiset — 누락 0 · 잉여 0 · multiplicity 차 0 · category exact', () => {
    const H = bag(hits.map((h) => ({ ...h, category: expectedCategory(h) })));
    const R = bag(registered);
    const missing = [...H].filter(([k, n]) => (R.get(k) || 0) < n)
      .map(([k, n]) => `${k}  (hit ${n} > 등록 ${R.get(k) || 0})`);
    const extra = [...R].filter(([k, n]) => (H.get(k) || 0) < n)
      .map(([k, n]) => `${k}  (등록 ${n} > hit ${H.get(k) || 0})`);
    expect(missing, '미등록 hit').toEqual([]);
    expect(extra, '죽은 예외').toEqual([]);
    expect(registered).toHaveLength(hits.length);   // multiplicity 총합까지 일치
  });

  it.each(S7_FILES)('%s: over === [] · dead === []', (rel) => {
    const r = sweepFile(rel, readFileSync(resolve(ROOT, rel), 'utf8'));
    const over = rel === TOOLBAR
      ? partitionS7(r.overHits).s7.map((h) => `${h.file}:${h.line} | ${h.value}`)   // 콜아웃 4건만 S9 몫
      : r.over;
    expect(over).toEqual([]);
    expect(r.dead).toEqual([]);
  });

  it('category 분포가 정본과 exact다', () => {
    const dist = registered.reduce((m, e) => ({ ...m, [e.category]: (m[e.category] || 0) + 1 }), {});
    expect(dist).toEqual(CATEGORY_TOTALS);          // stored-color 86 · palette-source 85 · fixed-on-color 4
    // palette-source 75 → 79: entityTint.js 표면 프로파일이 2값 → 6출현으로 늘었다(2026-08-31 blocker correction).
    // palette-source 79 → 85: surface-overlay·track-header·task-list-raised 3프로파일 6출현 추가
    //   (2026-08-31 최종 surface correction — 팝업 idle·헤더 그라데이션 하단·선택/하위 행).
    expect(registered).toHaveLength(175);   // 169 → 175: 위 palette-source 증가분
  });

  it('스윕이 읽는 단일 export에 S7 항목이 들어 있다', () => {
    // 별도 배열만 export하고 COLOR_EXCEPTIONS에 합치지 않으면 여기서 0이 된다
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.some((e) => e.category === 'stored-color')).toBe(true);
    expect(registered.some((e) => e.category === 'palette-source')).toBe(true);
    expect(registered.some((e) => e.category === 'fixed-on-color')).toBe(true);
    expect(COLOR_EXCEPTIONS.some((e) => e.category === 'theme-dependent')).toBe(false);
  });
});

describe('S9 이관 4건은 consume-once로만 면제된다', () => {
  const toolbarSrc = readFileSync(resolve(ROOT, TOOLBAR), 'utf8');
  const bag = (arr) => arr.reduce((m, e) => m.set(tupleKey(e), (m.get(tupleKey(e)) || 0) + 1), new Map());
  // 변형된 소스에서 "등록되지 않은 S7 hit"을 센다. 제품 파일은 디스크에서 건드리지 않는다.
  const unregisteredS7 = (src) => {
    const { s7 } = partitionS7(hitsFor(TOOLBAR, src));
    const R = bag(COLOR_EXCEPTIONS.filter((e) => e.file === TOOLBAR));
    const H = bag(s7);
    return [...H].filter(([k, n]) => (R.get(k) || 0) < n).map(([k, n]) => `${k} (hit ${n} > 등록 ${R.get(k) || 0})`);
  };

  it('현재 deferred multiset이 정확히 그 네 튜플이다', () => {
    const { deferred, unusedBudget } = partitionS7(hitsFor(TOOLBAR, toolbarSrc));
    expect(deferred).toHaveLength(4);
    expect([...bag(deferred).keys()].sort()).toEqual([...bag(S9_DEFERRED).keys()].sort());
    expect(unusedBudget, '쓰이지 않은 면제 예산 — 이관 목록이 실제와 다르다').toEqual([]);
  });

  it('S9 이관 4건은 colorExceptions.js에 등록하지 않는다', () => {
    for (const d of S9_DEFERRED) {
      expect(COLOR_EXCEPTIONS.some((e) => tupleKey(e) === tupleKey(d)), `${d.value}가 등록돼 있다`).toBe(false);
    }
  });

  it('현재 소스는 미등록 S7 hit이 0건이다 (대조군)', () => {
    expect(unregisteredS7(toolbarSrc)).toEqual([]);
  });

  it('새 인라인 색(#ABCDEF)을 추가하면 RED다', () => {
    const mutated = `${toolbarSrc}\nconst __probe = <i style={{ color: '#ABCDEF' }} />;\n`;
    expect(mutated).not.toBe(toolbarSrc);
    const { deferred } = partitionS7(hitsFor(TOOLBAR, mutated));
    expect(deferred).toHaveLength(4);                       // 면제는 여전히 네 건뿐이다
    expect(unregisteredS7(mutated)).toHaveLength(1);        // 새 색이 그대로 드러난다
    expect(unregisteredS7(mutated)[0]).toContain('#ABCDEF');
  });

  it('기존 네 색 중 하나를 한 번 더 추가하면 그 추가 출현이 RED다', () => {
    const mutated = `${toolbarSrc}\nconst __dup = <i style={{ color: '#DC2626' }} />;\n`;
    expect(mutated).not.toBe(toolbarSrc);
    const { deferred } = partitionS7(hitsFor(TOOLBAR, mutated));
    expect(deferred).toHaveLength(4);                       // 예산은 튜플당 1회 — 두 번째는 못 빠져나간다
    const missing = unregisteredS7(mutated);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('#DC2626');
    expect(missing[0]).toContain('[style]');
  });
});
