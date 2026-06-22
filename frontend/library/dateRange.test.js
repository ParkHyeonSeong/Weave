import { describe, it, expect } from 'vitest';
import { isOutOfRange } from './dateRange.js';

describe('isOutOfRange', () => {
  it('경계 없음 → false', () => expect(isOutOfRange('2026-06-20', null, null)).toBe(false));
  it('min 미만 → true', () => expect(isOutOfRange('2026-06-19', '2026-06-20', null)).toBe(true));
  it('min과 같음 → false', () => expect(isOutOfRange('2026-06-20', '2026-06-20', null)).toBe(false));
  it('max 초과 → true', () => expect(isOutOfRange('2026-06-21', null, '2026-06-20')).toBe(true));
  it('max와 같음 → false', () => expect(isOutOfRange('2026-06-20', null, '2026-06-20')).toBe(false));
  it('시간 포함 ISO 경계 정규화', () =>
    expect(isOutOfRange('2026-06-20', null, '2026-06-20T00:00:00Z')).toBe(false));
});
