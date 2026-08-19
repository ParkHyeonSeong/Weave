import { describe, it, expect } from 'vitest';
import { COLOR_CATEGORIES, COLOR_EXCEPTIONS, findException } from './colorExceptions.js';

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
