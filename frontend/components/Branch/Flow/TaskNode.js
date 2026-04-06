import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';

function TaskNode({ data }) {
  const { displayId, title, statusColor, statusLabel, taskType, dueDate, assignee } = data;

  return (
    <div className="TaskNode__Card">
      <Handle type="target" position={Position.Left} className="TaskNode__Handle" />
      <div className="TaskNode__Header">
        <TaskTypeIcon type={taskType} size={13} />
        <span className="TaskNode__DisplayId">{displayId}</span>
      </div>
      <div className="TaskNode__Title">{title}</div>
      <div className="TaskNode__Footer">
        <span className="TaskNode__StatusDot" style={{ backgroundColor: statusColor }} />
        <span className="TaskNode__StatusLabel">{statusLabel}</span>
        {(dueDate || assignee) && (
          <div className="TaskNode__FooterRight">
            {dueDate && (
              <span className="TaskNode__DueDate">
                {new Date(dueDate + 'T00:00:00').toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
              </span>
            )}
            {assignee && (
              <span className="TaskNode__Avatar" title={assignee.name}>
                {assignee.avatar_url
                  ? <img src={assignee.avatar_url} alt="" className="TaskNode__AvatarImg" />
                  : assignee.name?.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="TaskNode__Handle" />
    </div>
  );
}

export default memo(TaskNode);
