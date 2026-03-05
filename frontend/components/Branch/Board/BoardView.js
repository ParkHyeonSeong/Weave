import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import BoardColumn from './BoardColumn';

const COLUMNS = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export default function BoardView({ branchId, branchKey, onSelectTask }) {
  const [columns, setColumns] = useState({ todo: [], in_progress: [], done: [] });
  const [sprints, setSprints] = useState([]);
  const [selectedSprintId, setSelectedSprintId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSprints();
  }, [branchId]);

  useEffect(() => {
    fetchBoard();
  }, [branchId, selectedSprintId]);

  // task:updated 이벤트
  useEffect(() => {
    const handleRefresh = () => fetchBoard();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId, selectedSprintId]);

  const fetchSprints = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/sprints`);
      if (res.data.status) {
        const list = res.data.sprints;
        setSprints(list);
        // active 스프린트 자동 선택
        const active = list.find((s) => s.status === 'active');
        if (active) setSelectedSprintId(active.sprint_id);
      }
    } catch {}
  };

  const fetchBoard = async () => {
    try {
      const params = selectedSprintId ? { sprint_id: selectedSprintId } : {};
      const res = await axios.get(`/branches/${branchId}/tasks/board`, { params });
      if (res.data.status) {
        setColumns(res.data.columns);
      }
    } catch {}
    setLoading(false);
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await axios.patch(`/branches/${branchId}/tasks/${taskId}`, { status: newStatus });
      fetchBoard();
    } catch {}
  };

  if (loading) return null;

  return (
    <div className="BoardView">
      {/* Sprint 셀렉터 */}
      <div className="BoardView__Header">
        <select
          className="BoardView__SprintSelect"
          value={selectedSprintId || ''}
          onChange={(e) => setSelectedSprintId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All Tasks</option>
          {sprints.map((s) => (
            <option key={s.sprint_id} value={s.sprint_id}>
              {s.sprint_name} {s.status === 'active' ? '(Active)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* 칸반 컬럼 */}
      <div className="BoardView__Columns">
        {COLUMNS.map(({ key, label }) => (
          <BoardColumn
            key={key}
            status={key}
            label={label}
            tasks={columns[key] || []}
            onCardClick={(task) => onSelectTask(task)}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>
    </div>
  );
}
