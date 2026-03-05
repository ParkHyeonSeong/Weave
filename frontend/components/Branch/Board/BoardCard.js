import TaskTypeIcon from '@/components/common/TaskTypeIcon';

export default function BoardCard({ task, taskTypes, onClick }) {
  const typeConfig = (taskTypes || []).find((t) => t.type_key === task.task_type);

  const handleDragStart = (e) => {
    e.dataTransfer.setData('text/plain', String(task.task_id));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className="BoardCard"
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
    >
      <div className="BoardCard__Top">
        <span className="BoardCard__TypeIcon">
          <TaskTypeIcon
            name={typeConfig?.icon || 'CheckSquare'}
            size={13}
            color={typeConfig?.color || '#5E6AD2'}
          />
        </span>
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
