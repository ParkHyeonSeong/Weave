import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { LayoutGrid } from 'lucide-react';
import BoardColumn from './BoardColumn';
import TaskFilterBar from '../TaskFilterBar';
import useTaskContextMenu from '@/components/Branch/Tasks/taskMenu';
import ContextMenu from '@/components/common/ContextMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';

export default function BoardView({ branchId, branchKey, taskTypes, workflowStatuses, onSelectTask }) {
  const taskMenu = useTaskContextMenu({ branchId, onSelectTask });
  const [columns, setColumns] = useState({});
  const [activeSprints, setActiveSprints] = useState([]);
  const [selectedSprintId, setSelectedSprintId] = useState(null); // null = All
  const [members, setMembers] = useState([]);
  const [epics, setEpics] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  const [filters, setFilters] = useState({
    priorities: new Set(),
    labelIds: new Set(),
    epicIds: new Set(),
    typeKeys: new Set(),
    statusKeys: new Set(),
  });

  useEffect(() => {
    fetchActiveSprints();
    fetchOptions();
  }, [branchId]);

  // task:updated 이벤트
  useEffect(() => {
    const handleRefresh = () => fetchActiveSprints();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId]);

  const fetchActiveSprints = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/sprints`);
      if (res.data.status) {
        const actives = res.data.sprints.filter((s) => s.status === 'active');
        setActiveSprints(actives);
        if (actives.length > 0) {
          fetchBoard(selectedSprintId);
        } else {
          setColumns({});
          setLoading(false);
        }
      }
    } catch {
      setLoading(false);
    }
  };

  const fetchOptions = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/members`);
      if (res.data.status) setMembers(res.data.members);
    } catch {}
    try {
      const res = await axios.get(`/branches/${branchId}/epics`);
      if (res.data.status) setEpics(res.data.epics);
    } catch {}
    try {
      const res = await axios.get(`/branches/${branchId}/labels`);
      if (res.data.status) setLabels(res.data.labels);
    } catch {}
  };

  const fetchBoard = async (sprintId) => {
    try {
      const params = sprintId ? { sprint_id: sprintId } : {};
      const res = await axios.get(`/branches/${branchId}/tasks/board`, { params });
      if (res.data.status) {
        setColumns(res.data.columns);
      }
    } catch {}
    setLoading(false);
  };

  const handleSprintTabClick = (sprintId) => {
    setSelectedSprintId(sprintId);
    fetchBoard(sprintId);
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await axios.patch(`/branches/${branchId}/tasks/${taskId}`, { status: newStatus });
      fetchBoard(selectedSprintId);
    } catch {}
  };

  // 필터 토글
  const handleToggleUser = (userId) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleToggleFilter = (category, value) => {
    setFilters((prev) => {
      const next = { ...prev, [category]: new Set(prev[category]) };
      if (next[category].has(value)) next[category].delete(value);
      else next[category].add(value);
      return next;
    });
  };

  const handleClearFilters = () => {
    setFilters({
      priorities: new Set(),
      labelIds: new Set(),
      epicIds: new Set(),
      typeKeys: new Set(),
      statusKeys: new Set(),
    });
  };

  // 클라이언트 사이드 필터링
  const filterTasks = (tasks) => tasks.filter((t) => {
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedUserIds.size > 0) {
      const taskUserIds = (t.assignees || []).map((a) => a.user_id);
      if (selectedUserIds.has(0) && taskUserIds.length === 0) return true;
      if (!taskUserIds.some((uid) => selectedUserIds.has(uid))) return false;
    }
    if (filters.priorities.size > 0 && !filters.priorities.has(t.priority)) return false;
    if (filters.labelIds.size > 0) {
      const taskLabelIds = (t.labels || []).map((l) => l.label_id);
      if (!taskLabelIds.some((id) => filters.labelIds.has(id))) return false;
    }
    if (filters.epicIds.size > 0 && !filters.epicIds.has(t.epic_id)) return false;
    if (filters.typeKeys.size > 0 && !filters.typeKeys.has(t.task_type)) return false;
    if (filters.statusKeys.size > 0 && !filters.statusKeys.has(t.status)) return false;
    return true;
  });

  if (loading) return <div className="BoardView" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: '#6B7280', fontSize: 14 }}>Loading...</div>;

  // active sprint 없는 경우
  if (activeSprints.length === 0) {
    return (
      <div className="BoardView">
        <div className="BoardView__Empty">
          <LayoutGrid size={40} />
          <p className="BoardView__EmptyTitle">No active sprint</p>
          <p className="BoardView__EmptyDesc">
            Start a sprint from the Tasks tab to see the board.
          </p>
        </div>
      </div>
    );
  }

  // 선택된 sprint의 남은 일수
  const selectedSprint = selectedSprintId
    ? activeSprints.find((s) => s.sprint_id === selectedSprintId)
    : null;

  const getRemainingDays = (sprint) => {
    if (!sprint?.end_date) return null;
    const end = new Date(sprint.end_date);
    const now = new Date();
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="BoardView">
      {/* Sprint 탭 + 필터 */}
      <div className="BoardView__Header">
        <div className="BoardView__SprintTabs">
          <button
            className={`BoardView__SprintTab ${selectedSprintId === null ? 'BoardView__SprintTab--active' : ''}`}
            onClick={() => handleSprintTabClick(null)}
          >
            All
          </button>
          {activeSprints.map((sprint) => {
            const days = getRemainingDays(sprint);
            return (
              <button
                key={sprint.sprint_id}
                className={`BoardView__SprintTab ${selectedSprintId === sprint.sprint_id ? 'BoardView__SprintTab--active' : ''}`}
                onClick={() => handleSprintTabClick(sprint.sprint_id)}
              >
                {sprint.sprint_name}
                {days !== null && (
                  <span className={`BoardView__SprintDays ${days < 0 ? 'BoardView__SprintDays--overdue' : ''}`}>
                    {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <TaskFilterBar
          members={members}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedUserIds={selectedUserIds}
          onToggleUser={handleToggleUser}
          labels={labels}
          epics={epics}
          taskTypes={taskTypes}
          workflowStatuses={workflowStatuses}
          filters={filters}
          onToggleFilter={handleToggleFilter}
          onClearFilters={handleClearFilters}
        />
      </div>

      {selectedSprint?.goal && (
        <div className="BoardView__SprintGoal">{selectedSprint.goal}</div>
      )}

      {/* 칸반 컬럼 */}
      <div className="BoardView__Columns">
        {(workflowStatuses || []).map((ws) => (
          <BoardColumn
            key={ws.key}
            status={ws.key}
            label={ws.label}
            color={ws.color}
            tasks={filterTasks(columns[ws.key] || [])}
            taskTypes={taskTypes}
            onCardClick={(task) => onSelectTask(task)}
            onCardContextMenu={taskMenu.openMenu}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>

      <ContextMenu {...taskMenu.menuProps} />
      <ConfirmModal
        isOpen={!!taskMenu.confirmTask}
        onClose={taskMenu.clearConfirm}
        onConfirm={taskMenu.handleConfirmDelete}
        title="Delete Task"
        message={`${taskMenu.confirmTask?.display_id ?? ''} 태스크를 삭제하시겠습니까?`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
