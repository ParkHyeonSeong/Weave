import { CheckSquare } from 'lucide-react';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import Avatar from '@/components/common/Avatar';

export default function BoardCard({ task, taskTypes, onClick, onContextMenu }) {
  const typeConfig = (taskTypes || []).find((t) => t.type_key === task.task_type);

  const handleDragStart = (e) => {
    e.dataTransfer.setData('text/plain', String(task.task_id));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className="BoardCard"
      onClick={onClick}
      onContextMenu={onContextMenu}
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

      {task.subtask_progress?.total > 0 && (
        <div className="BoardCard__Progress">
          <CheckSquare size={12} className="BoardCard__ProgressIcon" />
          <span className="BoardCard__ProgressText">
            {task.subtask_progress.done}/{task.subtask_progress.total}
          </span>
          <span className="BoardCard__ProgressBar">
            <span
              className="BoardCard__ProgressFill"
              style={{
                width: `${task.subtask_progress.total
                  ? Math.round((task.subtask_progress.done / task.subtask_progress.total) * 100)
                  : 0}%`,
              }}
            />
          </span>
        </div>
      )}

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
      {(task.assignees || []).length > 0 && (() => {
        const mainAssignee = (task.assignees || []).find((a) => a.role === 'main');
        const subCount = (task.assignees || []).filter((a) => a.role === 'sub').length;
        return (
          <div className="BoardCard__Bottom">
            {mainAssignee && (
              <Avatar user={mainAssignee} size={22} />
            )}
            {subCount > 0 && (
              <span className="BoardCard__SubCount">+{subCount}</span>
            )}
          </div>
        );
      })()}
    </div>
  );
}
