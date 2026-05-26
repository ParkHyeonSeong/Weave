import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { X, Zap, Calendar, Filter, ChevronDown } from 'lucide-react';
import { axios } from '@/library/_axios';

// mode: 'epic' | 'sprint' | 'filter'
const MODE_META = {
  epic: { label: 'Add by Epic', icon: Zap, hint: '한 epic의 모든 task' },
  sprint: { label: 'Add by Sprint', icon: Calendar, hint: 'sprint의 task 일괄' },
  filter: { label: 'Add by Filter', icon: Filter, hint: '조건에 맞는 task' },
};

const STATUS_CATEGORIES = [
  { value: '', label: 'Any status' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
];

const PRIORITIES = [
  { value: '', label: 'Any priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function BulkAddModal({
  mode, trackId, participatingBranches, onClose, onAdded,
}) {
  const meta = MODE_META[mode];
  const [branchId, setBranchId] = useState(
    participatingBranches.length === 1 ? participatingBranches[0].branch_id : null
  );
  const [epics, setEpics] = useState([]);
  const [epicId, setEpicId] = useState(null);
  const [sprints, setSprints] = useState([]);
  const [sprintId, setSprintId] = useState(null);
  const [filterStatusCat, setFilterStatusCat] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [tasks, setTasks] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 빠른 필터 변경 시 늦게 도착한 응답이 새 결과를 덮어쓰지 않도록 sequence id 가드
  const fetchSeqRef = useRef(0);

  // ESC 닫기
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Epic / Sprint 모드: branch 선택 시 목록 로드
  useEffect(() => {
    if (mode === 'epic' && branchId) {
      setLoading(true);
      axios.get(`/branches/${branchId}/epics`)
        .then((res) => { if (res.data.status) setEpics(res.data.epics); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    if (mode === 'sprint' && branchId) {
      setLoading(true);
      axios.get(`/branches/${branchId}/sprints`)
        .then((res) => { if (res.data.status) setSprints(res.data.sprints); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [mode, branchId]);

  // 선택한 epic/sprint → tasks 미리보기. 빠른 필터 변경 시 stale 응답 무시.
  const fetchTasks = useCallback(async () => {
    const mySeq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      let res;
      if (mode === 'epic' && epicId) {
        res = await axios.get(`/branches/${branchId}/epics/${epicId}/tasks`);
      } else if (mode === 'sprint' && sprintId) {
        res = await axios.get(`/branches/${branchId}/tasks`, {
          params: { sprint_id: sprintId },
        });
      } else if (mode === 'filter') {
        const params = { q: '', limit: 200 };
        if (branchId) params.branch_id = branchId;
        if (filterStatusCat) params.status_category = filterStatusCat;
        if (filterPriority) params.priority = filterPriority;
        res = await axios.get(`/tracks/${trackId}/sources`, { params });
      }
      if (mySeq !== fetchSeqRef.current) return;  // 후속 호출이 이미 시작됨
      if (res?.data?.status) {
        // filter 응답은 tasks, epic/sprint 응답도 tasks
        setTasks(res.data.tasks || []);
      } else {
        setTasks([]);
      }
    } catch {
      if (mySeq === fetchSeqRef.current) setTasks([]);
    }
    if (mySeq === fetchSeqRef.current) setLoading(false);
  }, [mode, trackId, branchId, epicId, sprintId, filterStatusCat, filterPriority]);

  useEffect(() => {
    setTasks([]);
    setSelectedIds(new Set());
    if (mode === 'epic' && epicId) fetchTasks();
    else if (mode === 'sprint' && sprintId) fetchTasks();
    else if (mode === 'filter' && branchId) fetchTasks();
  }, [mode, epicId, sprintId, branchId, filterStatusCat, filterPriority, fetchTasks]);

  // 결과 받아왔을 때 in_track 아닌 task 자동 선택 — 사용자가 빨리 적용하게
  useEffect(() => {
    if (tasks.length === 0) return;
    const next = new Set();
    tasks.forEach((t) => {
      if (!t.in_track) next.add(t.task_id);
    });
    setSelectedIds(next);
  }, [tasks]);

  const toggleTask = (taskId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    const addable = tasks.filter((t) => !t.in_track);
    if (selectedIds.size === addable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(addable.map((t) => t.task_id)));
    }
  };

  const addableTasks = useMemo(() => tasks.filter((t) => !t.in_track), [tasks]);
  const allSelected = addableTasks.length > 0 && selectedIds.size === addableTasks.length;

  const handleSubmit = async () => {
    if (selectedIds.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await axios.post(`/tracks/${trackId}/items/bulk`, {
        source_task_ids: [...selectedIds],
      });
      if (res.data.status) {
        onAdded(res.data.added);
      } else {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: `추가 실패: ${res.data.message}`, type: 'error' },
        }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: '추가 실패', type: 'error' },
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const Icon = meta.icon;

  return (
    <div className="BulkAdd__Backdrop" onClick={onClose}>
      <div className="BulkAdd" onClick={(e) => e.stopPropagation()}>
        <header className="BulkAdd__Head">
          <div className="BulkAdd__Title">
            <Icon size={16} />
            <span>{meta.label}</span>
          </div>
          <button className="BulkAdd__Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        {/* 조건 영역 */}
        <div className="BulkAdd__Filters">
          <label className="BulkAdd__Field">
            <span className="BulkAdd__FieldLabel">Branch</span>
            <div className="BulkAdd__Select">
              <select
                value={branchId ?? ''}
                onChange={(e) => {
                  setBranchId(e.target.value ? Number(e.target.value) : null);
                  setEpicId(null);
                  setSprintId(null);
                }}
              >
                <option value="">— 선택 —</option>
                {participatingBranches.map((b) => (
                  <option key={b.branch_id} value={b.branch_id}>{b.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="BulkAdd__SelectCaret" />
            </div>
          </label>

          {mode === 'epic' && branchId && (
            <label className="BulkAdd__Field">
              <span className="BulkAdd__FieldLabel">Epic</span>
              <div className="BulkAdd__Select">
                <select
                  value={epicId ?? ''}
                  onChange={(e) => setEpicId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— 선택 —</option>
                  {epics.map((ep) => (
                    <option key={ep.epic_id} value={ep.epic_id}>
                      {ep.epic_name} ({ep.task_count || 0})
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="BulkAdd__SelectCaret" />
              </div>
            </label>
          )}

          {mode === 'sprint' && branchId && (
            <label className="BulkAdd__Field">
              <span className="BulkAdd__FieldLabel">Sprint</span>
              <div className="BulkAdd__Select">
                <select
                  value={sprintId ?? ''}
                  onChange={(e) => setSprintId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— 선택 —</option>
                  {sprints.map((sp) => (
                    <option key={sp.sprint_id} value={sp.sprint_id}>
                      {sp.sprint_name} {sp.status === 'active' ? '(active)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="BulkAdd__SelectCaret" />
              </div>
            </label>
          )}

          {mode === 'filter' && (
            <>
              <label className="BulkAdd__Field">
                <span className="BulkAdd__FieldLabel">Status</span>
                <div className="BulkAdd__Select">
                  <select value={filterStatusCat} onChange={(e) => setFilterStatusCat(e.target.value)}>
                    {STATUS_CATEGORIES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="BulkAdd__SelectCaret" />
                </div>
              </label>
              <label className="BulkAdd__Field">
                <span className="BulkAdd__FieldLabel">Priority</span>
                <div className="BulkAdd__Select">
                  <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="BulkAdd__SelectCaret" />
                </div>
              </label>
            </>
          )}
        </div>

        {/* 결과 영역 */}
        <div className="BulkAdd__Results">
          {loading && <div className="BulkAdd__Empty">Loading…</div>}
          {!loading && tasks.length === 0 && (
            <div className="BulkAdd__Empty">
              {mode === 'epic' && !epicId && <>Epic을 선택하세요</>}
              {mode === 'sprint' && !sprintId && <>Sprint를 선택하세요</>}
              {mode === 'filter' && !branchId && <>Branch와 조건을 선택하세요</>}
              {((mode === 'epic' && epicId) ||
                (mode === 'sprint' && sprintId) ||
                (mode === 'filter' && branchId)) && <>조건에 맞는 task 없음</>}
            </div>
          )}
          {!loading && tasks.length > 0 && (
            <>
              <div className="BulkAdd__SelectAll">
                <label>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                  <span>
                    {selectedIds.size} of {addableTasks.length} selected
                    {tasks.length - addableTasks.length > 0 && (
                      <em> · {tasks.length - addableTasks.length} already on canvas</em>
                    )}
                  </span>
                </label>
              </div>
              <ul className="BulkAdd__TaskList">
                {tasks.map((t) => {
                  const checked = selectedIds.has(t.task_id);
                  return (
                    <li key={t.task_id}>
                      <label className={`BulkAdd__Task ${t.in_track ? 'BulkAdd__Task--used' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTask(t.task_id)}
                          disabled={t.in_track}
                        />
                        <span
                          className="BulkAdd__TaskBranchBar"
                          style={{ background: t.branch_color || '#9CA3AF' }}
                        />
                        <span className="BulkAdd__TaskId">
                          {t.branch_key}-{t.display_number}
                        </span>
                        <span className="BulkAdd__TaskTitle">{t.title}</span>
                        {t.in_track && <span className="BulkAdd__TaskBadge">on canvas</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <footer className="BulkAdd__Foot">
          <button className="BulkAdd__Btn BulkAdd__Btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="BulkAdd__Btn BulkAdd__Btn--primary"
            onClick={handleSubmit}
            disabled={selectedIds.size === 0 || submitting}
          >
            {submitting ? 'Adding…' : `Add ${selectedIds.size > 0 ? `(${selectedIds.size})` : ''}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
