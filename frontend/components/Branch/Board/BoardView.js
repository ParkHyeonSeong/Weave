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
  const [activeSprint, setActiveSprint] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());

  useEffect(() => {
    fetchActiveSprint();
    fetchMembers();
  }, [branchId]);

  // task:updated 이벤트
  useEffect(() => {
    const handleRefresh = () => fetchActiveSprint();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId]);

  const fetchActiveSprint = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/sprints`);
      if (res.data.status) {
        const active = res.data.sprints.find((s) => s.status === 'active');
        setActiveSprint(active || null);
        if (active) {
          fetchBoard(active.sprint_id);
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
      const res = await axios.get(`/branches/${branchId}/tasks/board`, {
        params: { sprint_id: sprintId },
      });
      if (res.data.status) {
        setColumns(res.data.columns);
      }
    } catch {}
    setLoading(false);
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await axios.patch(`/branches/${branchId}/tasks/${taskId}`, { status: newStatus });
      if (activeSprint) fetchBoard(activeSprint.sprint_id);
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

  // 남은 일수 계산
  const getRemainingDays = () => {
    if (!activeSprint?.end_date) return null;
    const end = new Date(activeSprint.end_date);
    const now = new Date();
    const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (loading) return null;

  // active sprint 없는 경우
  if (!activeSprint) {
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

  const remainingDays = getRemainingDays();

  return (
    <div className="BoardView">
      {/* Sprint 정보 + 필터 */}
      <div className="BoardView__Header">
        <div className="BoardView__SprintInfo">
          <span className="BoardView__SprintName">{activeSprint.sprint_name}</span>
          {remainingDays !== null && (
            <span className={`BoardView__SprintDays ${remainingDays < 0 ? 'BoardView__SprintDays--overdue' : ''}`}>
              {remainingDays < 0 ? `${Math.abs(remainingDays)}d overdue` : `${remainingDays}d remaining`}
            </span>
          )}
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
