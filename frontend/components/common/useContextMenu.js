import { useState, useCallback } from 'react';

// 우클릭/버튼 트리거 → 좌표 + items 저장. <ContextMenu {...props} /> 에 스프레드.
export default function useContextMenu() {
  const [state, setState] = useState(null); // { x, y, items } | null

  const open = useCallback((e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);

  const close = useCallback(() => setState(null), []);

  return {
    open,
    close,
    props: {
      open: !!state,
      x: state?.x ?? 0,
      y: state?.y ?? 0,
      items: state?.items ?? [],
      onClose: close,
    },
  };
}
