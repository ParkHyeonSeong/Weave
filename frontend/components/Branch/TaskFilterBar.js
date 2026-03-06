import { Search, User } from 'lucide-react';

const MAX_VISIBLE = 5;

export default function TaskFilterBar({ members, searchQuery, onSearchChange, selectedUserIds, onToggleUser }) {
  const visibleMembers = members.slice(0, MAX_VISIBLE);
  const remaining = members.length - MAX_VISIBLE;

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

      {/* 멤버 아바타 필터 */}
      <div className="TaskFilterBar__Members">
        {/* Unassigned */}
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
