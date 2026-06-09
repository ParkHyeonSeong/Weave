import { useState, useEffect, useRef } from 'react';
import { MoreHorizontal, EyeOff } from 'lucide-react';

/** 사이드바 아이템 호버 시 나오는 ⋯ 메뉴. 현재는 "숨기기"만(확장 슬롯).
 *  버튼/메뉴는 기존 사이드바 클래스(BranchAddBtn/AddMenu)를 재사용한다. */
export default function SidebarItemActions({ onHide }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="Sidebar__ItemActions" ref={ref}>
      <button
        className="Sidebar__BranchAddBtn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="더보기"
        aria-label="더보기"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="Sidebar__AddMenu">
          <button
            className="Sidebar__AddMenuItem"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onHide(); }}
          >
            <EyeOff size={13} /> 숨기기
          </button>
        </div>
      )}
    </div>
  );
}
