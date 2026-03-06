import { useState, useEffect, useRef } from 'react';
import { Search, ListTodo } from 'lucide-react';
import { axios } from '@/library/_axios';

const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export default function TaskSearchPopup({ keyword, mode, onSelect, onClose }) {
  const [tasks, setTasks] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  // 디바운스 검색
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get('/chat/task-search', {
          params: { q: keyword, mode },
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

  // 키보드 네비게이션 (부모 textarea에서 호출)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((prev) => Math.min(prev + 1, tasks.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (tasks[activeIdx]) onSelect(tasks[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tasks, activeIdx, onSelect, onClose]);

  return (
    <div className="TaskSearchPopup">
      <div className="TaskSearchPopup__Header">
        <Search size={12} />
        {mode === 'my' ? '/t - My Tasks' : '/ta - All Tasks'}
      </div>
      <ul className="TaskSearchPopup__List">
        {loading && <li className="TaskSearchPopup__Empty">Searching...</li>}
        {!loading && tasks.length === 0 && (
          <li className="TaskSearchPopup__Empty">No tasks found</li>
        )}
        {!loading && tasks.map((task, idx) => (
          <li
            key={task.task_id}
            className={`TaskSearchPopup__Item ${idx === activeIdx ? 'TaskSearchPopup__Item--active' : ''}`}
            onClick={() => onSelect(task)}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <ListTodo size={12} className="TaskSearchPopup__ItemIcon" />
            <span className="TaskSearchPopup__ItemId">{task.display_id}</span>
            <span className="TaskSearchPopup__ItemTitle">{task.title}</span>
            <span className={`TaskSearchPopup__ItemStatus TaskSearchPopup__ItemStatus--${task.status}`}>
              {STATUS_LABELS[task.status] || task.status}
            </span>
            {task.assignee_name && (
              <span className="TaskSearchPopup__ItemAssignee">{task.assignee_name}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
