// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadImage, copyImageToClipboard } from './lightboxIO.js';

beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

describe('downloadImage', () => {
  it('fetch 성공 시 blob anchor로 다운로드(true)', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const ok = await downloadImage('/api/uploads/canvas/c1_a.png', 'c1_a.png');
    expect(global.fetch).toHaveBeenCalledWith('/api/uploads/canvas/c1_a.png', { credentials: 'include' });
    expect(clickSpy).toHaveBeenCalled();
    expect(ok).toBe(true);
  });
  it('fetch 실패(CORS 등) 시 앵커 폴백(false)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('CORS'));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const ok = await downloadImage('https://x/og.png', 'og.png');
    expect(clickSpy).toHaveBeenCalled();
    expect(ok).toBe(false);
  });
});

describe('copyImageToClipboard', () => {
  it('png blob을 ClipboardItem으로 복사', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    global.ClipboardItem = class { constructor(items) { this.items = items; } };
    const write = vi.fn().mockResolvedValue(undefined);
    global.navigator.clipboard = { write };
    await copyImageToClipboard('/api/uploads/task/t1_a.png');
    expect(global.fetch).toHaveBeenCalledWith('/api/uploads/task/t1_a.png', { credentials: 'include' });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('fetch 404면 throw', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(copyImageToClipboard('/api/uploads/task/missing.png')).rejects.toThrow();
  });
});
