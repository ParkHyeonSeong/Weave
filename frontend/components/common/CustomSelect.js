import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * CustomSelect - 네이티브 select 대체 커스텀 드롭다운
 *
 * @param {string|number|null} value - 현재 선택된 값
 * @param {Array<{value: string|number, label: string, icon?: React.Element, color?: string}>} options
 * @param {(value: string|number|null) => void} onChange
 * @param {string} [placeholder='Select...']
 * @param {string} [size='md'] - 'sm' | 'md'
 * @param {string} [className='']
 */
export default function CustomSelect({ value, options, onChange, placeholder = 'Select...', size = 'md', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // 외부 클릭 감지
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Escape 키
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const selected = options.find((o) => String(o.value) === String(value));

  const handleSelect = (opt) => {
    onChange(opt.value);
    setOpen(false);
  };

  const handleTriggerClick = (e) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  return (
    <div
      ref={ref}
      className={`CustomSelect CustomSelect--${size} ${open ? 'CustomSelect--open' : ''} ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 트리거 */}
      <button
        type="button"
        className="CustomSelect__Trigger"
        onClick={handleTriggerClick}
      >
        <span className="CustomSelect__Value">
          {selected ? (
            <>
              {selected.icon && <span className="CustomSelect__Icon">{selected.icon}</span>}
              {selected.color && (
                <span
                  className="CustomSelect__Dot"
                  style={{ backgroundColor: selected.color }}
                />
              )}
              <span>{selected.label}</span>
            </>
          ) : (
            <span className="CustomSelect__Placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={size === 'sm' ? 12 : 14} className="CustomSelect__Arrow" />
      </button>

      {/* 드롭다운 */}
      {open && (
        <div className="CustomSelect__Dropdown">
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              className={`CustomSelect__Option ${String(opt.value) === String(value) ? 'CustomSelect__Option--selected' : ''}`}
              onClick={() => handleSelect(opt)}
            >
              {opt.icon && <span className="CustomSelect__Icon">{opt.icon}</span>}
              {opt.color && (
                <span
                  className="CustomSelect__Dot"
                  style={{ backgroundColor: opt.color }}
                />
              )}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
