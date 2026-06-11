import { useState, useEffect, useRef } from 'react';
import { axios } from '@/library/_axios';

// ref 검색 팝업(Task/Doc/Issue) 공용 동작 훅 — keyword·디바운스 검색·키보드·blur.
// 렌더(헤더/리스트 행)는 종류별 컴포넌트가 갖는다.
export function useRefSearchPopup({ url, params, pickItems, onSelect, onClose, onDismiss, onBack }) {
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  const doneRef = useRef(false); // 선택/닫기 확정 후의 blur는 무시

  // ReactRenderer(flushSync)가 popup DOM 부착 전에 mount effect를 동기 실행하므로
  // 한 프레임 뒤에 포커스해야 실제로 잡힌다
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // 디바운스 검색
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get(url, { params: { q: keyword || '', ...params } });
        if (res.data.status) {
          setItems(pickItems(res.data));
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, url, JSON.stringify(params)]);

  const finish = (fn) => { doneRef.current = true; fn(); };

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return; // 한글 조합 확정 Enter가 선택으로 새지 않게 (레포 컨벤션)
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[activeIdx]) finish(() => onSelect(items[activeIdx]));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(onClose);
    } else if (e.key === 'Backspace' && keyword === '') {
      // 빈 검색창에서 한 번 더 지우면 커맨드 메뉴로 복귀
      e.preventDefault();
      finish(onBack);
    }
  };

  const handleBlur = () => { if (!doneRef.current) onDismiss(); };

  return { keyword, setKeyword, items, activeIdx, setActiveIdx, loading, inputRef, finish, handleKeyDown, handleBlur };
}
