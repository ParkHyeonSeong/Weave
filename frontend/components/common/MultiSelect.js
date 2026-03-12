import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

/**
 * MultiSelect - 다중 선택 가능한 커스텀 드롭다운
 *
 * @param {Set} selectedValues - 현재 선택된 값들 (Set)
 * @param {Array<{value: string|number, label: string, icon?: React.Element, color?: string}>} options
 * @param {(value: string|number) => void} onToggle - 값 토글 핸들러
 * @param {string} label - 드롭다운 트리거 라벨 (예: "Priority")
 * @param {string} [className='']
 */
export default function MultiSelect({ selectedValues = new Set(), options, onToggle, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // 외부 클릭 감지
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const count = selectedValues.size;

  return (
    <div
      ref={ref}
      className={`MultiSelect ${open ? 'MultiSelect--open' : ''} ${count > 0 ? 'MultiSelect--active' : ''} ${className}`}
    >
      <button
        type="button"
        className="MultiSelect__Trigger"
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev); }}
      >
        <span className="MultiSelect__Label">{label}</span>
        {count > 0 && <span className="MultiSelect__Badge">{count}</span>}
        <ChevronDown size={12} className="MultiSelect__Arrow" />
      </button>

      {open && (
        <div className="MultiSelect__Dropdown">
          {options.map((opt) => {
            const isSelected = selectedValues.has(opt.value);
            return (
              <button
                key={String(opt.value)}
                type="button"
                className={`MultiSelect__Option ${isSelected ? 'MultiSelect__Option--selected' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggle(opt.value); }}
              >
                <span className={`MultiSelect__Check ${isSelected ? 'MultiSelect__Check--visible' : ''}`}>
                  <Check size={10} />
                </span>
                {opt.icon && <span className="MultiSelect__Icon">{opt.icon}</span>}
                {opt.color && (
                  <span className="MultiSelect__Dot" style={{ backgroundColor: opt.color }} />
                )}
                <span className="MultiSelect__OptionLabel">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
