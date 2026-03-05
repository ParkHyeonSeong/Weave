import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import TaskListSprint from './TaskListSprint';
import TaskModal from '@/components/modal/TaskModal';
import SprintModal from '@/components/modal/SprintModal';

export default function TaskList({ branchId, branchKey }) {
  const [sprints, setSprints] = useState([]);
  const [backlogTasks, setBacklogTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // 모달 상태
  const [taskModal, setTaskModal] = useState({ open: false, task: null, sprintId: null });
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

  const handleCreateTask = (sprintId = null) => {
    setTaskModal({ open: true, task: null, sprintId });
  };

  const handleEditTask = (task) => {
    setTaskModal({ open: true, task, sprintId: task.sprint_id });
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
          onEditTask={handleEditTask}
          onEditSprint={() => setSprintModal({ open: true, sprint })}
        />
      ))}

      {/* Backlog 섹션 */}
      <TaskListSprint
        sprint={{ sprint_name: 'Backlog', status: 'backlog', tasks: backlogTasks }}
        branchId={branchId}
        branchKey={branchKey}
        onEditTask={handleEditTask}
        isBacklog
      />

      {/* Task 모달 */}
      {taskModal.open && (
        <TaskModal
          branchId={branchId}
          branchKey={branchKey}
          task={taskModal.task}
          defaultSprintId={taskModal.sprintId}
          onClose={() => setTaskModal({ open: false, task: null, sprintId: null })}
        />
      )}

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
