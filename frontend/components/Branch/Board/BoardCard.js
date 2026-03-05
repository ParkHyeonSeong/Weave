import { CheckSquare, Bug, BookOpen } from 'lucide-react';

const typeIcons = {
  task: CheckSquare,
  bug: Bug,
  story: BookOpen,
};

export default function BoardCard({ task, onClick }) {
  const TypeIcon = typeIcons[task.task_type] || CheckSquare;

  return (
    <div className="BoardCard" onClick={onClick}>
      <div className="BoardCard__Top">
        <TypeIcon
          size={13}
          className="BoardCard__TypeIcon"
          style={{ color: task.task_type === 'bug' ? '#DC2626' : '#5E6AD2' }}
        />
        <span className="BoardCard__Id">{task.display_id}</span>
      </div>

      <div className="BoardCard__Title">{task.title}</div>

      {/* 라벨 */}
      {task.labels && task.labels.length > 0 && (
        <div className="BoardCard__Labels">
          {task.labels.map((label) => (
            <span
              key={label.label_id}
              className="BoardCard__Label"
              style={{ backgroundColor: label.color + '20', color: label.color }}
            >
              {label.label_name}
            </span>
          ))}
        </div>
      )}

      {/* 하단: 담당자 */}
      {task.assignee_name && (
        <div className="BoardCard__Bottom">
          <span className="BoardCard__Assignee" title={task.assignee_name}>
            {task.assignee_name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
}
