import { useMemo, useState, useRef, useEffect } from 'react';
import { Search, User, X, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Plus, Bookmark, ChevronDown, Pencil, Trash2, Pin } from 'lucide-react';
import MultiSelect from '@/components/common/MultiSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import Avatar from '@/components/common/Avatar';
import { isEmptySpec, emptyGroup } from '@/library/filterBuilderState';
import FilterBuilder from './FilterBuilder';

const MAX_VISIBLE = 5;

const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'status', label: 'Status' },
  { value: 'created', label: 'Created' },
];

// 그룹핑 키 (taskViewState.groupTasks의 KEY와 의미 일치)
const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'epic', label: 'Epic' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'label', label: 'Label' },
  { value: 'priority', label: 'Priority' },
];

// 다중정렬 키 = SORT_OPTIONS에서 'status' 제외. 다중정렬은 taskViewState.applySort로 평가되는데
// 'status'는 워크플로 순서(sort_order)가 클라이언트 페이로드에 없어 의미 있게 정렬되지 않는다.
// (레거시 단일키 Sort 버튼은 SORT_OPTIONS를 그대로 써 status=워크플로 순서로 올바르게 정렬한다.)
const MULTI_SORT_FIELDS = SORT_OPTIONS.filter((o) => o.value !== 'status');

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', color: '#DC2626' },
  { value: 'high', label: 'High', color: '#F59E0B' },
  { value: 'medium', label: 'Medium', color: '#5E6AD2' },
  { value: 'low', label: 'Low', color: '#9CA3AF' },
];

