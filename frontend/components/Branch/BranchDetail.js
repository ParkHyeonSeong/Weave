import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Zap, ListTodo, Columns3, Workflow, Archive, Settings } from 'lucide-react';
import TaskList from './Tasks/TaskList';
import BoardView from './Board/BoardView';
import EpicTimeline from './Epics/EpicTimeline';
import ArchiveList from './Archive/ArchiveList';
import TaskDetailPanel from './Tasks/TaskDetailPanel';
import EpicDetailPanel from './Epics/EpicDetailPanel';
import EpicFlow from './Flow/EpicFlow';
import BranchSettings from './Settings/BranchSettings';

const TABS = [
  { key: 'epics', label: 'Epics', icon: Zap },
  { key: 'tasks', label: 'Tasks', icon: ListTodo },
  { key: 'board', label: 'Board', icon: Columns3 },
  { key: 'flow', label: 'Flow', icon: Workflow },
  { key: 'archive', label: 'Archive', icon: Archive },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export default function BranchDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [branch, setBranch] = useState(null);
  const validTabs = TABS.map((t) => t.key);
  const queryTab = router.query.tab;
  const [activeTab, setActiveTab] = useState(
    validTabs.includes(queryTab) ? queryTab : 'tasks'
  );
  const [loading, setLoading] = useState(true);

  // Task type 설정
  const [taskTypes, setTaskTypes] = useState([]);
  const [workflowStatuses, setWorkflowStatuses] = useState([]);

  // 오른쪽 패널
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedEpic, setSelectedEpic] = useState(null);

  useEffect(() => {
    if (!id) return;
    fetchBranch();
    fetchTaskTypes();
    fetchWorkflowStatuses();
  }, [id]);

  // workflow:updated 이벤트 수신
  useEffect(() => {
    const handler = () => fetchWorkflowStatuses();
    window.addEventListener('workflow:updated', handler);
    return () => window.removeEventListener('workflow:updated', handler);
  }, [id]);

  // tasktype:updated 이벤트 수신
  useEffect(() => {
    const handler = () => fetchTaskTypes();
    window.addEventListener('tasktype:updated', handler);
    return () => window.removeEventListener('tasktype:updated', handler);
  }, [id]);

  // URL query tab 동기화
  useEffect(() => {
    if (queryTab && validTabs.includes(queryTab) && queryTab !== activeTab) {
      setActiveTab(queryTab);
    }
  }, [queryTab]);

  // 쿼리 파라미터로 태스크 상세 패널 열기 (채팅 카드 클릭 등)
  useEffect(() => {
    const taskId = router.query.task;
    if (taskId && branch) {
      handleTabChange('tasks');
      setSelectedTask({ task_id: Number(taskId) });
      router.replace(`/branch/${id}?tab=tasks`, undefined, { shallow: true });
    }
  }, [router.query.task, branch]);

  // 탭 전환 시 패널 닫기
  useEffect(() => {
    setSelectedTask(null);
    setSelectedEpic(null);
  }, [activeTab]);

  const fetchBranch = async () => {
    try {
      const res = await axios.get(`/branches/${id}`);
      if (res.data.status) {
        setBranch(res.data.branch);
      } else {
        router.replace('/');
      }
    } catch {
      router.replace('/');
    } finally {
      setLoading(false);
    }
  };

  const fetchTaskTypes = async () => {
    try {
      const res = await axios.get(`/branches/${id}/task-types`);
      if (res.data.status) setTaskTypes(res.data.task_types);
    } catch {}
  };

  const fetchWorkflowStatuses = async () => {
    try {
      const res = await axios.get(`/branches/${id}/workflow-statuses`);
      if (res.data.status) setWorkflowStatuses(res.data.statuses);
    } catch {}
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    router.replace(`/branch/${id}?tab=${tab}`, undefined, { shallow: true });
  };

  const handleSelectEpic = (epic) => {
    setSelectedTask(null);
    setSelectedEpic(epic);
  };

  const handleSelectTask = (task) => {
    setSelectedEpic(null);
    setSelectedTask(task);
  };

  // 에픽 패널에서 태스크 클릭 -> 태스크탭 + 상세패널 열기
  const handleEpicTaskClick = (task) => {
    setSelectedEpic(null);
    setActiveTab('tasks');
    router.replace(`/branch/${id}?tab=tasks`, undefined, { shallow: true });
    // activeTab 변경 후 cleanup이 먼저 실행되므로 다음 틱에서 설정
    setTimeout(() => setSelectedTask(task), 0);
  };

  const panelOpen = selectedTask || selectedEpic;

  if (loading || !branch) return null;

  return (
    <div className={`BranchDetail ${panelOpen ? 'BranchDetail--panel-open' : ''}`}>
      <div className={`BranchDetail__Main ${activeTab === 'flow' ? 'BranchDetail__Main--flow' : ''}`}>
        {/* 헤더 */}
        <div className="BranchDetail__Header">
          <span
            className="BranchDetail__Icon"
            style={{ backgroundColor: branch.color || '#5E6AD2' }}
          />
          <h1 className="BranchDetail__Name">{branch.branch_name}</h1>
          <span className="BranchDetail__Key">{branch.key}</span>
        </div>

        {/* 탭 */}
        <div className="BranchDetail__Tabs">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`BranchDetail__Tab ${activeTab === key ? 'BranchDetail__Tab--active' : ''}`}
              onClick={() => handleTabChange(key)}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <div className="BranchDetail__Content">
          {activeTab === 'tasks' && (
            <TaskList
              branchId={branch.branch_id}
              branchKey={branch.key}
              taskTypes={taskTypes}
              workflowStatuses={workflowStatuses}
              onSelectTask={handleSelectTask}
            />
          )}
          {activeTab === 'epics' && (
            <EpicTimeline
              branchId={branch.branch_id}
              onSelectEpic={handleSelectEpic}
            />
          )}
          {activeTab === 'board' && (
            <BoardView
              branchId={branch.branch_id}
              branchKey={branch.key}
              taskTypes={taskTypes}
              workflowStatuses={workflowStatuses}
              onSelectTask={handleSelectTask}
            />
          )}
          {activeTab === 'flow' && (
            <EpicFlow
              branchId={branch.branch_id}
              workflowStatuses={workflowStatuses}
              onSelectTask={handleSelectTask}
            />
          )}
          {activeTab === 'archive' && (
            <ArchiveList
              branchId={branch.branch_id}
              branchKey={branch.key}
              taskTypes={taskTypes}
              workflowStatuses={workflowStatuses}
              onSelectTask={handleSelectTask}
            />
          )}
          {activeTab === 'settings' && (
            <BranchSettings
              branchId={branch.branch_id}
              branch={branch}
              myRole={branch.my_role}
              onBranchUpdated={fetchBranch}
            />
          )}
        </div>
      </div>

      {/* Task 상세 패널 */}
      {selectedTask && (
        <TaskDetailPanel
          branchId={branch.branch_id}
          branchKey={branch.key}
          taskTypes={taskTypes}
          workflowStatuses={workflowStatuses}
          taskSummary={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSelectTask={handleSelectTask}
        />
      )}

      {/* Epic 상세 패널 */}
      {selectedEpic && (
        <EpicDetailPanel
          branchId={branch.branch_id}
          workflowStatuses={workflowStatuses}
          epicSummary={selectedEpic}
          onClose={() => setSelectedEpic(null)}
          onSelectTask={handleEpicTaskClick}
        />
      )}
    </div>
  );
}
