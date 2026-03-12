import { useMemo } from 'react';
import { Search, User, X } from 'lucide-react';
import MultiSelect from '@/components/common/MultiSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';

const MAX_VISIBLE = 5;

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
}) {
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
          className={`TaskFilterBar__Avatar TaskFilterBar__Avatar--unassigned ${selectedUserIds.has(0) ? 'TaskFilterBar__Avatar--selected' : ''}`}
          title="Unassigned"
          onClick={() => onToggleUser(0)}
        >
          <User size={14} />
        </button>

        {visibleMembers.map((m) => (
          <button
            key={m.user_id}
            type="button"
            className={`TaskFilterBar__Avatar ${selectedUserIds.has(m.user_id) ? 'TaskFilterBar__Avatar--selected' : ''}`}
            title={m.username || m.email}
            onClick={() => onToggleUser(m.user_id)}
          >
            {(m.username || m.email).charAt(0).toUpperCase()}
          </button>
        ))}

        {remaining > 0 && (
          <span className="TaskFilterBar__More">+{remaining}</span>
        )}
      </div>
    </div>
  );
}
