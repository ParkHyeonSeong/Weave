import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Search, ListTodo } from 'lucide-react';
import { axios } from '@/library/_axios';

const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

const TaskRefPopup = forwardRef(({ keyword, mode, onSelect, onClose }, ref) => {
  const [tasks, setTasks] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useImperativeHandle(ref, () => ({}));

  // 디바운스 검색
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get('/chat/task-search', {
          params: { q: keyword || '', mode: mode || 'my' },
        });
        if (res.data.status) {
          setTasks(res.data.tasks);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword, mode]);

  // 키보드 네비게이션
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => Math.min(prev + 1, tasks.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (tasks[activeIdx]) onSelect(tasks[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [tasks, activeIdx, onSelect, onClose]);

  return (
    <div className="TaskRefPopup">
      <div className="TaskRefPopup__Header">
        <Search size={12} />
        {mode === 'my' ? '/t - My Tasks' : '/ta - All Tasks'}
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
            onClick={() => onSelect(task)}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <ListTodo size={12} className="TaskRefPopup__ItemIcon" />
            <span className="TaskRefPopup__ItemId">{task.display_id}</span>
            <span className="TaskRefPopup__ItemTitle">{task.title}</span>
            <span className={`TaskRefPopup__ItemStatus TaskRefPopup__ItemStatus--${task.status}`}>
              {STATUS_LABELS[task.status] || task.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
});

TaskRefPopup.displayName = 'TaskRefPopup';

export default TaskRefPopup;
