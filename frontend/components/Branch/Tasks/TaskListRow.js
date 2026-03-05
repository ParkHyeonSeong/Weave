import { User } from 'lucide-react';
import { axios } from '@/library/_axios';
import CustomSelect from '@/components/common/CustomSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';

const priorityColors = {
  urgent: '#DC2626',
  high: '#F59E0B',
  medium: '#5E6AD2',
  low: '#9CA3AF',
};

export default function TaskListRow({ task, branchId, taskTypes, onClick }) {
  const typeConfig = (taskTypes || []).find((t) => t.type_key === task.task_type);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      month: '2-digit', day: '2-digit',
    });
  };

  // 상태 인라인 변경
  const handleStatusChange = async (newStatus) => {
    try {
      await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, { status: newStatus });
      window.dispatchEvent(new Event('task:updated'));
    } catch {}
  };

  return (
    <div className="TaskListRow" onClick={onClick}>
      {/* 타입 아이콘 */}
      <span className="TaskListRow__TypeIcon">
        <TaskTypeIcon
          name={typeConfig?.icon || 'CheckSquare'}
          size={14}
          color={typeConfig?.color || '#5E6AD2'}
        />
      </span>

      {/* Display ID */}
      <span className="TaskListRow__Id">{task.display_id}</span>

      {/* 제목 */}
      <span className="TaskListRow__Title">{task.title}</span>

      {/* 에픽 */}
      {task.epic_name && (
        <span
          className="TaskListRow__Epic"
          style={{ backgroundColor: (task.epic_color || '#5E6AD2') + '15', color: task.epic_color || '#5E6AD2' }}
        >
          {task.epic_name}
        </span>
      )}

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

      {/* 상태 (인라인 변경) */}
      <CustomSelect
        value={task.status}
        options={[
          { value: 'todo', label: 'To Do', color: '#9CA3AF' },
          { value: 'in_progress', label: 'In Progress', color: '#2563EB' },
          { value: 'done', label: 'Done', color: '#16A34A' },
        ]}
        onChange={handleStatusChange}
        size="sm"
        className={`TaskListRow__Status TaskListRow__Status--${task.status}`}
      />

      {/* 우선순위 */}
      <span
        className="TaskListRow__Priority"
        style={{ color: priorityColors[task.priority] }}
        title={task.priority}
      >
        {task.priority === 'urgent' ? '!!!' : task.priority === 'high' ? '!!' : task.priority === 'medium' ? '!' : ''}
      </span>

      {/* 담당자 (항상 표시) */}
      <span
        className={`TaskListRow__Assignee ${!task.assignee_name ? 'TaskListRow__Assignee--empty' : ''}`}
        title={task.assignee_name || 'Unassigned'}
      >
        {task.assignee_name
          ? task.assignee_name.charAt(0).toUpperCase()
          : <User size={12} />
        }
      </span>

      {/* 마감일 */}
      {task.due_date && (
        <span className="TaskListRow__DueDate">{formatDate(task.due_date)}</span>
      )}
    </div>
  );
}
