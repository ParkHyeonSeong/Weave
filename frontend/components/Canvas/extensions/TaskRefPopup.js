import { Search, ListTodo } from 'lucide-react';
import { useRefSearchPopup } from './useRefSearchPopup';

const formatStatusKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function TaskRefPopup({ mode, onSelect, onClose, onDismiss, onBack }) {
  const {
    keyword, setKeyword, items: tasks, activeIdx, setActiveIdx, loading,
    inputRef, finish, handleKeyDown, handleBlur,
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
      <ul className="TaskRefPopup__List">
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
            <span
              className={`TaskRefPopup__ItemStatus TaskRefPopup__ItemStatus--${task.status_category || task.status}`}
              style={task.status_color ? { backgroundColor: `${task.status_color}20`, color: task.status_color } : undefined}
            >
              {task.status_label || formatStatusKey(task.status)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
