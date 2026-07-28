// frontend/library/s4PixelDiff.mjs (커밋)
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { LIGHT_DIFF_MASKS } from './s4Spec.mjs';
export { LIGHT_DIFF_MASKS } from './s4Spec.mjs';   // 단일 원천은 s4Spec — 여기서 재정의하지 않는다
export function fillRects(png, rects, scale = 1) {   // 양쪽 이미지 동일 좌표를 단색으로 덮는다
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x * scale)), y0 = Math.max(0, Math.floor(r.y * scale));
    const x1 = Math.min(png.width, Math.ceil((r.x + r.width) * scale));
    const y1 = Math.min(png.height, Math.ceil((r.y + r.height) * scale));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (png.width * y + x) << 2;
      png.data[i] = 0; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255;
    }
  }
  return png;
}
export function diffPng(baseBuf, afterBuf, rects, scale = 1) {
  const a = PNG.sync.read(baseBuf), b = PNG.sync.read(afterBuf);
  if (a.width !== b.width || a.height !== b.height)
    return { ok: false, reason: `SIZE ${a.width}x${a.height} vs ${b.width}x${b.height}`, diff: -1 };
  fillRects(a, rects, scale); fillRects(b, rects, scale);
  const out = new PNG({ width: a.width, height: a.height });
  const diff = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0, includeAA: true });
  return { ok: diff === 0, diff, png: out };
}
