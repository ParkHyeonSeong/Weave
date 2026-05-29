import { useState, useRef, useEffect } from 'react';
import { Plus, GitBranch, FileEdit, Workflow } from 'lucide-react';

const ITEMS = [
  { key: 'branch', label: '새 브랜치', event: 'layout:create-branch', Icon: GitBranch },
  { key: 'canvas', label: '새 캔버스', event: 'layout:create-canvas', Icon: FileEdit },
  { key: 'track',  label: '새 트랙',   event: 'layout:create-track',  Icon: Workflow },
];

export default function QuickCreate() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const create = (event) => { setOpen(false); window.dispatchEvent(new Event(event)); };

  return (
    <div className="QuickCreate" ref={ref}>
      <button className="QuickCreate__Btn" onClick={() => setOpen((p) => !p)}>
        <Plus size={16} /> 만들기
      </button>
      {open && (
        <div className="QuickCreate__Menu">
          {ITEMS.map((it) => {
            const Icon = it.Icon;
            return (
              <button key={it.key} className="QuickCreate__Item" onClick={() => create(it.event)}>
                <Icon size={15} /> {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
