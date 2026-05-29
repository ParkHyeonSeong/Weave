import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Zap, ListTodo, Columns3, Workflow, CalendarDays, Archive, Settings } from 'lucide-react';
import TaskList from './Tasks/TaskList';
import BoardView from './Board/BoardView';
import EpicTimeline from './Epics/EpicTimeline';
import ArchiveList from './Archive/ArchiveList';
import TaskDetailPanel from './Tasks/TaskDetailPanel';
import EpicDetailPanel from './Epics/EpicDetailPanel';
import EpicFlow from './Flow/EpicFlow';
import BranchSettings from './Settings/BranchSettings';
import BranchSchedule from './Schedule/BranchSchedule';
import EntityIcon from '@/components/common/EntityIcon';
import EntityAppearancePopover from '@/components/common/EntityAppearancePopover';

const TABS = [
  { key: 'epics', label: 'Epics', icon: Zap },
  { key: 'tasks', label: 'Tasks', icon: ListTodo },
  { key: 'board', label: 'Board', icon: Columns3 },
  { key: 'flow', label: 'Flow', icon: Workflow },
  { key: 'schedule', label: 'Schedule', icon: CalendarDays },
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

  // Header appearance popover
  const iconRef = useRef(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const isAdmin = branch?.my_role === 'admin';

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

  // branch:created 이벤트 수신 (헤더 appearance/일반 설정 변경 반영)
  useEffect(() => {
    if (!id) return;
    const handler = () => fetchBranch();
    window.addEventListener('branch:created', handler);
    return () => window.removeEventListener('branch:created', handler);
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
          <span ref={iconRef} style={{ display: 'inline-flex' }}>
            <EntityIcon
              icon={branch.icon}
              color={branch.color}
              size={24}
              entityType="branch"
              onClick={isAdmin ? () => setPopoverOpen(true) : undefined}
              title={isAdmin ? 'Click to edit appearance' : undefined}
            />
          </span>
          <EntityAppearancePopover
            anchorRef={iconRef}
            isOpen={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            entityType="branch"
            entityId={branch.branch_id}
            initialIcon={branch.icon}
            initialColor={branch.color}
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
          {activeTab === 'schedule' && (
            <BranchSchedule branchId={branch.branch_id} />
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
