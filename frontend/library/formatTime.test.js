import { describe, it, expect } from 'vitest';
import { formatSprintRange } from './formatTime.js';

describe('formatSprintRange', () => {
  it('both → YYYY.MM.DD – YYYY.MM.DD', () =>
    expect(formatSprintRange('2026-05-18', '2026-05-25')).toBe('2026.05.18 – 2026.05.25'));
  it('start only → "YYYY.MM.DD –"', () =>
    expect(formatSprintRange('2026-05-18', null)).toBe('2026.05.18 –'));
  it('end only → "– YYYY.MM.DD"', () =>
    expect(formatSprintRange(null, '2026-05-25')).toBe('– 2026.05.25'));
  it('neither → empty string', () =>
    expect(formatSprintRange(null, null)).toBe(''));
  it('datetime ISO → date prefix만 사용', () =>
    expect(formatSprintRange('2026-05-18T00:00:00Z', '2026-05-25T09:00:00Z')).toBe('2026.05.18 – 2026.05.25'));
});
