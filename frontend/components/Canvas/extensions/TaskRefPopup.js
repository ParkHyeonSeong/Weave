import { useState, useEffect, useRef } from 'react';
import { Search, ListTodo } from 'lucide-react';
import { axios } from '@/library/_axios';

const formatStatusKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function TaskRefPopup({ mode, onSelect, onClose, onDismiss, onBack }) {
  const [keyword, setKeyword] = useState('');
  const [tasks, setTasks] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  const doneRef = useRef(false); // 선택/닫기 확정 후의 blur는 무시

  // ReactRenderer(flushSync)가 mount 효과를 element가 DOM에 붙기 전에 돌리므로
  // 한 프레임 미뤄야 자동 포커스가 실제로 적용된다
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

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

  const finish = (fn) => { doneRef.current = true; fn(); };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, tasks.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (tasks[activeIdx]) finish(() => onSelect(tasks[activeIdx]));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(onClose);
    } else if (e.key === 'Backspace' && keyword === '') {
      // 빈 검색창에서 한 번 더 지우면 커맨드 메뉴로 복귀
      e.preventDefault();
      finish(onBack);
    }
  };

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
          onBlur={() => { if (!doneRef.current) onDismiss(); }}
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
