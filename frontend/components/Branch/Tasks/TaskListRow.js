import { useState, useRef, useEffect } from 'react';
import { User, MessageCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { axios } from '@/library/_axios';
import { selectableEpics } from '@/library/epics';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import CustomSelect from '@/components/common/CustomSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import Avatar from '@/components/common/Avatar';
import { progressLabel, progressPercent } from '@/library/subtaskProgress';

const priorityOptions = [
  { value: 'urgent', label: 'Urgent', color: '#DC2626' },
  { value: 'high', label: 'High', color: '#F59E0B' },
  { value: 'medium', label: 'Medium', color: '#5E6AD2' },
  { value: 'low', label: 'Low', color: '#9CA3AF' },
];

const DEFAULT_STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do', color: '#9CA3AF' },
  { value: 'in_progress', label: 'In Progress', color: '#2563EB' },
  { value: 'done', label: 'Done', color: '#16A34A' },
  { value: 'cancelled', label: 'Cancelled', color: '#DC2626' },
];

export default function TaskListRow({ task, branchId, taskTypes, workflowStatuses, epics, members, onClick, onContextMenu, isSelected, isOverlay, indent, expandable, expanded, onToggleExpand, progress, contextOnly }) {
  const statusOptions = (workflowStatuses && workflowStatuses.length > 0)
    ? workflowStatuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))
    : DEFAULT_STATUS_OPTIONS;
  const typeConfig = (taskTypes || []).find((t) => t.type_key === task.task_type);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeRef = useRef(null);

  // 행 전체를 드래그 핸들로 사용. 하위태스크(indent)·오버레이는 드래그 비활성(v1 정책).
  const draggable = !isOverlay && !indent;

  // attributes(role=button·tabIndex)는 행 내부 버튼/셀렉트와 중첩되면 a11y를 해쳐 적용하지 않고,
  // 포인터 listeners만 행에 붙여 "행 전체 드래그"를 구현한다.
  const {
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: String(task.task_id),
    disabled: !draggable,
  });

  // 행 내부 인터랙티브 컨트롤(셰브론·셀렉트·담당자) 위에서 누르면 드래그가 시작되지 않도록
  // mousedown/touchstart 전파를 막는다. (MouseSensor/TouchSensor는 click보다 이른 이벤트에서 활성화)
  const stopDrag = (e) => e.stopPropagation();

  // 평상시 opacity 는 클래스(TaskListRow--context / --dragging)가 결정하도록 inline 에서 제거.
  // 드래그 중에는 dnd-kit 동작 일관성을 위해 inline 0.3 을 우선 적용한다.
  const style = isOverlay ? {} : {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { opacity: 0.3 } : {}),
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      month: '2-digit', day: '2-digit',
    });
  };

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

  const handleFieldChange = async (field, value) => {
    try {
      await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, { [field]: value });
      window.dispatchEvent(new Event('task:updated'));
    } catch {}
  };

  const epicOptions = [
    { value: '', label: 'None', color: '#9CA3AF' },
    ...selectableEpics(epics, task.epic_id).map((e) => ({
      value: String(e.epic_id),
      label: e.epic_name,
      color: e.color || '#5E6AD2',
    })),
  ];

  const memberList = members || [];
  const hasEpic = !!task.epic_id;

  return (
    <div
      className={`TaskListRow ${isSelected ? 'TaskListRow--selected' : ''} ${isDragging ? 'TaskListRow--dragging' : ''} ${indent ? 'TaskListRow--subtask' : ''} ${contextOnly ? 'TaskListRow--context' : ''}`}
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...(draggable ? listeners : {})}
    >
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

      {/* 제목 + 이슈 카운트 */}
      <div className="TaskListRow__TitleWrap">
        <span className="TaskListRow__Title">{task.title}</span>
        {expandable && (
          <button
            type="button"
            className="TaskListRow__Chevron"
            onMouseDown={stopDrag}
            onTouchStart={stopDrag}
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
            title={expanded ? '하위태스크 접기' : '하위태스크 펼치기'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {contextOnly && (
          <span
            className="TaskListRow__ContextTag"
            title="필터에 일치하는 하위태스크가 있어 맥락용으로 표시됩니다"
          >
            상위
          </span>
        )}
        {progress && progress.total > 0 && (
          <span className="TaskListRow__Badge" title="완료/전체 하위태스크">
            {progressLabel(progress)}
          </span>
        )}
        {task.issue_count > 0 && (
          <span className="TaskListRow__Issues">
            +{task.issue_count}
            <MessageCircle size={12} />
          </span>
        )}
        {expandable && expanded && progress && progress.total > 0 && (
          <span className="TaskListRow__Progress">
            <span
              className="TaskListRow__ProgressFill"
              style={{ width: `${progressPercent(progress)}%` }}
            />
          </span>
        )}
      </div>

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

      {/* 에픽 */}
      <div className={`TaskListRow__Cell TaskListRow__Cell--epic ${hasEpic ? '' : 'TaskListRow__Cell--hoverOnly'}`} onClick={stopDrag} onMouseDown={stopDrag} onTouchStart={stopDrag}>
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

      {/* 상태 */}
      <div className="TaskListRow__Cell TaskListRow__Cell--status" onClick={stopDrag} onMouseDown={stopDrag} onTouchStart={stopDrag}>
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

      {/* 우선순위 */}
      <div className="TaskListRow__Cell TaskListRow__Cell--priority" onClick={stopDrag} onMouseDown={stopDrag} onTouchStart={stopDrag}>
        <CustomSelect
          value={task.priority || 'low'}
          options={priorityOptions}
          onChange={(val) => handleFieldChange('priority', val)}
          size="sm"
          hideArrow
          className={`TaskListRow__Priority TaskListRow__Priority--${task.priority || 'low'}`}
        />
      </div>

      {/* 담당자 */}
      <div
        className="TaskListRow__AssigneeWrap"
        ref={assigneeRef}
        onClick={stopDrag}
        onMouseDown={stopDrag}
        onTouchStart={stopDrag}
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
                  ? <Avatar user={mainAssignee} size={24} title={mainAssignee.username} />
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
                  <Avatar user={m} size={24} />
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
