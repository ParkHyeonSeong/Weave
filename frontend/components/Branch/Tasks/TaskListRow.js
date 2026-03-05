import { CheckSquare, Bug, BookOpen } from 'lucide-react';

const typeIcons = {
  task: CheckSquare,
  bug: Bug,
  story: BookOpen,
};

const statusLabels = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

const priorityColors = {
  urgent: '#DC2626',
  high: '#F59E0B',
  medium: '#5E6AD2',
  low: '#9CA3AF',
};

export default function TaskListRow({ task, onClick }) {
  const TypeIcon = typeIcons[task.task_type] || CheckSquare;

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      month: '2-digit', day: '2-digit',
    });
  };

  return (
    <div className="TaskListRow" onClick={onClick}>
      {/* 타입 아이콘 */}
      <TypeIcon
        size={14}
        className="TaskListRow__TypeIcon"
        style={{ color: task.task_type === 'bug' ? '#DC2626' : '#5E6AD2' }}
      />

      {/* Display ID */}
      <span className="TaskListRow__Id">{task.display_id}</span>

      {/* 제목 */}
      <span className="TaskListRow__Title">{task.title}</span>

      {/* 라벨 */}
      <div className="TaskListRow__Labels">
        {(task.labels || []).map((label) => (
          <span
            key={label.label_id}
            className="TaskListRow__Label"
            style={{ backgroundColor: label.color + '20', color: label.color }}
          >
            {label.label_name}
          </span>
        ))}
      </div>

      {/* 상태 */}
      <span className={`TaskListRow__Status TaskListRow__Status--${task.status}`}>
        {statusLabels[task.status] || task.status}
      </span>

      {/* 우선순위 */}
      <span
        className="TaskListRow__Priority"
        style={{ color: priorityColors[task.priority] }}
        title={task.priority}
      >
        {task.priority === 'urgent' ? '!!!' : task.priority === 'high' ? '!!' : task.priority === 'medium' ? '!' : ''}
      </span>

      {/* 담당자 */}
      {task.assignee_name && (
        <span className="TaskListRow__Assignee" title={task.assignee_name}>
          {task.assignee_name.charAt(0).toUpperCase()}
        </span>
      )}

      {/* 마감일 */}
      {task.due_date && (
        <span className="TaskListRow__DueDate">{formatDate(task.due_date)}</span>
      )}
    </div>
  );
}
