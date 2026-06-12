import { useState, useRef, useEffect } from 'react';

// 버튼(label) 클릭 시 아래에 팝오버를 여는 컴포넌트.
// children은 render-prop: (close) => ReactNode. 바깥 클릭/Esc로 닫힘.
export default function HomeMenu({ className = '', label, badge = null, align = 'left', children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="HomeMenu" ref={ref}>
      <button
        type="button"
        className={className}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {badge ? <span className="HomeMenu__Badge">{badge}</span> : null}
      </button>
      {open && (
        <div className={`HomeMenu__Pop HomeMenu__Pop--${align}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