export default function TaskFilterBar({
  members, searchQuery, onSearchChange, selectedUserIds, onToggleUser,
  labels = [], epics = [], taskTypes = [], workflowStatuses = [],
  filters = {}, onToggleFilter, onClearFilters,
  sortConfig, onSortChange,
  // 고급 빌더 + 그룹핑 + 다중정렬 (Task 4.4)
  filterSpec, onFilterSpecChange,
  groupBy = 'none', onGroupByChange,
  sort = [], onMultiSortChange,
  customFields = [],
  availableFields,
  groupByOptions,
  // 저장된 뷰 스위처 (Phase 2 — onApplyView 있을 때만 렌더; Board 등 미사용 호출자엔 미노출)
  savedViews = [], activeViewId = null, onApplyView, onSaveView, onUpdateView, onDeleteView,
  pinnedViewIds = [], onTogglePin,
}) {
  // 호출자가 group-by 옵션을 제한할 수 있다(예: Board는 payload가 epic_id/sprint_id 미포함).
  // 미지정 시 전체 GROUP_BY_OPTIONS. 'none'은 항상 유지(그룹핑 해제 보장).
  const groupOptions = groupByOptions
    ? GROUP_BY_OPTIONS.filter((o) => o.value === 'none' || groupByOptions.includes(o.value))
    : GROUP_BY_OPTIONS;
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedRef = useRef(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewsRef = useRef(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saveRef = useRef(null);

  // 고급 패널 외부 클릭 닫기
  useEffect(() => {
    if (!advancedOpen) return;
    const handleClick = (e) => {
      if (advancedRef.current && !advancedRef.current.contains(e.target)) setAdvancedOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [advancedOpen]);

  // 뷰 메뉴 / 저장 팝오버 외부 클릭 닫기
  useEffect(() => {
    if (!viewsOpen) return;
    const handleClick = (e) => {
      if (viewsRef.current && !viewsRef.current.contains(e.target)) setViewsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [viewsOpen]);
  useEffect(() => {
    if (!saveOpen) return;
    const handleClick = (e) => {
      if (saveRef.current && !saveRef.current.contains(e.target)) setSaveOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [saveOpen]);

  const activeView = savedViews.find((v) => v.view_id === activeViewId) || null;
  const submitSave = () => {
    const n = saveName.trim();
    if (!n) return;
    onSaveView(n);
    setSaveName('');
    setSaveOpen(false);
  };

  const advancedActive = !isEmptySpec(filterSpec);

  // 외부 클릭 닫기
  useEffect(() => {
    if (!sortOpen) return;
    const handleClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sortOpen]);

  // 멤버 +N 팝오버 외부 클릭 닫기
  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);
  const visibleMembers = members.slice(0, MAX_VISIBLE);
  const remaining = members.length - MAX_VISIBLE;

  // 활성 필터 총 개수
  const activeCount = useMemo(() => {
    return (filters.priorities?.size || 0)
      + (filters.labelIds?.size || 0)
      + (filters.epicIds?.size || 0)
      + (filters.typeKeys?.size || 0)
      + (filters.statusKeys?.size || 0);
  }, [filters]);

  // 활성 필터 칩 목록
  const activeChips = useMemo(() => {
    const chips = [];
    (filters.priorities || new Set()).forEach((v) => {
      const opt = PRIORITY_OPTIONS.find((o) => o.value === v);
      if (opt) chips.push({ category: 'priorities', value: v, label: opt.label, color: opt.color });
    });
    (filters.statusKeys || new Set()).forEach((v) => {
      const ws = workflowStatuses.find((s) => s.key === v);
      if (ws) chips.push({ category: 'statusKeys', value: v, label: ws.label, color: ws.color });
    });
    (filters.typeKeys || new Set()).forEach((v) => {
      const tt = taskTypes.find((t) => t.type_key === v);
      if (tt) chips.push({ category: 'typeKeys', value: v, label: tt.type_name });
    });
    (filters.labelIds || new Set()).forEach((v) => {
      const lb = labels.find((l) => l.label_id === v);
      if (lb) chips.push({ category: 'labelIds', value: v, label: lb.label_name, color: lb.color });
    });
    (filters.epicIds || new Set()).forEach((v) => {
      const ep = epics.find((e) => e.epic_id === v);
      if (ep) chips.push({ category: 'epicIds', value: v, label: ep.epic_name, color: ep.color });
    });
    return chips;
  }, [filters, labels, epics, taskTypes, workflowStatuses]);

  return (
    <div className="TaskFilterBar">
      {/* 저장된 뷰 스위처 + 저장 (onApplyView 제공 시에만) */}
      {onApplyView && (
        <div className="TaskFilterBar__Views" ref={viewsRef}>
          <button
            type="button"
            className={`TaskFilterBar__ViewsBtn ${activeViewId ? 'TaskFilterBar__ViewsBtn--active' : ''}`}
            onClick={() => setViewsOpen((p) => !p)}
            title="저장된 뷰"
          >
            <Bookmark size={13} />
            {activeView ? activeView.name : '뷰'}
            <ChevronDown size={11} />
          </button>
          {viewsOpen && (
            <div className="TaskFilterBar__ViewsMenu">
              {savedViews.length === 0 ? (
                <div className="TaskFilterBar__ViewsEmpty">저장된 뷰가 없습니다</div>
              ) : (
                savedViews.map((v) => (
                  <div
                    key={v.view_id}
                    className={`TaskFilterBar__ViewRow ${v.view_id === activeViewId ? 'TaskFilterBar__ViewRow--active' : ''}`}
                  >
                    <button
                      type="button"
                      className="TaskFilterBar__ViewApply"
                      onClick={() => { onApplyView(v.view_id); setViewsOpen(false); }}
                    >
                      {v.name}
                      {!v.is_owner && <span className="TaskFilterBar__ViewShared">공유</span>}
                    </button>
                    {onTogglePin && (
                      <button
                        type="button"
                        className={`TaskFilterBar__ViewPin ${pinnedViewIds.includes(v.view_id) ? 'TaskFilterBar__ViewPin--on' : ''}`}
                        onClick={() => onTogglePin(v.view_id)}
                        title={pinnedViewIds.includes(v.view_id) ? '사이드바 고정 해제' : '사이드바에 고정'}
                      >
                        <Pin size={12} />
                      </button>
                    )}
                    {v.is_owner && (
                      <>
                        <button
                          type="button"
                          className="TaskFilterBar__ViewEdit"
                          onClick={() => onUpdateView(v.view_id)}
                          title="현재 필터로 덮어쓰기"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          className="TaskFilterBar__ViewDelete"
                          onClick={() => onDeleteView(v.view_id)}
                          title="삭제"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="TaskFilterBar__ViewSave" ref={saveRef}>
            <button
              type="button"
              className="TaskFilterBar__ViewSaveBtn"
              onClick={() => setSaveOpen((p) => !p)}
              title="현재 필터를 뷰로 저장"
            >
              <Plus size={12} />
              저장
            </button>
            {saveOpen && (
              <div className="TaskFilterBar__ViewSavePopover">
                <input
                  className="TaskFilterBar__ViewSaveInput"
                  placeholder="뷰 이름"
                  value={saveName}
                  autoFocus
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitSave(); }}
                />
                <button
                  type="button"
                  className="TaskFilterBar__ViewSaveConfirm"
                  disabled={!saveName.trim()}
                  onClick={submitSave}
                >
                  저장
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 검색 */}
      <div className="TaskFilterBar__Search">
        <Search size={14} className="TaskFilterBar__SearchIcon" />
        <input
          className="TaskFilterBar__SearchInput"
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* 필터 드롭다운들 */}
      {onToggleFilter && (
        <div className="TaskFilterBar__Filters">
          <MultiSelect
            label="Priority"
            selectedValues={filters.priorities || new Set()}
            options={PRIORITY_OPTIONS}
            onToggle={(val) => onToggleFilter('priorities', val)}
          />

          {workflowStatuses.length > 0 && (
            <MultiSelect
              label="Status"
              selectedValues={filters.statusKeys || new Set()}
              options={workflowStatuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))}
              onToggle={(val) => onToggleFilter('statusKeys', val)}
            />
          )}

          {taskTypes.length > 0 && (
            <MultiSelect
              label="Type"
              selectedValues={filters.typeKeys || new Set()}
              options={taskTypes.map((tt) => ({
                value: tt.type_key,
                label: tt.type_name,
                icon: <TaskTypeIcon name={tt.icon} size={12} color={tt.color} />,
              }))}
              onToggle={(val) => onToggleFilter('typeKeys', val)}
            />
          )}

          {labels.length > 0 && (
            <MultiSelect
              label="Label"
              selectedValues={filters.labelIds || new Set()}
              options={labels.map((lb) => ({ value: lb.label_id, label: lb.label_name, color: lb.color }))}
              onToggle={(val) => onToggleFilter('labelIds', val)}
            />
          )}

          {epics.length > 0 && (
            <MultiSelect
              label="Epic"
              selectedValues={filters.epicIds || new Set()}
              options={epics.map((ep) => ({ value: ep.epic_id, label: ep.epic_name, color: ep.color || '#5E6AD2' }))}
              onToggle={(val) => onToggleFilter('epicIds', val)}
            />
          )}

          {activeCount > 0 && (
            <button
              type="button"
              className="TaskFilterBar__ClearAll"
              onClick={onClearFilters}
            >
              <X size={12} />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Sort 드롭다운 */}
      {onSortChange && (
        <div className="TaskFilterBar__Sort" ref={sortRef}>
          <button
            type="button"
            className={`TaskFilterBar__SortBtn ${sortConfig?.field ? 'TaskFilterBar__SortBtn--active' : ''}`}
            onClick={() => setSortOpen((prev) => !prev)}
          >
            <ArrowUpDown size={13} />
            {sortConfig?.field
              ? `${SORT_OPTIONS.find((o) => o.value === sortConfig.field)?.label || 'Sort'}`
              : 'Sort'}
            {sortConfig?.field && (
              sortConfig.direction === 'asc'
                ? <ArrowUp size={11} />
                : <ArrowDown size={11} />
            )}
          </button>
          {sortConfig?.field && (
            <button
              type="button"
              className="TaskFilterBar__SortClear"
              onClick={() => onSortChange(null)}
              title="Clear sort"
            >
              <X size={12} />
            </button>
          )}
          {sortOpen && (
            <div className="TaskFilterBar__SortDropdown">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`TaskFilterBar__SortOption ${sortConfig?.field === opt.value ? 'TaskFilterBar__SortOption--active' : ''}`}
                  onClick={() => {
                    onSortChange(opt.value);
                    if (sortConfig?.field === opt.value && sortConfig?.direction === 'desc') {
                      setSortOpen(false);
                    }
                  }}
                >
                  <span>{opt.label}</span>
                  {sortConfig?.field === opt.value && (
                    sortConfig.direction === 'asc'
                      ? <ArrowUp size={12} />
                      : <ArrowDown size={12} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Group by 드롭다운 */}
      {onGroupByChange && (
        <div className="TaskFilterBar__GroupBy">
          <select
            className={`TaskFilterBar__GroupBySelect ${groupBy !== 'none' ? 'TaskFilterBar__GroupBySelect--active' : ''}`}
            value={groupBy}
            onChange={(e) => onGroupByChange(e.target.value)}
            title="Group tasks by"
          >
            {groupOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'none' ? o.label : `Group: ${o.label}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 고급 필터 빌더 토글 + 패널 */}
      {onFilterSpecChange && (
        <div className="TaskFilterBar__Advanced" ref={advancedRef}>
          <button
            type="button"
            className={`TaskFilterBar__AdvancedBtn ${advancedActive ? 'TaskFilterBar__AdvancedBtn--active' : ''}`}
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            <SlidersHorizontal size={13} />
            고급 필터
          </button>
          {advancedOpen && (
            <div className="TaskFilterBar__AdvancedPanel">
              <div className="TaskFilterBar__AdvancedHeader">
                <span className="TaskFilterBar__AdvancedTitle">고급 필터</span>
                {advancedActive && (
                  <button
                    type="button"
                    className="TaskFilterBar__AdvancedClear"
                    onClick={() => onFilterSpecChange(emptyGroup())}
                  >
                    <X size={12} />
                    초기화
                  </button>
                )}
              </div>
              <FilterBuilder
                spec={filterSpec}
                onChange={onFilterSpecChange}
                members={members}
                labels={labels}
                epics={epics}
                taskTypes={taskTypes}
                workflowStatuses={workflowStatuses}
                customFields={customFields}
                availableFields={availableFields}
              />

              {/* 다중키 정렬 (그룹핑/플랫 정렬용) */}
              {onMultiSortChange && (
                <div className="TaskFilterBar__MultiSort">
                  <div className="TaskFilterBar__MultiSortTitle">정렬 (다중키)</div>
                  {sort.map((s, i) => (
                    <div key={i} className="TaskFilterBar__MultiSortRow">
                      <select
                        className="TaskFilterBar__MultiSortField"
                        value={s.field}
                        onChange={(e) => {
                          const next = sort.map((x, j) => (j === i ? { ...x, field: e.target.value } : x));
                          onMultiSortChange(next);
                        }}
                      >
                        {MULTI_SORT_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="TaskFilterBar__MultiSortDir"
                        onClick={() => {
                          const next = sort.map((x, j) => (j === i ? { ...x, dir: x.dir === 'desc' ? 'asc' : 'desc' } : x));
                          onMultiSortChange(next);
                        }}
                        title={s.dir === 'desc' ? 'Descending' : 'Ascending'}
                      >
                        {s.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                      </button>
                      <button
                        type="button"
                        className="TaskFilterBar__MultiSortRemove"
                        onClick={() => onMultiSortChange(sort.filter((_, j) => j !== i))}
                        title="Remove sort key"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="TaskFilterBar__MultiSortAdd"
                    onClick={() => {
                      const used = new Set(sort.map((s) => s.field));
                      const nextField = (MULTI_SORT_FIELDS.find((f) => !used.has(f.value)) || MULTI_SORT_FIELDS[0]).value;
                      onMultiSortChange([...sort, { field: nextField, dir: 'asc' }]);
                    }}
                  >
                    <Plus size={12} />
                    정렬 키 추가
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 활성 필터 칩 */}
      {activeChips.length > 0 && (
        <div className="TaskFilterBar__ActiveFilters">
          {activeChips.map((chip) => (
            <span
              key={`${chip.category}-${chip.value}`}
              className="TaskFilterBar__ActiveChip"
              style={chip.color ? { borderColor: chip.color, color: chip.color, backgroundColor: chip.color + '15' } : {}}
            >
              {chip.label}
              <button
                type="button"
                className="TaskFilterBar__ActiveChipRemove"
                onClick={() => onToggleFilter(chip.category, chip.value)}
                style={chip.color ? { color: chip.color } : {}}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 멤버 아바타 필터 */}
      <div className="TaskFilterBar__Members">
        <button
          type="button"
          className={`TaskFilterBar__Unassigned ${selectedUserIds.has(0) ? 'TaskFilterBar__Unassigned--selected' : ''}`}
          title="Unassigned"
          onClick={() => onToggleUser(0)}
        >
          <User size={14} />
        </button>

        {visibleMembers.map((m) => (
          <button
            key={m.user_id}
            type="button"
            className={`TaskFilterBar__AvatarBtn ${selectedUserIds.has(m.user_id) ? 'TaskFilterBar__AvatarBtn--selected' : ''}`}
            title={m.username || m.email}
            onClick={() => onToggleUser(m.user_id)}
          >
            <Avatar user={m} size="sm" />
          </button>
        ))}

        {remaining > 0 && (
          <div className="TaskFilterBar__More" ref={moreRef}>
            <button
              type="button"
              className="TaskFilterBar__MoreBtn"
              onClick={() => setMoreOpen((prev) => !prev)}
              title="More members"
            >
              +{remaining}
            </button>
            {moreOpen && (
              <div className="TaskFilterBar__MoreMenu">
                {members.slice(MAX_VISIBLE).map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    className={`TaskFilterBar__MoreItem ${selectedUserIds.has(m.user_id) ? 'TaskFilterBar__MoreItem--selected' : ''}`}
                    onClick={() => onToggleUser(m.user_id)}
                  >
                    <Avatar user={m} size="sm" />
                    <span className="TaskFilterBar__MoreItemName">{m.username || m.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
