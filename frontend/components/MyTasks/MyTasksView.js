import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { CheckSquare, Inbox } from 'lucide-react';
import { axios } from '@/library/_axios';
import CustomSelect from '@/components/common/CustomSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';

const statusOptions = [
  { value: 'todo', label: 'To Do', color: '#9CA3AF' },
  { value: 'in_progress', label: 'In Progress', color: '#2563EB' },
  { value: 'in_review', label: 'In Review', color: '#F59E0B' },
  { value: 'done', label: 'Done', color: '#16A34A' },
];

const priorityOptions = [
  { value: 'urgent', label: 'Urgent', color: '#DC2626' },
  { value: 'high', label: 'High', color: '#F59E0B' },
  { value: 'medium', label: 'Medium', color: '#5E6AD2' },
  { value: 'low', label: 'Low', color: '#9CA3AF' },
];

const sortOptions = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due Date' },
];

export default function MyTasksView() {
  const router = useRouter();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '', priority: '', branch_id: '', sort_by: 'updated',
  });

  const fetchTasks = useCallback(async () => {
    const params = { sort_by: filters.sort_by };
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.branch_id) params.branch_id = filters.branch_id;

    try {
      const res = await axios.get('/my-tasks', { params });
      if (res.data.status) setTasks(res.data.tasks);
    } catch {}
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const handler = () => fetchTasks();
    window.addEventListener('task:updated', handler);
    return () => window.removeEventListener('task:updated', handler);
  }, [fetchTasks]);

  // 응답 데이터에서 브랜치 목록 추출
  const branches = [...new Map(
    tasks.map((t) => [t.branch_id, { branch_id: t.branch_id, branch_name: t.branch_name, branch_key: t.branch_key }])
  ).values()];

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="MyTasks">
      <div className="MyTasks__Header">
        <CheckSquare size={20} className="MyTasks__HeaderIcon" />
        <h2 className="MyTasks__Title">My Tasks</h2>
        {!loading && <span className="MyTasks__Count">{tasks.length}</span>}
      </div>

      {/* 필터 바 */}
      <div className="MyTasks__FilterBar">
        <select
          className="MyTasks__Filter"
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
        >
          <option value="">All Status</option>
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          className="MyTasks__Filter"
          value={filters.priority}
          onChange={(e) => updateFilter('priority', e.target.value)}
        >
          <option value="">All Priority</option>
          {priorityOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          className="MyTasks__Filter"
          value={filters.branch_id}
          onChange={(e) => updateFilter('branch_id', e.target.value)}
        >
          <option value="">All Branches</option>
          {branches.map((b) => (
            <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
          ))}
        </select>

        <select
          className="MyTasks__Filter MyTasks__Filter--sort"
          value={filters.sort_by}
          onChange={(e) => updateFilter('sort_by', e.target.value)}
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>Sort: {o.label}</option>
          ))}
        </select>
      </div>

      {/* 테이블 */}
      <div className="MyTasks__Table">
        <div className="MyTasks__TableHeader">
          <span />
          <span>ID</span>
          <span>Title</span>
          <span />
          <span>Branch</span>
          <span>Status</span>
          <span>Due</span>
          <span>Priority</span>
        </div>

        {loading ? (
          <div className="MyTasks__Empty">Loading...</div>
        ) : tasks.length === 0 ? (
          <div className="MyTasks__Empty">
            <Inbox size={32} className="MyTasks__EmptyIcon" />
            <p>No tasks assigned to you.</p>
          </div>
        ) : (
          tasks.map((task) => (
            <MyTasksRow key={task.task_id} task={task} onRefresh={fetchTasks} />
          ))
        )}
      </div>
    </div>
  );
}

// -- Row --
function MyTasksRow({ task, onRefresh }) {
  const router = useRouter();

  const handleFieldChange = async (field, value) => {
    try {
      await axios.patch(`/branches/${task.branch_id}/tasks/${task.task_id}`, { [field]: value });
      window.dispatchEvent(new Event('task:updated'));
    } catch {}
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
  };

  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date();

  return (
    <div
      className="MyTasksRow"
      onClick={() => router.push(`/branch/${task.branch_id}/task/${task.task_id}`)}
    >
      {/* 타입 아이콘 */}
      <span className="MyTasksRow__TypeIcon">
        <TaskTypeIcon name="CheckSquare" size={14} color="#5E6AD2" />
      </span>

      {/* Display ID */}
      <span className="MyTasksRow__Id">{task.display_id}</span>

      {/* 제목 */}
      <span className="MyTasksRow__Title">{task.title}</span>

      {/* 라벨 */}
      <div className="MyTasksRow__Labels">
        {(task.labels || []).map((label) => (
          <span
            key={label.label_id}
            className="MyTasksRow__Label"
            style={{ backgroundColor: label.color + '20', color: label.color }}
          >
            {label.label_name}
          </span>
        ))}
      </div>

      {/* 브랜치 */}
      <button
        className="MyTasksRow__Branch"
        onClick={(e) => {
          e.stopPropagation();
          router.push(`/branch/${task.branch_id}`);
        }}
      >
        <span className="MyTasksRow__BranchDot" style={{ backgroundColor: task.branch_color || '#5E6AD2' }} />
        {task.branch_key}
      </button>

      {/* 상태 (인라인 변경) */}
      <div className="MyTasksRow__Cell" onClick={(e) => e.stopPropagation()}>
        <CustomSelect
          value={task.status}
          options={statusOptions}
          onChange={(val) => handleFieldChange('status', val)}
          size="sm"
          hideArrow
          className={`MyTasksRow__Status MyTasksRow__Status--${task.status}`}
        />
      </div>

      {/* 마감일 */}
      <span className={`MyTasksRow__DueDate ${isOverdue ? 'MyTasksRow__DueDate--overdue' : ''}`}>
        {formatDate(task.due_date)}
      </span>

      {/* 우선순위 (인라인 변경) */}
      <div className="MyTasksRow__Cell" onClick={(e) => e.stopPropagation()}>
        <CustomSelect
          value={task.priority || 'low'}
          options={priorityOptions}
          onChange={(val) => handleFieldChange('priority', val)}
          size="sm"
          hideArrow
          className={`MyTasksRow__Priority MyTasksRow__Priority--${task.priority || 'low'}`}
        />
      </div>
    </div>
  );
}
