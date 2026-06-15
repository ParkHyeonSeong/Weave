import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import Lightbox from './Lightbox';
import { isContentImage, collectGallery, READONLY_CONTAINERS } from '@/library/lightboxImages';

const LightboxContext = createContext(null);

export function useLightbox() {
  const ctx = useContext(LightboxContext);
  // Provider 밖에서도 호출이 깨지지 않도록 no-op 폴백
  return ctx || { open: () => {}, close: () => {} };
}

export default function LightboxProvider({ children }) {
  const [state, setState] = useState(null); // { images, index } | null

  const open = useCallback((images, index = 0) => {
    if (images && images.length) setState({ images, index });
  }, []);
  const close = useCallback(() => setState(null), []);
  const setIndex = useCallback((i) => setState((s) => (s ? { ...s, index: i } : s)), []);

  // 읽기전용 sanitized-HTML 표면을 한 핸들러로 일괄 처리(앱 생애주기 동안 단일 리스너)
  useEffect(() => {
    const onClick = (e) => {
      const img = e.target.closest?.('img');
      if (!img) return;
      // 컨테이너(7종)가 가장 좁은 필터 — 먼저 걸러 비-콘텐츠 img 클릭의 불필요한 tree-walk를 줄인다.
      const container = img.closest(READONLY_CONTAINERS);
      if (!container || !isContentImage(img)) return;
      const { images, index } = collectGallery(container, img);
      if (!images.length) return;
      e.preventDefault();
      open(images, index);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  return (
    <LightboxContext.Provider value={{ open, close }}>
      {children}
      {state && (
        <Lightbox
          images={state.images}
          index={state.index}
          onClose={close}
          onIndexChange={setIndex}
        />
      )}
    </LightboxContext.Provider>
  );
}
