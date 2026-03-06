import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import TaskListSprint from './TaskListSprint';
import SprintModal from '@/components/modal/SprintModal';
import CompleteSprintModal from '@/components/modal/CompleteSprintModal';
import TaskFilterBar from '../TaskFilterBar';

export default function TaskList({ branchId, branchKey, taskTypes, onSelectTask }) {
  const [sprints, setSprints] = useState([]);
  const [backlogTasks, setBacklogTasks] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());

  // 모달 상태
  const [sprintModal, setSprintModal] = useState({ open: false, sprint: null });
  const [completeSprint, setCompleteSprint] = useState(null);

  useEffect(() => {
    fetchData();
    fetchOptions();
  }, [branchId]);

  // task:updated 이벤트로 목록 갱신
  useEffect(() => {
    const handleRefresh = () => fetchData();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId]);

  const fetchOptions = async () => {
    // 각각 독립적으로 fetch (하나 실패해도 나머지 영향 없음)
    try {
      const epicRes = await axios.get(`/branches/${branchId}/epics`);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
    } catch {}
    try {
      const memberRes = await axios.get(`/branches/${branchId}/members`);
      if (memberRes.data.status) setMembers(memberRes.data.members);
    } catch {}
  };

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
      if (selectedUserIds.has(0) && !t.assignee_id) return true;
      if (!selectedUserIds.has(t.assignee_id)) return false;
    }
    return true;
  });

  if (loading) return null;

  return (
    <div className="TaskList">
      {/* 상단 필터 + 액션 */}
      <div className="TaskList__Actions">
        <TaskFilterBar
          members={members}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedUserIds={selectedUserIds}
          onToggleUser={handleToggleUser}
        />
        <button className="TaskList__SprintBtn" onClick={() => setSprintModal({ open: true, sprint: null })}>
          <Plus size={14} />
          Create Sprint
        </button>
      </div>

      {/* Sprint 섹션들 */}
      {sprints.map((sprint) => (
        <TaskListSprint
          key={sprint.sprint_id}
          sprint={{ ...sprint, tasks: filterTasks(sprint.tasks) }}
          branchId={branchId}
          branchKey={branchKey}
          taskTypes={taskTypes}
          epics={epics}
          members={members}
          sprints={sprints}
          onEditTask={onSelectTask}
          onEditSprint={() => setSprintModal({ open: true, sprint })}
          onCompleteSprint={(s) => setCompleteSprint(s)}
        />
      ))}

      {/* Backlog 섹션 */}
      <TaskListSprint
        sprint={{ sprint_name: 'Backlog', status: 'backlog', tasks: filterTasks(backlogTasks) }}
        branchId={branchId}
        branchKey={branchKey}
        taskTypes={taskTypes}
        epics={epics}
        members={members}
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

      {/* Complete Sprint 모달 */}
      {completeSprint && (
        <CompleteSprintModal
          branchId={branchId}
          sprint={completeSprint}
          sprints={sprints.filter((s) => s.sprint_id !== completeSprint.sprint_id && s.status === 'future')}
          onClose={() => setCompleteSprint(null)}
        />
      )}
    </div>
  );
}
