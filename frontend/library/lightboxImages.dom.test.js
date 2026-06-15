// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isContentImage, collectGallery } from './lightboxImages.js';

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

describe('isContentImage', () => {
  it('일반 콘텐츠 img는 true', () => {
    const c = el('<img src="/api/uploads/canvas/c1_a.png">');
    expect(isContentImage(c.querySelector('img'))).toBe(true);
  });
  it('아바타 이미지는 false', () => {
    const c = el('<img class="Avatar__Img" src="/api/uploads/avatars/u1.png">');
    expect(isContentImage(c.querySelector('img'))).toBe(false);
  });
  it('북마크 카드 이미지는 false', () => {
    const c = el('<img class="bookmark-card__image" src="https://x/og.png">');
    expect(isContentImage(c.querySelector('img'))).toBe(false);
  });
  it('편집중(contenteditable) 영역 img는 false', () => {
    const c = el('<div contenteditable="true"><img src="/api/uploads/task/t1_a.png"></div>');
    expect(isContentImage(c.querySelector('img'))).toBe(false);
  });
  it('TipTap ResizableImage 노드뷰 img는 false', () => {
    const c = el('<div class="ResizableImage"><div class="ResizableImage__Wrap"><img src="/x.png"></div></div>');
    expect(isContentImage(c.querySelector('img'))).toBe(false);
  });
  it('img가 아니면 false', () => {
    const c = el('<span>hi</span>');
    expect(isContentImage(c.querySelector('span'))).toBe(false);
    expect(isContentImage(null)).toBe(false);
  });
});

describe('collectGallery', () => {
  it('컨테이너 내 콘텐츠 img만 모으고 클릭 인덱스를 반환', () => {
    const c = el(
      '<div class="CanvasPageView__Content">' +
      '<img src="/api/uploads/canvas/c1_a.png" alt="A">' +
      '<img class="bookmark-card__image" src="https://x/og.png">' +
      '<img src="/api/uploads/canvas/c1_b.png" alt="B">' +
      '</div>'
    );
    const container = c.querySelector('.CanvasPageView__Content');
    const imgs = container.querySelectorAll('img');
    const clicked = imgs[2];
    const { images, index } = collectGallery(container, clicked);
    expect(images.map((i) => i.src)).toEqual([
      '/api/uploads/canvas/c1_a.png',
      '/api/uploads/canvas/c1_b.png',
    ]);
    expect(images[0].alt).toBe('A');
    expect(images[0].filename).toBe('c1_a.png');
    expect(index).toBe(1);
  });
  it('클릭 img가 목록에 없으면 index 0', () => {
    const c = el('<div class="CommentItem__Content"><img src="/api/uploads/task/t1_a.png"></div>');
    const container = c.querySelector('.CommentItem__Content');
    const { images, index } = collectGallery(container, null);
    expect(images).toHaveLength(1);
    expect(index).toBe(0);
  });
});
