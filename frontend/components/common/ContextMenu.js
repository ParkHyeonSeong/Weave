import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// paint 전 위치 보정으로 열림 깜빡임 방지. 서버에선 useEffect로 폴백(SSR 경고 회피).
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const GROUP_ORDER = ['open', 'create', 'edit', 'organize', 'share', 'danger'];
const MENU_W = 212;

export default function ContextMenu({ open, x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 뷰포트 clamp (paint 전 실제 높이로 보정)
  useIsoLayoutEffect(() => {
    if (!open) return;
    const h = ref.current?.offsetHeight ?? 0;
    setPos({
      left: Math.min(x, window.innerWidth - MENU_W - 8),
      top: Math.min(y, window.innerHeight - h - 8),
    });
  }, [open, x, y]);

  // 외부클릭 / 스크롤 / Esc 닫기
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onScroll = () => onClose();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  // group 순서 정렬(미지정 group은 맨 뒤) + 그룹 경계 divider
  const rank = (g) => {
    const idx = GROUP_ORDER.indexOf(g);
    return idx === -1 ? GROUP_ORDER.length : idx;
  };
  const sorted = [...items].sort((a, b) => rank(a.group) - rank(b.group));

  return (
    <div ref={ref} className="ContextMenu" style={{ top: pos.top, left: pos.left }}>
      {sorted.map((item, i) => {
        const prev = sorted[i - 1];
        const divider = prev && prev.group !== item.group;
        const Icon = item.icon;
        return (
          <div key={item.id ?? i}>
            {divider && <div className="ContextMenu__Divider" />}
            <button
              className={`ContextMenu__Item ${item.variant === 'danger' ? 'ContextMenu__Item--danger' : ''}`}
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
                item.onSelect();
              }}
            >
              {Icon && <Icon size={15} />}
              <span>{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
