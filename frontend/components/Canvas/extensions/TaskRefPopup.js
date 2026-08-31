import { Search, ListTodo } from 'lucide-react';
import { useRefSearchPopup } from './useRefSearchPopup';
import { entityTintStyle } from '@/library/entityTint';

const formatStatusKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function TaskRefPopup({ mode, onSelect, onClose, onDismiss, onBack }) {
  const {
    keyword, setKeyword, items: tasks, activeIdx, setActiveIdx, loading,
    inputRef, listRef, finish, handleKeyDown, handleBlur,
  } = useRefSearchPopup({
    url: '/chat/task-search',
    params: { mode: mode || 'my' },
    pickItems: (data) => data.tasks,
    onSelect, onClose, onDismiss, onBack,
  });

  return (
    <div className="TaskRefPopup">
      <div className="TaskRefPopup__Header">
        <Search size={12} />
        {mode === 'my' ? '/t - My Tasks' : '/ta - All Tasks'}
      </div>
      <div className="TaskRefPopup__Search">
        <input
          ref={inputRef}
          value={keyword}
          placeholder="태스크 검색…"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      </div>
      <ul className="TaskRefPopup__List" ref={listRef}>
        {loading && <li className="TaskRefPopup__Empty">Searching...</li>}
        {!loading && tasks.length === 0 && (
          <li className="TaskRefPopup__Empty">No tasks found</li>
        )}
        {!loading && tasks.map((task, idx) => (
          <li
            key={task.task_id}
            className={`TaskRefPopup__Item ${idx === activeIdx ? 'TaskRefPopup__Item--active' : ''}`}
            onClick={() => finish(() => onSelect(task))}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <ListTodo size={12} className="TaskRefPopup__ItemIcon" />
            <span className="TaskRefPopup__ItemId">{task.display_id}</span>
            <span className="TaskRefPopup__ItemTitle">{task.title}</span>
            {(() => {
              // 저장색이 없거나 지원 밖이면 EntityTint 없이 category 클래스가 배경·글자색을 준다.
              const tint = entityTintStyle(task.status_color, { alpha: '20' });
              return (
                <span
                  className={`TaskRefPopup__ItemStatus TaskRefPopup__ItemStatus--${task.status_category || task.status}${tint?.['--et-on'] ? ' EntityTint' : ''}`}
                  style={tint}
                >
                  {task.status_label || formatStatusKey(task.status)}
                </span>
              );
            })()}
          </li>
        ))}
      </ul>
    </div>
  );
}
