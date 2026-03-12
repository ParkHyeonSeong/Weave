import { useState, useCallback, useRef } from 'react';

export default function usePictureInPicture() {
  const [portalContainer, setPortalContainer] = useState(null);
  const pipWindowRef = useRef(null);

  const isSupported = typeof window !== 'undefined'
    && 'documentPictureInPicture' in window;

  const openPip = useCallback(async ({ width = 380, height = 560 } = {}) => {
    if (!isSupported) return;

    const pip = await documentPictureInPicture.requestWindow({ width, height });
    pipWindowRef.current = pip;

    // 스타일시트 복사
    [...document.querySelectorAll('link[rel="stylesheet"], style')].forEach(node => {
      pip.document.head.appendChild(node.cloneNode(true));
    });

    // 글로벌 리셋 (globals.scss가 PiP에서 제대로 적용 안 될 수 있으므로)
    const resetStyle = pip.document.createElement('style');
    resetStyle.textContent = `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { margin: 0; height: 100vh; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      button { cursor: pointer; border: none; background: none; font: inherit; color: inherit; }
      input, textarea { font: inherit; }
      #pip-root { height: 100%; }
    `;
    pip.document.head.appendChild(resetStyle);

    // createPortal 대상 컨테이너
    const container = pip.document.createElement('div');
    container.id = 'pip-root';
    pip.document.body.appendChild(container);

    // PiP 닫힐 때 정리
    pip.addEventListener('pagehide', () => {
      pipWindowRef.current = null;
      setPortalContainer(null);
    });

    // state로 컨테이너 설정 (리렌더 트리거)
    setPortalContainer(container);
  }, [isSupported]);

  const closePip = useCallback(() => {
    if (pipWindowRef.current) pipWindowRef.current.close();
  }, []);

  return {
    isSupported,
    isPipActive: !!portalContainer,
    portalContainer,
    openPip,
    closePip,
  };
}
