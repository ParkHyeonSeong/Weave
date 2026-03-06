import { useRouter } from 'next/router';
import { X, ListTodo } from 'lucide-react';

const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export default function TaskRefCard({ taskRef, removable, onRemove }) {
  const router = useRouter();
  if (!taskRef) return null;

  // 태스크 클릭 -> 해당 branch 상세로 이동
  const handleClick = () => {
    if (removable || !taskRef.branch_id) return;
    router.push(`/branch/${taskRef.branch_id}?task=${taskRef.task_id}`);
  };

  return (
    <div
      className={`TaskRefCard ${!removable && taskRef.branch_id ? 'TaskRefCard--clickable' : ''}`}
      onClick={handleClick}
    >
      <div className="TaskRefCard__Header">
        <ListTodo size={12} className="TaskRefCard__Icon" />
        <span className="TaskRefCard__DisplayId">{taskRef.display_id}</span>
        <span className={`TaskRefCard__Priority TaskRefCard__Priority--${taskRef.priority}`}>
          {PRIORITY_LABELS[taskRef.priority] || taskRef.priority}
        </span>
        {removable && (
          <button className="TaskRefCard__Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="TaskRefCard__Title">{taskRef.title}</div>
      <div className="TaskRefCard__Footer">
        <span className={`TaskRefCard__Status TaskRefCard__Status--${taskRef.status}`}>
          {STATUS_LABELS[taskRef.status] || taskRef.status}
        </span>
        {taskRef.assignee_name && (
          <span className="TaskRefCard__Assignee">{taskRef.assignee_name}</span>
        )}
      </div>
    </div>
  );
}
