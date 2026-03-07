import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { LayoutGrid } from 'lucide-react';
import BoardColumn from './BoardColumn';
import TaskFilterBar from '../TaskFilterBar';

const COLUMNS = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export default function BoardView({ branchId, branchKey, taskTypes, onSelectTask }) {
  const [columns, setColumns] = useState({ todo: [], in_progress: [], done: [] });
  const [activeSprints, setActiveSprints] = useState([]);
  const [selectedSprintId, setSelectedSprintId] = useState(null); // null = All
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());

  useEffect(() => {
    fetchActiveSprints();
    fetchMembers();
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
          setColumns({ todo: [], in_progress: [], done: [] });
          setLoading(false);
        }
      }
    } catch {
      setLoading(false);
    }
  };

  const fetchMembers = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/members`);
      if (res.data.status) setMembers(res.data.members);
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

  // 클라이언트 사이드 필터링
  const filterTasks = (tasks) => tasks.filter((t) => {
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedUserIds.size > 0) {
      const taskUserIds = (t.assignees || []).map((a) => a.user_id);
      if (selectedUserIds.has(0) && taskUserIds.length === 0) return true;
      if (!taskUserIds.some((uid) => selectedUserIds.has(uid))) return false;
    }
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
        />
      </div>

      {/* 칸반 컬럼 */}
      <div className="BoardView__Columns">
        {COLUMNS.map(({ key, label }) => (
          <BoardColumn
            key={key}
            status={key}
            label={label}
            tasks={filterTasks(columns[key] || [])}
            taskTypes={taskTypes}
            onCardClick={(task) => onSelectTask(task)}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>
    </div>
  );
}
