import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { Search, GitBranch, LogOut, Plus } from 'lucide-react';

const ACTIONS = [
  { id: 'create-branch', label: 'Create Branch', icon: Plus, group: 'Actions' },
  { id: 'go-branch', label: 'Go to Branch...', icon: GitBranch, group: 'Navigation' },
  { id: 'logout', label: 'Logout', icon: LogOut, group: 'Account' },
];

export default function CommandPalette({ onClose }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // 필터링된 액션
  const filtered = ACTIONS.filter((a) =>
    a.label.toLowerCase().includes(query.toLowerCase())
  );

  // 마운트 시 인풋 포커스
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 키보드 네비게이션
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      executeAction(filtered[activeIndex]);
    }
  };

  const executeAction = (action) => {
    switch (action.id) {
      case 'create-branch':
        onClose();
        // Layout에서 CreateBranch 모달을 여는 이벤트
        window.dispatchEvent(new Event('palette:create-branch'));
        break;
      case 'go-branch':
        // TODO: Branch 선택 UI
        onClose();
        break;
      case 'logout':
        sessionStorage.removeItem('x_token');
        sessionStorage.removeItem('profile');
        router.replace('/auth/login');
        onClose();
        break;
    }
  };

  // 그룹별로 묶기
  const groups = {};
  filtered.forEach((action) => {
    if (!groups[action.group]) groups[action.group] = [];
    groups[action.group].push(action);
  });

  let itemIndex = 0;

  return (
    <div className="CommandPalette__Backdrop" onClick={onClose}>
      <div className="CommandPalette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="CommandPalette__InputWrap">
          <Search size={16} className="CommandPalette__SearchIcon" />
          <input
            ref={inputRef}
            className="CommandPalette__Input"
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
          />
          <kbd className="CommandPalette__Shortcut">ESC</kbd>
        </div>

        <div className="CommandPalette__List">
          {filtered.length === 0 ? (
            <div className="CommandPalette__Empty">No results found.</div>
          ) : (
            Object.entries(groups).map(([group, actions]) => (
              <div key={group} className="CommandPalette__Group">
                <div className="CommandPalette__GroupLabel">{group}</div>
                {actions.map((action) => {
                  const Icon = action.icon;
                  const idx = itemIndex++;
                  return (
                    <button
                      key={action.id}
                      className={`CommandPalette__Item ${idx === activeIndex ? 'CommandPalette__Item--active' : ''}`}
                      onClick={() => executeAction(action)}
                      onMouseEnter={() => setActiveIndex(idx)}
                    >
                      <Icon size={16} className="CommandPalette__ItemIcon" />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
