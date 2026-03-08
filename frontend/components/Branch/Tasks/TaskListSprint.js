import { useState, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, Plus, Settings, Play, CheckCircle, GripVertical } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import TaskListRow from './TaskListRow';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import ConfirmModal from '@/components/modal/ConfirmModal';

function formatSprintDate(start, end) {
  const fmt = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `${fmt(start)} –`;
  return `– ${fmt(end)}`;
}

export default function TaskListSprint({
  sprint, branchKey, branchId, taskTypes, workflowStatuses, epics, members, sprints,
  onEditTask, onEditSprint, onCompleteSprint, isBacklog,
  selectedTaskIds, dragOverContainerId,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [inlineTitle, setInlineTitle] = useState('');
  const [inlineType, setInlineType] = useState('task');
  const [showInline, setShowInline] = useState(false);
  const [creating, setCreating] = useState(false);
  const [startError, setStartError] = useState('');
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const typeDropdownRef = useRef(null);
  const tasks = sprint.tasks || [];

  const containerId = isBacklog ? 'backlog' : `sprint-${sprint.sprint_id}`;
  const isDragOver = dragOverContainerId === containerId;

  // Sprint 자체의 sortable (백로그 제외)
  const {
    attributes: sprintAttributes,
    listeners: sprintListeners,
    setNodeRef: setSprintNodeRef,
    transform: sprintTransform,
    transition: sprintTransition,
    isDragging: isSprintDragging,
  } = useSortable({
    id: containerId,
    disabled: isBacklog,
  });

  const sprintStyle = {
    transform: CSS.Transform.toString(sprintTransform),
    transition: sprintTransition,
    opacity: isSprintDragging ? 0.4 : 1,
  };

  // Sprint body의 droppable (태스크 드롭 영역)
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: containerId,
  });

  // 타입 드롭다운 외부 클릭 닫기
  useEffect(() => {
    if (!showTypeDropdown) return;
    const handleClick = (e) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target)) {
        setShowTypeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTypeDropdown]);

  const getStatusLabel = (status) => {
    switch (status) {
      case 'active': return 'Active';
      case 'closed': return 'Closed';
      case 'future': return 'Future';
      default: return '';
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'active': return 'TaskList__SprintBadge--active';
      case 'closed': return 'TaskList__SprintBadge--closed';
      default: return '';
    }
  };

  const handleInlineCreate = async (e) => {
    e.preventDefault();
    if (!inlineTitle.trim() || creating) return;

    setCreating(true);
    try {
      const { axios } = await import('@/library/_axios');
      const res = await axios.post(`/branches/${branchId}/tasks`, {
        title: inlineTitle.trim(),
        sprint_id: isBacklog ? null : (sprint.sprint_id || null),
        task_type: inlineType,
      });
      if (res.data.status) {
        setInlineTitle('');
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {
      // 에러 무시
    } finally {
      setCreating(false);
    }
  };

  const handleStartSprint = async () => {
    setShowStartConfirm(false);
    setStartError('');
    try {
      const res = await axios.post(`/branches/${branchId}/sprints/${sprint.sprint_id}/start`);
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
      } else {
        const messages = {
          'SPRINT_NOT_FUTURE': 'Only future sprints can be started.',
          'SPRINT_EMPTY': 'Cannot start a sprint with no tasks.',
        };
        setStartError(messages[res.data.message] || res.data.message);
        setTimeout(() => setStartError(''), 3000);
      }
    } catch {
      setStartError('Failed to start sprint.');
      setTimeout(() => setStartError(''), 3000);
    }
  };

  const handleInlineKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowInline(false);
      setInlineTitle('');
    }
  };

  const currentTypeConfig = (taskTypes || []).find((t) => t.type_key === inlineType);
  const taskIds = tasks.map((t) => String(t.task_id));

  return (
    <div
      className={`TaskList__Sprint ${isDragOver ? 'TaskList__Sprint--dragOver' : ''}`}
      ref={setSprintNodeRef}
      style={sprintStyle}
    >
      {/* Sprint 헤더 */}
      <div className="TaskList__SprintHeader" onClick={() => setCollapsed(!collapsed)}>
        <div className="TaskList__SprintLeft">
          {/* 드래그 핸들 (백로그 제외) */}
          {!isBacklog && (
            <span
              className="TaskList__DragHandle"
              {...sprintAttributes}
              {...sprintListeners}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={14} />
            </span>
          )}
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <span className="TaskList__SprintName">{sprint.sprint_name}</span>
          {!isBacklog && sprint.status && (
            <span className={`TaskList__SprintBadge ${getStatusClass(sprint.status)}`}>
              {getStatusLabel(sprint.status)}
            </span>
          )}
          {!isBacklog && (sprint.start_date || sprint.end_date) && (
            <span className="TaskList__SprintDate">
              {formatSprintDate(sprint.start_date, sprint.end_date)}
            </span>
          )}
          <span className="TaskList__SprintCount">{tasks.length}</span>
          {startError && <span className="TaskList__SprintError">{startError}</span>}
        </div>
        <div className="TaskList__SprintRight" onClick={(e) => e.stopPropagation()}>
          {!isBacklog && sprint.status === 'future' && (
            <button className="TaskList__SprintStartBtn" onClick={() => setShowStartConfirm(true)}>
              <Play size={12} />
              Start Sprint
            </button>
          )}
          {!isBacklog && sprint.status === 'active' && onCompleteSprint && (
            <button className="TaskList__SprintCompleteBtn" onClick={() => onCompleteSprint(sprint)}>
              <CheckCircle size={12} />
              Complete Sprint
            </button>
          )}
          {!isBacklog && onEditSprint && (
            <button className="TaskList__SprintAction" onClick={onEditSprint} title="Sprint 설정">
              <Settings size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Task 목록 */}
      {!collapsed && (
        <div className="TaskList__SprintBody" ref={setDroppableRef}>
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            {tasks.length === 0 && !showInline && (
              <div className="TaskList__Empty">No tasks</div>
            )}
            {tasks.map((task) => (
              <TaskListRow
                key={task.task_id}
                task={task}
                branchId={branchId}
                taskTypes={taskTypes}
                workflowStatuses={workflowStatuses}
                epics={epics}
                members={members}
                onClick={(e) => onEditTask(task, e)}
                isSelected={selectedTaskIds && selectedTaskIds.has(task.task_id)}
              />
            ))}
          </SortableContext>

          {/* 인라인 생성 */}
          {showInline && (
            <form className="TaskList__InlineCreate" onSubmit={handleInlineCreate}>
              {/* 타입 선택 아이콘 */}
              <div className="TaskList__InlineTypeWrap" ref={typeDropdownRef}>
                <button
                  type="button"
                  className="TaskList__InlineTypeBtn"
                  onClick={() => setShowTypeDropdown((prev) => !prev)}
                  title={currentTypeConfig?.type_name || 'Task'}
                >
                  <TaskTypeIcon
                    name={currentTypeConfig?.icon || 'CheckSquare'}
                    size={14}
                    color={currentTypeConfig?.color || '#5E6AD2'}
                  />
                </button>
                {showTypeDropdown && (
                  <div className="TaskList__InlineTypeDropdown">
                    {(taskTypes || []).map((tt) => (
                      <button
                        key={tt.type_key}
                        type="button"
                        className={`TaskList__InlineTypeOption ${inlineType === tt.type_key ? 'TaskList__InlineTypeOption--selected' : ''}`}
                        onClick={() => { setInlineType(tt.type_key); setShowTypeDropdown(false); }}
                      >
                        <TaskTypeIcon name={tt.icon} size={14} color={tt.color} />
                        <span>{tt.type_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className="TaskList__InlineInput"
                type="text"
                placeholder="What needs to be done?"
                value={inlineTitle}
                onChange={(e) => setInlineTitle(e.target.value)}
                onKeyDown={handleInlineKeyDown}
                onBlur={() => { if (!inlineTitle.trim()) setShowInline(false); }}
                autoFocus
                disabled={creating}
              />
            </form>
          )}

          {/* 만들기 버튼 */}
          {!showInline && (
            <button
              className="TaskList__InlineBtn"
              onClick={() => setShowInline(true)}
            >
              <Plus size={14} />
              Create
            </button>
          )}
        </div>
      )}
      <ConfirmModal
        isOpen={showStartConfirm}
        onClose={() => setShowStartConfirm(false)}
        onConfirm={handleStartSprint}
        title="Start Sprint"
        message={`"${sprint.sprint_name}" 을(를) 시작하시겠습니까? 현재 ${tasks.length}개의 태스크가 있습니다.`}
        confirmLabel="Start"
      />
    </div>
  );
}
