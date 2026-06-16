import { X, ListTodo } from 'lucide-react';
import NavLink from '@/components/common/NavLink';

// snake_case key를 Title Case로 변환 (fallback용)
const formatStatusKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export default function TaskRefCard({ taskRef, removable, onRemove }) {
  if (!taskRef) return null;

  // 클릭 가능(전송된 메시지 안의 칩)일 때만 링크. compose 프리뷰(removable)는 Remove 버튼만 있고 이동 안 함.
  const navUrl = !removable && taskRef.branch_id
    ? `/branch/${taskRef.branch_id}/task/${taskRef.task_id}`
    : null;

  const content = (
    <>
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
        <span
          className={`TaskRefCard__Status TaskRefCard__Status--${taskRef.status_category || taskRef.status}`}
          style={taskRef.status_color ? { backgroundColor: `${taskRef.status_color}20`, color: taskRef.status_color } : undefined}
        >
          {taskRef.status_label || formatStatusKey(taskRef.status)}
        </span>
        {(() => {
          const main = (taskRef.assignees || []).find((a) => a.role === 'main');
          return main ? <span className="TaskRefCard__Assignee">{main.username}</span> : null;
        })()}
      </div>
    </>
  );

  if (navUrl) {
    return <NavLink className="TaskRefCard TaskRefCard--clickable" href={navUrl}>{content}</NavLink>;
  }
  return <div className="TaskRefCard">{content}</div>;
}
