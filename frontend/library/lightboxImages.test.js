import { describe, it, expect } from 'vitest';
import { deriveFilename } from './lightboxImages.js';

describe('deriveFilename', () => {
  it('서버 업로드 경로의 basename을 그대로 사용', () => {
    expect(deriveFilename('/api/uploads/canvas/c1_ab12cd34ef56.png', '')).toBe('c1_ab12cd34ef56.png');
  });
  it('쿼리스트링 제거 후 basename', () => {
    expect(deriveFilename('https://x.com/a/photo.jpg?w=100&h=50', '')).toBe('photo.jpg');
  });
  it('확장자 없는 src + alt 있으면 alt 기반 파일명', () => {
    expect(deriveFilename('/api/uploads/task/blob123', '스크린샷')).toBe('스크린샷');
  });
  it('확장자도 alt도 없으면 image 폴백', () => {
    expect(deriveFilename('/api/uploads/task/blob123', '')).toBe('image');
  });
  it('src가 비면 image 폴백', () => {
    expect(deriveFilename('', '')).toBe('image');
  });
});
