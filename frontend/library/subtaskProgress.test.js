import { describe, it, expect } from 'vitest';
import { progressLabel, progressPercent, isParentExpanded } from './subtaskProgress.js';

describe('progressLabel', () => {
  it('done/total 문자열', () => {
    expect(progressLabel({ done: 2, total: 5 })).toBe('2/5');
  });
  it('하위 없음(total 0) → 빈 문자열', () => {
    expect(progressLabel({ done: 0, total: 0 })).toBe('');
    expect(progressLabel(null)).toBe('');
    expect(progressLabel(undefined)).toBe('');
  });
});

describe('progressPercent', () => {
  it('반올림된 퍼센트', () => {
    expect(progressPercent({ done: 1, total: 3 })).toBe(33);
    expect(progressPercent({ done: 3, total: 4 })).toBe(75);
  });
  it('total 0 → 0 (0 나눗셈 방지)', () => {
    expect(progressPercent({ done: 0, total: 0 })).toBe(0);
    expect(progressPercent(null)).toBe(0);
  });
  it('0..100 클램프', () => {
    expect(progressPercent({ done: 5, total: 4 })).toBe(100);
  });
});

describe('isParentExpanded', () => {
  it('Set에 포함된 parent id만 true', () => {
    const s = new Set([10, 20]);
    expect(isParentExpanded(s, 10)).toBe(true);
    expect(isParentExpanded(s, 99)).toBe(false);
    expect(isParentExpanded(null, 10)).toBe(false);
  });
});
