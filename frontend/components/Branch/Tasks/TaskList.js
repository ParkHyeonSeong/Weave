import { useState, useEffect, useCallback, useRef } from 'react';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import TaskListSprint from './TaskListSprint';
import SprintModal from '@/components/modal/SprintModal';
import CompleteSprintModal from '@/components/modal/CompleteSprintModal';
import TaskFilterBar from '../TaskFilterBar';
import TaskListRow from './TaskListRow';
import useTaskContextMenu from './taskMenu';
import ContextMenu from '@/components/common/ContextMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';

// localStorage 키 헬퍼
const storageKey = (branchId, type) => `weave_tasks_${branchId}_${type}`;

// Set <-> Array 변환
const setToArray = (s) => [...(s || [])];
const arrayToSet = (a) => new Set(a || []);

// localStorage 안전 읽기 (SSR 대응)
function loadJSON(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// 우선순위 정렬용 가중치
const PRIORITY_WEIGHT = { urgent: 0, high: 1, medium: 2, low: 3 };

export default function TaskList({ branchId, branchKey, taskTypes, workflowStatuses, onSelectTask }) {
  const [sprints, setSprints] = useState([]);
  const [backlogTasks, setBacklogTasks] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태 (localStorage에서 복원)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  const [filters, setFilters] = useState({
    priorities: new Set(),
    labelIds: new Set(),
    epicIds: new Set(),
    typeKeys: new Set(),
    statusKeys: new Set(),
  });

  // 정렬 상태 (localStorage에서 복원)
  const [sortConfig, setSortConfig] = useState({ field: null, direction: 'asc' });

  // 스프린트 접힘 상태 (localStorage에서 복원)
  const [collapsedSprints, setCollapsedSprints] = useState(new Set());

  // localStorage 초기화 완료 여부 (마운트 시 불필요한 write 방지)
  const [initialized, setInitialized] = useState(false);

  // 모달 상태
  const [sprintModal, setSprintModal] = useState({ open: false, sprint: null });
  const [completeSprint, setCompleteSprint] = useState(null);

  // DnD 상태
  const [activeId, setActiveId] = useState(null);
  const [activeType, setActiveType] = useState(null); // 'sprint' | 'task'
  const [selectedTaskIds, setSelectedTaskIds] = useState(new Set());
  const [dragOverContainerId, setDragOverContainerId] = useState(null);

  const sortActive = sortConfig.field !== null;

  const taskMenu = useTaskContextMenu({ branchId, onSelectTask });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // localStorage에서 필터/정렬/접힘 상태 복원 (branchId 변경 시)
  useEffect(() => {
    // 필터 복원
    const saved = loadJSON(storageKey(branchId, 'filters'), null);
    if (saved) {
      setSearchQuery(saved.searchQuery || '');
      setSelectedUserIds(arrayToSet(saved.selectedUserIds));
      setFilters({
        priorities: arrayToSet(saved.filters?.priorities),
        labelIds: arrayToSet(saved.filters?.labelIds),
        epicIds: arrayToSet(saved.filters?.epicIds),
        typeKeys: arrayToSet(saved.filters?.typeKeys),
        statusKeys: arrayToSet(saved.filters?.statusKeys),
      });
    } else {
      setSearchQuery('');
      setSelectedUserIds(new Set());
      setFilters({
        priorities: new Set(), labelIds: new Set(),
        epicIds: new Set(), typeKeys: new Set(), statusKeys: new Set(),
      });
    }

    // 정렬 복원
    const savedSort = loadJSON(storageKey(branchId, 'sort'), { field: null, direction: 'asc' });
    setSortConfig(savedSort);

    // 접힘 복원
    const savedCollapsed = loadJSON(storageKey(branchId, 'collapsed'), []);
    setCollapsedSprints(new Set(savedCollapsed));

    setInitialized(true);
  }, [branchId]);

  // 필터 변경 시 localStorage 저장
  useEffect(() => {
    if (!initialized) return;
    const data = {
      searchQuery,
      selectedUserIds: setToArray(selectedUserIds),
      filters: {
        priorities: setToArray(filters.priorities),
        labelIds: setToArray(filters.labelIds),
        epicIds: setToArray(filters.epicIds),
        typeKeys: setToArray(filters.typeKeys),
        statusKeys: setToArray(filters.statusKeys),
      },
    };
    localStorage.setItem(storageKey(branchId, 'filters'), JSON.stringify(data));
  }, [branchId, searchQuery, selectedUserIds, filters, initialized]);

  // 정렬 변경 시 localStorage 저장
  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(storageKey(branchId, 'sort'), JSON.stringify(sortConfig));
  }, [branchId, sortConfig, initialized]);

  // 접힘 변경 시 localStorage 저장
  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(storageKey(branchId, 'collapsed'), JSON.stringify(setToArray(collapsedSprints)));
  }, [branchId, collapsedSprints, initialized]);

  useEffect(() => {
    fetchData();
    fetchOptions();
  }, [branchId]);

  useEffect(() => {
    const handleRefresh = () => fetchData();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId]);

  const fetchOptions = async () => {
    try {
      const epicRes = await axios.get(`/branches/${branchId}/epics`);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
    } catch {}
    try {
      const memberRes = await axios.get(`/branches/${branchId}/members`);
      if (memberRes.data.status) setMembers(memberRes.data.members);
    } catch {}
    try {
      const labelRes = await axios.get(`/branches/${branchId}/labels`);
      if (labelRes.data.status) setLabels(labelRes.data.labels);
    } catch {}
  };

  const fetchData = async () => {
    try {
      const sprintRes = await axios.get(`/branches/${branchId}/sprints`);
      const sprintList = sprintRes.data.status
        ? sprintRes.data.sprints.filter((s) => s.status !== 'closed')
        : [];

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

  // 필터
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

  // 정렬
  const sortTasks = useCallback((tasks) => {
    if (!sortConfig.field) return tasks;
    const { field, direction } = sortConfig;
    const dir = direction === 'asc' ? 1 : -1;

    // workflow status sort_order 매핑
    const statusOrderMap = {};
    (workflowStatuses || []).forEach((ws, i) => {
      statusOrderMap[ws.key] = i;
    });

    return [...tasks].sort((a, b) => {
      let cmp = 0;
      switch (field) {
        case 'priority':
          cmp = (PRIORITY_WEIGHT[a.priority] ?? 4) - (PRIORITY_WEIGHT[b.priority] ?? 4);
          break;
        case 'due_date': {
          const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
          const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
          cmp = da - db;
          break;
        }
        case 'status':
          cmp = (statusOrderMap[a.status] ?? 999) - (statusOrderMap[b.status] ?? 999);
          break;
        case 'created':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        default:
          break;
      }
      return cmp * dir;
    });
  }, [sortConfig, workflowStatuses]);

  // 필터 + 정렬 적용
  const applyFilterAndSort = (tasks) => sortTasks(filterTasks(tasks));

  // 정렬 변경 핸들러 (null=해제, 3-state: null -> asc -> desc -> null)
  const handleSortChange = (field) => {
    if (field === null) {
      setSortConfig({ field: null, direction: 'asc' });
      return;
    }
    setSortConfig((prev) => {
      if (prev.field !== field) return { field, direction: 'asc' };
      if (prev.direction === 'asc') return { field, direction: 'desc' };
      return { field: null, direction: 'asc' };
    });
  };

  // 스프린트 접힘 토글
  const handleToggleCollapse = useCallback((sprintKey) => {
    setCollapsedSprints((prev) => {
      const next = new Set(prev);
      if (next.has(sprintKey)) next.delete(sprintKey);
      else next.add(sprintKey);
      return next;
    });
  }, []);

  // 태스크 선택 핸들러
  const handleTaskClick = useCallback((task, e) => {
    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl+Click: 다중 선택 토글
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        if (next.has(task.task_id)) next.delete(task.task_id);
        else next.add(task.task_id);
        return next;
      });
    } else {
      // 일반 클릭: 선택 초기화 + 패널 열기
      setSelectedTaskIds(new Set([task.task_id]));
      onSelectTask(task);
    }
  }, [onSelectTask]);

  // 모든 태스크의 컨테이너 매핑 (task_id → containerId)
  const getContainerId = (taskId) => {
    for (const sprint of sprints) {
      if ((sprint.tasks || []).some((t) => t.task_id === taskId)) {
        return `sprint-${sprint.sprint_id}`;
      }
    }
    if (backlogTasks.some((t) => t.task_id === taskId)) {
      return 'backlog';
    }
    return null;
  };

  // 활성 태스크 데이터 찾기
  const findTask = (taskId) => {
    for (const sprint of sprints) {
      const found = (sprint.tasks || []).find((t) => t.task_id === taskId);
      if (found) return found;
    }
    return backlogTasks.find((t) => t.task_id === taskId);
  };

  // DnD 핸들러
  const handleDragStart = (event) => {
    if (sortActive) return; // 정렬 중에는 드래그 비활성
    const { active } = event;
    const id = active.id;

    if (String(id).startsWith('sprint-')) {
      setActiveType('sprint');
      setActiveId(id);
    } else {
      setActiveType('task');
      setActiveId(id);
      // 드래그 시작한 태스크가 선택 목록에 없으면 단일 선택으로 전환
      const taskId = Number(id);
      if (!selectedTaskIds.has(taskId)) {
        setSelectedTaskIds(new Set([taskId]));
      }
    }
  };

  const handleDragOver = (event) => {
    const { over } = event;
    if (!over || activeType !== 'task') {
      setDragOverContainerId(null);
      return;
    }

    // over가 컨테이너인지 태스크인지 판별
    const overId = String(over.id);
    if (overId.startsWith('sprint-') || overId === 'backlog') {
      setDragOverContainerId(overId);
    } else {
      // over가 태스크 → 해당 태스크의 컨테이너 표시
      setDragOverContainerId(getContainerId(Number(overId)));
    }
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveType(null);
    setDragOverContainerId(null);

    if (!over || active.id === over.id) return;

    if (String(active.id).startsWith('sprint-')) {
      // 스프린트 순서 변경
      const oldIndex = sprints.findIndex((s) => `sprint-${s.sprint_id}` === active.id);
      const newIndex = sprints.findIndex((s) => `sprint-${s.sprint_id}` === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(sprints, oldIndex, newIndex);
      setSprints(reordered);

      try {
        await axios.post(`/branches/${branchId}/sprints/reorder`, {
          sprint_ids: reordered.map((s) => s.sprint_id),
        });
      } catch {
        fetchData(); // 실패 시 원복
      }
    } else {
      // 태스크 이동/순서 변경
      const draggedTaskId = Number(active.id);
      const movingIds = selectedTaskIds.has(draggedTaskId)
        ? [...selectedTaskIds]
        : [draggedTaskId];

      // 대상 컨테이너와 위치 결정
      const overId = String(over.id);
      let targetSprintId = null;
      let afterTaskId = null;

      if (overId === 'backlog') {
        targetSprintId = null;
        afterTaskId = null;
      } else if (overId.startsWith('sprint-')) {
        targetSprintId = Number(overId.replace('sprint-', ''));
        afterTaskId = null;
      } else {
        // over가 태스크
        const overTaskId = Number(overId);
        const overContainer = getContainerId(overTaskId);
        if (overContainer === 'backlog') {
          targetSprintId = null;
        } else if (overContainer) {
          targetSprintId = Number(overContainer.replace('sprint-', ''));
        }
        afterTaskId = overTaskId;
      }

      const movingIdSet = new Set(movingIds);
      const movingTasks = movingIds.map((id) => findTask(id)).filter(Boolean);

      // 소스 컨테이너 판별
      const sourceContainer = getContainerId(draggedTaskId);

      // 같은 컨테이너 내 단일 태스크 재정렬 → arrayMove 사용
      const isSameContainer =
        afterTaskId !== null &&
        movingIds.length === 1 &&
        sourceContainer === (targetSprintId !== null ? `sprint-${targetSprintId}` : 'backlog');

      if (isSameContainer) {
        if (sourceContainer === 'backlog') {
          const oldIdx = backlogTasks.findIndex((t) => t.task_id === draggedTaskId);
          const newIdx = backlogTasks.findIndex((t) => t.task_id === afterTaskId);
          if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;
          const reordered = arrayMove(backlogTasks, oldIdx, newIdx);
          setBacklogTasks(reordered);

          // afterTaskId = 새 위치 바로 앞 태스크 (서버에 전달)
          const finalIdx = reordered.findIndex((t) => t.task_id === draggedTaskId);
          const serverAfter = finalIdx > 0 ? reordered[finalIdx - 1].task_id : null;

          try {
            await axios.post(`/branches/${branchId}/tasks/reorder`, {
              task_ids: movingIds,
              sprint_id: null,
              after_task_id: serverAfter,
            });
          } catch {
            fetchData();
          }
        } else {
          const sprintId = Number(sourceContainer.replace('sprint-', ''));
          const newSprints = sprints.map((s) => {
            if (s.sprint_id !== sprintId) return s;
            const tasks = [...(s.tasks || [])];
            const oldIdx = tasks.findIndex((t) => t.task_id === draggedTaskId);
            const newIdx = tasks.findIndex((t) => t.task_id === afterTaskId);
            if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return s;
            return { ...s, tasks: arrayMove(tasks, oldIdx, newIdx) };
          });
          setSprints(newSprints);

          const sprint = newSprints.find((s) => s.sprint_id === sprintId);
          const reordered = sprint?.tasks || [];
          const finalIdx = reordered.findIndex((t) => t.task_id === draggedTaskId);
          const serverAfter = finalIdx > 0 ? reordered[finalIdx - 1].task_id : null;

          try {
            await axios.post(`/branches/${branchId}/tasks/reorder`, {
              task_ids: movingIds,
              sprint_id: sprintId,
              after_task_id: serverAfter,
            });
          } catch {
            fetchData();
          }
        }
        return;
      }

      // 크로스 컨테이너 이동 또는 다중 태스크 이동
      const newSprints = sprints.map((s) => ({
        ...s,
        tasks: (s.tasks || []).filter((t) => !movingIdSet.has(t.task_id)),
      }));
      let newBacklog = backlogTasks.filter((t) => !movingIdSet.has(t.task_id));

      if (targetSprintId === null) {
        if (afterTaskId !== null) {
          const idx = newBacklog.findIndex((t) => t.task_id === afterTaskId);
          if (idx !== -1) {
            newBacklog.splice(idx + 1, 0, ...movingTasks);
          } else {
            newBacklog = [...movingTasks, ...newBacklog];
          }
        } else {
          newBacklog = [...movingTasks, ...newBacklog];
        }
      } else {
        const sprintIdx = newSprints.findIndex((s) => s.sprint_id === targetSprintId);
        if (sprintIdx !== -1) {
          const tasks = newSprints[sprintIdx].tasks;
          if (afterTaskId !== null) {
            const idx = tasks.findIndex((t) => t.task_id === afterTaskId);
            if (idx !== -1) {
              tasks.splice(idx + 1, 0, ...movingTasks);
            } else {
              tasks.unshift(...movingTasks);
            }
          } else {
            tasks.unshift(...movingTasks);
          }
        }
      }

      setSprints(newSprints);
      setBacklogTasks(newBacklog);

      try {
        await axios.post(`/branches/${branchId}/tasks/reorder`, {
          task_ids: movingIds,
          sprint_id: targetSprintId,
          after_task_id: afterTaskId,
        });
      } catch {
        fetchData();
      }
    }
  };

  // 드래그 중 프리뷰 데이터
  const activeTask = activeId && activeType === 'task' ? findTask(Number(activeId)) : null;
  const dragCount = activeType === 'task' ? Math.max(selectedTaskIds.size, 1) : 0;

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: '#6B7280', fontSize: 14 }}>Loading...</div>;

  const sprintIds = sprints.map((s) => `sprint-${s.sprint_id}`);

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
          labels={labels}
          epics={epics}
          taskTypes={taskTypes}
          workflowStatuses={workflowStatuses}
          filters={filters}
          onToggleFilter={handleToggleFilter}
          onClearFilters={handleClearFilters}
          sortConfig={sortConfig}
          onSortChange={handleSortChange}
        />
        <button className="TaskList__SprintBtn" onClick={() => setSprintModal({ open: true, sprint: null })}>
          <Plus size={14} />
          Create Sprint
        </button>
      </div>

      <DndContext
        sensors={sortActive ? [] : sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Sprint 섹션들 (sortable) */}
        <SortableContext items={sprintIds} strategy={verticalListSortingStrategy}>
          {sprints.map((sprint) => (
            <TaskListSprint
              key={sprint.sprint_id}
              sprint={{ ...sprint, tasks: applyFilterAndSort(sprint.tasks) }}
              branchId={branchId}
              branchKey={branchKey}
              taskTypes={taskTypes}
              workflowStatuses={workflowStatuses}
              epics={epics}
              members={members}
              sprints={sprints}
              onEditTask={handleTaskClick}
              onTaskContextMenu={taskMenu.openMenu}
              onEditSprint={() => setSprintModal({ open: true, sprint })}
              onCompleteSprint={(s) => setCompleteSprint(s)}
              selectedTaskIds={selectedTaskIds}
              dragOverContainerId={dragOverContainerId}
              sortActive={sortActive}
              collapsed={collapsedSprints.has(sprint.sprint_id)}
              onToggleCollapse={() => handleToggleCollapse(sprint.sprint_id)}
            />
          ))}
        </SortableContext>

        {/* Backlog 섹션 (sortable 아님, droppable만) */}
        <TaskListSprint
          sprint={{ sprint_name: 'Backlog', status: 'backlog', tasks: applyFilterAndSort(backlogTasks) }}
          branchId={branchId}
          branchKey={branchKey}
          taskTypes={taskTypes}
          workflowStatuses={workflowStatuses}
          epics={epics}
          members={members}
          onEditTask={handleTaskClick}
          onTaskContextMenu={taskMenu.openMenu}
          isBacklog
          selectedTaskIds={selectedTaskIds}
          dragOverContainerId={dragOverContainerId}
          sortActive={sortActive}
          collapsed={collapsedSprints.has('backlog')}
          onToggleCollapse={() => handleToggleCollapse('backlog')}
        />

        {/* 드래그 오버레이 */}
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="TaskList__DragOverlay">
              <TaskListRow
                task={activeTask}
                branchId={branchId}
                taskTypes={taskTypes}
                workflowStatuses={workflowStatuses}
                epics={epics}
                members={members}
                isOverlay
              />
              {dragCount > 1 && (
                <div className="TaskList__DragBadge">{dragCount}</div>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

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
          sprints={sprints.filter((s) => s.sprint_id !== completeSprint.sprint_id && (s.status === 'future' || s.status === 'active'))}
          onClose={() => setCompleteSprint(null)}
        />
      )}

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
