import { describe, it, expect } from 'vitest';
import { clampScale, getOneToOneScale, zoomAtPoint } from './lightboxZoom.js';

describe('clampScale', () => {
  it('min/max 범위로 제한', () => {
    expect(clampScale(0.2, 1, 8)).toBe(1);
    expect(clampScale(20, 1, 8)).toBe(8);
    expect(clampScale(3, 1, 8)).toBe(3);
  });
});

describe('getOneToOneScale', () => {
  it('자연 너비 / fit 너비', () => {
    expect(getOneToOneScale(800, 400)).toBe(2);
  });
  it('fit 너비 0이면 1', () => {
    expect(getOneToOneScale(800, 0)).toBe(1);
  });
});

describe('zoomAtPoint', () => {
  it('중심(0,0)에서 줌하면 팬 변화 없음', () => {
    const out = zoomAtPoint({ scale: 1, tx: 0, ty: 0 }, 2, { x: 0, y: 0 });
    expect(out).toEqual({ scale: 2, tx: 0, ty: 0 });
  });
  it('포인터 아래 지점이 고정되도록 팬 보정', () => {
    const out = zoomAtPoint({ scale: 1, tx: 0, ty: 0 }, 2, { x: 100, y: 0 });
    expect(out.scale).toBe(2);
    expect(out.tx).toBe(-100);
    expect(out.ty).toBe(0);
  });
});
