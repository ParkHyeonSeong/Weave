import { describe, it, expect } from 'vitest';
import { ddayBadge, fmtDate } from './dueBadge.js';

describe('ddayBadge', () => {
  const today = new Date('2026-06-19T09:00:00'); // 기준일 고정(결정적)
  it('마감 없음 → none/—', () => expect(ddayBadge(null, today)).toEqual({ cls: 'none', text: '—' }));
  it('오늘 → soon/D-day', () => expect(ddayBadge('2026-06-19', today)).toEqual({ cls: 'soon', text: 'D-day' }));
  it('1~2일 → soon', () => {
    expect(ddayBadge('2026-06-20', today)).toEqual({ cls: 'soon', text: 'D-1' });
    expect(ddayBadge('2026-06-21', today)).toEqual({ cls: 'soon', text: 'D-2' });
  });
  it('3일+ → calm (경계 D-3)', () => expect(ddayBadge('2026-06-22', today)).toEqual({ cls: 'calm', text: 'D-3' }));
  it('지남 → over/D+', () => expect(ddayBadge('2026-06-18', today)).toEqual({ cls: 'over', text: 'D+1' }));
});

describe('fmtDate', () => {
  it('M/D (요일)', () => expect(fmtDate('2026-06-19')).toBe('6/19 (금)'));
  it('null → 마감 없음', () => expect(fmtDate(null)).toBe('마감 없음'));
});
