import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Settings, Play, CheckCircle } from 'lucide-react';
import { axios } from '@/library/_axios';
import TaskListRow from './TaskListRow';

export default function TaskListSprint({ sprint, branchKey, branchId, taskTypes, epics, members, sprints, onEditTask, onEditSprint, onCompleteSprint, isBacklog }) {
  const [collapsed, setCollapsed] = useState(false);
  const [inlineTitle, setInlineTitle] = useState('');
  const [showInline, setShowInline] = useState(false);
  const [creating, setCreating] = useState(false);
  const [startError, setStartError] = useState('');
  const tasks = sprint.tasks || [];

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
    setStartError('');
    try {
      const res = await axios.post(`/branches/${branchId}/sprints/${sprint.sprint_id}/start`);
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
      } else {
        const messages = {
          'ACTIVE_SPRINT_EXISTS': 'There is already an active sprint.',
          'SPRINT_NOT_FUTURE': 'Only future sprints can be started.',
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

  return (
    <div className="TaskList__Sprint">
      {/* Sprint 헤더 */}
      <div className="TaskList__SprintHeader" onClick={() => setCollapsed(!collapsed)}>
        <div className="TaskList__SprintLeft">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <span className="TaskList__SprintName">{sprint.sprint_name}</span>
          {!isBacklog && sprint.status && (
            <span className={`TaskList__SprintBadge ${getStatusClass(sprint.status)}`}>
              {getStatusLabel(sprint.status)}
            </span>
          )}
          <span className="TaskList__SprintCount">{tasks.length}</span>
          {startError && <span className="TaskList__SprintError">{startError}</span>}
        </div>
        <div className="TaskList__SprintRight" onClick={(e) => e.stopPropagation()}>
          {/* Start / Complete 버튼 */}
          {!isBacklog && sprint.status === 'future' && (
            <button className="TaskList__SprintStartBtn" onClick={handleStartSprint}>
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
          <button
            className="TaskList__SprintAction"
            onClick={() => { setShowInline(true); setCollapsed(false); }}
            title="Task 추가"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Task 목록 */}
      {!collapsed && (
        <div className="TaskList__SprintBody">
          {tasks.length === 0 && !showInline && (
            <div className="TaskList__Empty">No tasks</div>
          )}
          {tasks.map((task) => (
            <TaskListRow
              key={task.task_id}
              task={task}
              branchId={branchId}
              taskTypes={taskTypes}
              epics={epics}
              members={members}
              onClick={() => onEditTask(task)}
            />
          ))}

          {/* 인라인 생성 */}
          {showInline && (
            <form className="TaskList__InlineCreate" onSubmit={handleInlineCreate}>
              <Plus size={14} className="TaskList__InlineIcon" />
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

          {/* 만들기 버튼 (인라인이 안 보일 때) */}
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
    </div>
  );
}
