import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search, ChevronDown, ChevronRight, GripVertical, Plus, Filter, Layers, Calendar, Zap, X } from 'lucide-react';
import { axios } from '@/library/_axios';

const PICKER_DATA_MIME = 'application/x-track-source';
const SEARCH_DEBOUNCE_MS = 220;

export default function SourcePickerSidebar({
  trackId,
  participatingBranchIds,
  onManageBranches,
  onBulkAdd,
  onUnparticipateBranch,
  reloadKey,
}) {
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openBranches, setOpenBranches] = useState(() => new Set(participatingBranchIds || []));
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  const searchTimerRef = useRef(null);

  // participating 변경 시 open 셋 동기화
  useEffect(() => {
    setOpenBranches(new Set(participatingBranchIds || []));
  }, [participatingBranchIds]);

  // 검색 — debounced
  const runSearch = useCallback(async () => {
    if (!trackId) return;
    setLoading(true);
    try {
      const res = await axios.get(`/tracks/${trackId}/sources`, {
        params: { q: query, limit: 80 },
      });
      if (res.data.status) setTasks(res.data.tasks);
    } catch {}
    setLoading(false);
  }, [trackId, query]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [runSearch, reloadKey]);

  // task를 branch별로 group
  const grouped = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => {
      if (!map.has(t.branch_id)) {
        map.set(t.branch_id, {
          branch_id: t.branch_id,
          name: t.branch_name,
          key: t.branch_key,
          color: t.branch_color,
          tasks: [],
        });
      }
      map.get(t.branch_id).tasks.push(t);
    });
    return Array.from(map.values());
  }, [tasks]);

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuOpen]);

  const toggleBranch = (id) => {
    setOpenBranches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDragStart = (e, task) => {
    const payload = {
      task_id: task.task_id,
      display_id: task.display_id,
      title: task.title,
      status: task.status,
      branch_id: task.branch_id,
    };
    e.dataTransfer.setData(PICKER_DATA_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const totalAccessible = tasks.length;
  const totalNew = tasks.filter((t) => !t.in_track).length;

  return (
    <aside className="SourcePicker">
      <div className="SourcePicker__Head">
        <span className="SourcePicker__HeadLabel">Sources</span>
        <div className="SourcePicker__HeadActions" ref={addMenuRef}>
          <button
            className={`SourcePicker__AddBtn ${addMenuOpen ? 'SourcePicker__AddBtn--open' : ''}`}
            onClick={() => setAddMenuOpen((p) => !p)}
            title="Bulk add"
          >
            <Plus size={12} />
            <span>Add by</span>
            <ChevronDown size={11} className="SourcePicker__AddCaret" />
          </button>
          {addMenuOpen && (
            <div className="SourcePicker__AddMenu" role="menu">
              <button
                className="SourcePicker__AddMenuItem"
                onClick={() => { setAddMenuOpen(false); onBulkAdd?.('epic'); }}
              >
                <Zap size={13} />
                <div className="SourcePicker__AddMenuText">
                  <span className="SourcePicker__AddMenuLabel">Epic</span>
                  <span className="SourcePicker__AddMenuHint">한 epic의 모든 task</span>
                </div>
              </button>
              <button
                className="SourcePicker__AddMenuItem"
                onClick={() => { setAddMenuOpen(false); onBulkAdd?.('sprint'); }}
              >
                <Calendar size={13} />
                <div className="SourcePicker__AddMenuText">
                  <span className="SourcePicker__AddMenuLabel">Sprint</span>
                  <span className="SourcePicker__AddMenuHint">sprint의 task 일괄</span>
                </div>
              </button>
              <button
                className="SourcePicker__AddMenuItem"
                onClick={() => { setAddMenuOpen(false); onBulkAdd?.('filter'); }}
              >
                <Filter size={13} />
                <div className="SourcePicker__AddMenuText">
                  <span className="SourcePicker__AddMenuLabel">Filter</span>
                  <span className="SourcePicker__AddMenuHint">조건에 맞는 task</span>
                </div>
              </button>
              <div className="SourcePicker__AddMenuDivider" />
              <button className="SourcePicker__AddMenuItem" onClick={() => { setAddMenuOpen(false); onManageBranches(); }}>
                <Layers size={13} />
                <div className="SourcePicker__AddMenuText">
                  <span className="SourcePicker__AddMenuLabel">Manage branches…</span>
                  <span className="SourcePicker__AddMenuHint">참여 branch 추가/제거</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="SourcePicker__SearchWrap">
        <Search size={14} className="SourcePicker__SearchIcon" />
        <input
          type="text"
          className="SourcePicker__SearchInput"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="SourcePicker__Tree">
        {loading && tasks.length === 0 && (
          <div className="SourcePicker__Empty">Loading…</div>
        )}
        {!loading && tasks.length === 0 && (
          <div className="SourcePicker__Empty">
            {(participatingBranchIds || []).length === 0 ? (
              <>
                <div className="SourcePicker__EmptyTitle">No branches yet</div>
                <div className="SourcePicker__EmptyHint">
                  먼저 참여할 branch를 추가하세요.
                </div>
              </>
            ) : query.trim() ? (
              <>No matches for &ldquo;{query}&rdquo;</>
            ) : (
              <>No accessible tasks</>
            )}
          </div>
        )}
        {grouped.map((branch) => {
          const branchOpen = openBranches.has(branch.branch_id);
          return (
            <div key={branch.branch_id} className="SourcePicker__Branch">
              <div
                className="SourcePicker__BranchRow"
                onClick={() => toggleBranch(branch.branch_id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleBranch(branch.branch_id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="SourcePicker__Chevron">
                  {branchOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                <span
                  className="SourcePicker__BranchDot"
                  style={{ background: branch.color, boxShadow: `0 0 0 3px ${branch.color}22` }}
                />
                <span className="SourcePicker__BranchName">{branch.name}</span>
                <span className="SourcePicker__BranchKey">{branch.key}</span>
                {onUnparticipateBranch && (
                  <button
                    className="SourcePicker__BranchUnparticipate"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnparticipateBranch(branch.branch_id, branch.name);
                    }}
                    title="Track에서 이 branch 빼기 (이 branch의 모든 item도 함께 제거)"
                    aria-label="Remove branch from track"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              {branchOpen && branch.tasks.map((task) => (
                <div
                  key={task.task_id}
                  className={`SourcePicker__Task ${task.in_track ? 'SourcePicker__Task--used' : ''}`}
                  draggable={!task.in_track}
                  onDragStart={(e) => !task.in_track && handleDragStart(e, task)}
                  title={task.in_track ? '이미 캔버스에 있음' : '드래그하여 캔버스에 추가'}
                >
                  <span className="SourcePicker__TaskGrip">
                    <GripVertical size={11} />
                  </span>
                  <span
                    className="SourcePicker__TaskBranchBar"
                    style={{ background: branch.color }}
                  />
                  <span className="SourcePicker__TaskId">{task.display_id}</span>
                  <span className="SourcePicker__TaskTitle">{task.title}</span>
                  {task.in_track && <span className="SourcePicker__TaskBadge">on canvas</span>}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {totalAccessible > 0 && (
        <div className="SourcePicker__Foot">
          <span className="SourcePicker__FootHint">
            {totalNew} of {totalAccessible} draggable
          </span>
        </div>
      )}
    </aside>
  );
}

export { PICKER_DATA_MIME };
