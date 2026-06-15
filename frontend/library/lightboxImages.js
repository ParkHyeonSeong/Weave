// 읽기전용 sanitized-HTML 컨테이너 7종 — 위임 핸들러가 이 안의 <img>만 라이트박스 대상으로 본다.
// ⚠️ 이 목록을 바꾸면 styles/components/common/lightbox.scss의 cursor:zoom-in 선택자도 함께 갱신할 것.
export const READONLY_CONTAINERS = [
  '.CanvasPageView__Content',
  '.TaskDescReadonly',
  '.CommentItem__Content',
  '.RefPreviewPanel__HtmlContent',
  '.AnnotationSidebar__ReplyContent',
  '.CanvasOverview__OverviewContent',
  '.TrackDetail__Description',
].join(', ');

// 콘텐츠 이미지에서 제외할 비-콘텐츠 이미지(아바타/아이콘/북마크 카드 이미지)
export const EXCLUDE_IMG_SELECTOR =
  '.Avatar__Img, .EntityIcon img, .bookmark-card__favicon, .bookmark-card__image';

// 다운로드용 파일명 추출: src basename(쿼리 제거) 우선, 확장자 없으면 alt, 둘 다 없으면 'image'
export function deriveFilename(src, alt) {
  if (src) {
    try {
      const path = src.split('?')[0].split('#')[0];
      const base = path.substring(path.lastIndexOf('/') + 1);
      if (base && base.includes('.')) return base;
    } catch {
      // ignore — fall through to alt
    }
  }
  const cleanAlt = (alt || '').trim();
  if (cleanAlt) return cleanAlt;
  return 'image';
}

// <img>가 라이트박스로 열 콘텐츠 이미지인지 판정.
// 편집중 영역/TipTap 노드뷰/아바타·아이콘·북마크는 제외.
export function isContentImage(img) {
  if (!img || img.tagName !== 'IMG') return false;
  if (img.closest('[contenteditable="true"]')) return false;
  if (img.closest('.ResizableImage')) return false;
  if (img.matches(EXCLUDE_IMG_SELECTOR)) return false;
  return true;
}

// 컨테이너 안의 콘텐츠 이미지를 순서대로 모아 갤러리 배열과 클릭 인덱스를 만든다.
export function collectGallery(container, clickedImg) {
  const all = Array.from(container.querySelectorAll('img')).filter(isContentImage);
  const images = all.map((el) => {
    const src = el.getAttribute('src') || '';
    const alt = el.getAttribute('alt') || '';
    return { src, alt, filename: deriveFilename(src, alt) };
  });
  const i = all.indexOf(clickedImg);
  return { images, index: i >= 0 ? i : 0 };
}
