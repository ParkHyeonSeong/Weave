import { describe, it, expect } from 'vitest';
import { sumChatUnread } from './chatUnread.js';

describe('sumChatUnread', () => {
  it('여러 방의 unread_count를 합산', () => {
    expect(sumChatUnread([{ unread_count: 2 }, { unread_count: 3 }])).toBe(5);
  });
  it('빈 배열 → 0', () => {
    expect(sumChatUnread([])).toBe(0);
  });
  it('null/undefined → 0', () => {
    expect(sumChatUnread(null)).toBe(0);
    expect(sumChatUnread(undefined)).toBe(0);
  });
  it('unread_count 누락 항목은 0으로 처리', () => {
    expect(sumChatUnread([{ unread_count: 4 }, {}, { unread_count: 1 }])).toBe(5);
  });
});
