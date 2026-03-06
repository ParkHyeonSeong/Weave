import { useState, useRef, useEffect } from 'react';
import { User } from 'lucide-react';
import { axios } from '@/library/_axios';
import CustomSelect from '@/components/common/CustomSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';

const priorityOptions = [
  { value: 'urgent', label: 'Urgent', color: '#DC2626' },
  { value: 'high', label: 'High', color: '#F59E0B' },
  { value: 'medium', label: 'Medium', color: '#5E6AD2' },
  { value: 'low', label: 'Low', color: '#9CA3AF' },
];

const statusOptions = [
  { value: 'todo', label: 'To Do', color: '#9CA3AF' },
  { value: 'in_progress', label: 'In Progress', color: '#2563EB' },
  { value: 'done', label: 'Done', color: '#16A34A' },
];

export default function TaskListRow({ task, branchId, taskTypes, epics, members, onClick }) {
  const typeConfig = (taskTypes || []).find((t) => t.type_key === task.task_type);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeRef = useRef(null);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      month: '2-digit', day: '2-digit',
    });
  };

  // 담당자 드롭다운 외부 클릭 닫기
  useEffect(() => {
    if (!assigneeOpen) return;
    const handleClick = (e) => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target)) {
        setAssigneeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [assigneeOpen]);

  // 인라인 필드 변경 공통
  const handleFieldChange = async (field, value) => {
    try {
      await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, { [field]: value });
      window.dispatchEvent(new Event('task:updated'));
    } catch {}
  };

  // 에픽 옵션 (None 포함)
  const epicOptions = [
    { value: '', label: 'None', color: '#9CA3AF' },
    ...(epics || []).map((e) => ({
      value: String(e.epic_id),
      label: e.epic_name,
      color: e.color || '#5E6AD2',
    })),
  ];

  // 담당자 목록
  const memberList = members || [];
  const hasEpic = !!task.epic_id;

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

      {/* 에픽 (인라인 변경) - 미설정시 hover에만 표시 */}
      <div className={`TaskListRow__Cell TaskListRow__Cell--epic ${hasEpic ? '' : 'TaskListRow__Cell--hoverOnly'}`} onClick={(e) => e.stopPropagation()}>
        <CustomSelect
          value={hasEpic ? String(task.epic_id) : ''}
          options={epicOptions}
          onChange={(val) => handleFieldChange('epic_id', val ? Number(val) : null)}
          size="sm"
          hideArrow
          placeholder="+ Epic"
          className={`TaskListRow__Epic ${hasEpic ? '' : 'TaskListRow__Epic--empty'}`}
        />
      </div>

      {/* 상태 (인라인 변경) */}
      <div className="TaskListRow__Cell TaskListRow__Cell--status" onClick={(e) => e.stopPropagation()}>
        <CustomSelect
          value={task.status}
          options={statusOptions}
          onChange={(val) => handleFieldChange('status', val)}
          size="sm"
          hideArrow
          className={`TaskListRow__Status TaskListRow__Status--${task.status}`}
        />
      </div>

      {/* 마감일 */}
      <span className="TaskListRow__Cell TaskListRow__Cell--dueDate">
        <span className="TaskListRow__DueDate">
          {task.due_date ? formatDate(task.due_date) : '-'}
        </span>
      </span>

      {/* 우선순위 (인라인 변경) */}
      <div className="TaskListRow__Cell TaskListRow__Cell--priority" onClick={(e) => e.stopPropagation()}>
        <CustomSelect
          value={task.priority || 'low'}
          options={priorityOptions}
          onChange={(val) => handleFieldChange('priority', val)}
          size="sm"
          hideArrow
          className={`TaskListRow__Priority TaskListRow__Priority--${task.priority || 'low'}`}
        />
      </div>

      {/* 담당자 (메인 아바타 + 서브 카운트 + 드롭다운) */}
      <div
        className="TaskListRow__AssigneeWrap"
        ref={assigneeRef}
        onClick={(e) => e.stopPropagation()}
      >
        {(() => {
          const mainAssignee = (task.assignees || []).find((a) => a.role === 'main');
          const subCount = (task.assignees || []).filter((a) => a.role === 'sub').length;
          return (
            <>
              <button
                type="button"
                className={`TaskListRow__Assignee ${!mainAssignee ? 'TaskListRow__Assignee--empty' : ''}`}
                title={mainAssignee?.username || 'Unassigned'}
                onClick={() => setAssigneeOpen((prev) => !prev)}
              >
                {mainAssignee
                  ? mainAssignee.username.charAt(0).toUpperCase()
                  : <User size={12} />
                }
              </button>
              {subCount > 0 && (
                <span className="TaskListRow__SubCount">+{subCount}</span>
              )}
            </>
          );
        })()}

        {assigneeOpen && (
          <div className="TaskListRow__AssigneeDropdown">
            <button
              type="button"
              className={`TaskListRow__AssigneeOption ${!(task.assignees || []).find((a) => a.role === 'main') ? 'TaskListRow__AssigneeOption--selected' : ''}`}
              onClick={() => {
                const currentSubs = (task.assignees || []).filter((a) => a.role === 'sub').map((a) => a.user_id);
                handleFieldChange('assignees', { main: null, sub: currentSubs });
                setAssigneeOpen(false);
              }}
            >
              <span className="TaskListRow__AssigneeAvatar TaskListRow__AssigneeAvatar--empty">
                <User size={14} />
              </span>
              <span>Unassigned</span>
            </button>

            {memberList.map((m) => {
              const isMain = (task.assignees || []).some((a) => a.role === 'main' && a.user_id === m.user_id);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  className={`TaskListRow__AssigneeOption ${isMain ? 'TaskListRow__AssigneeOption--selected' : ''}`}
                  onClick={() => {
                    const currentSubs = (task.assignees || []).filter((a) => a.role === 'sub' && a.user_id !== m.user_id).map((a) => a.user_id);
                    handleFieldChange('assignees', { main: m.user_id, sub: currentSubs });
                    setAssigneeOpen(false);
                  }}
                >
                  <span className="TaskListRow__AssigneeAvatar">
                    {(m.display_name || m.email).charAt(0).toUpperCase()}
                  </span>
                  <span>{m.display_name || m.email}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
