import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import TaskListSprint from './TaskListSprint';
import SprintModal from '@/components/modal/SprintModal';

export default function TaskList({ branchId, branchKey, taskTypes, onSelectTask }) {
  const [sprints, setSprints] = useState([]);
  const [backlogTasks, setBacklogTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // 모달 상태
  const [sprintModal, setSprintModal] = useState({ open: false, sprint: null });

  useEffect(() => {
    fetchData();
  }, [branchId]);

  // task:updated 이벤트로 목록 갱신
  useEffect(() => {
    const handleRefresh = () => fetchData();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId]);

  const fetchData = async () => {
    try {
      // Sprint 목록
      const sprintRes = await axios.get(`/branches/${branchId}/sprints`);
      const sprintList = sprintRes.data.status ? sprintRes.data.sprints : [];

      // 각 Sprint의 Task + Backlog
      const sprintsWithTasks = await Promise.all(
        sprintList.map(async (sprint) => {
          const taskRes = await axios.get(`/branches/${branchId}/tasks`, {
            params: { sprint_id: sprint.sprint_id },
          });
          return {
            ...sprint,
            tasks: taskRes.data.status ? taskRes.data.tasks : [],
          };
        })
      );

      // Backlog (sprint_id = null)
      const backlogRes = await axios.get(`/branches/${branchId}/tasks`);
      const backlog = backlogRes.data.status ? backlogRes.data.tasks : [];

      setSprints(sprintsWithTasks);
      setBacklogTasks(backlog);
    } catch {
      // 에러 무시
    } finally {
      setLoading(false);
    }
  };

  if (loading) return null;

  return (
    <div className="TaskList">
      {/* 상단 액션 */}
      <div className="TaskList__Actions">
        <button className="TaskList__SprintBtn" onClick={() => setSprintModal({ open: true, sprint: null })}>
          <Plus size={14} />
          Create Sprint
        </button>
      </div>

      {/* Sprint 섹션들 */}
      {sprints.map((sprint) => (
        <TaskListSprint
          key={sprint.sprint_id}
          sprint={sprint}
          branchId={branchId}
          branchKey={branchKey}
          taskTypes={taskTypes}
          onEditTask={onSelectTask}
          onEditSprint={() => setSprintModal({ open: true, sprint })}
        />
      ))}

      {/* Backlog 섹션 */}
      <TaskListSprint
        sprint={{ sprint_name: 'Backlog', status: 'backlog', tasks: backlogTasks }}
        branchId={branchId}
        branchKey={branchKey}
        taskTypes={taskTypes}
        onEditTask={onSelectTask}
        isBacklog
      />

      {/* Sprint 모달 */}
      {sprintModal.open && (
        <SprintModal
          branchId={branchId}
          sprint={sprintModal.sprint}
          onClose={() => setSprintModal({ open: false, sprint: null })}
        />
      )}
    </div>
  );
}
