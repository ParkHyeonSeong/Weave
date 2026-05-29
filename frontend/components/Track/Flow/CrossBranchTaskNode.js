import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { CalendarDays, Layers, X } from 'lucide-react';
import EntityIcon from '@/components/common/EntityIcon';

function formatDue(date) {
  if (!date) return null;
  const d = new Date(date);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}/${day}`;
}

const CrossBranchTaskNode = memo(function CrossBranchTaskNode({ data, selected }) {
  const {
    displayId, title, status, statusLabel, statusColor,
    priority, branchKey, branchName, branchColor, branchIcon,
    assignees, dueDate, otherTracksCount,
    itemId, onDelete,
  } = data;

  return (
    <div
      className={`TrackNode ${selected ? 'TrackNode--selected' : ''}`}
      style={{ '--branch-color': branchColor }}
    >
      <span className="TrackNode__BranchBand" />
      <span className="TrackNode__BranchGlow" />

      {onDelete && (
        <button
          className="TrackNode__DeleteBtn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(itemId);
          }}
          title="Remove from track"
          aria-label="Remove from track"
        >
          <X size={11} />
        </button>
      )}

      <div className="TrackNode__Header">
        <span className="TrackNode__BranchChip" style={{ background: `${branchColor}14`, color: branchColor }}>
          <EntityIcon
            icon={branchIcon}
            color={branchColor}
            size={14}
            entityType="branch"
          />
          {branchKey}
        </span>
        <span className="TrackNode__DisplayId">{displayId}</span>
        {priority === 'urgent' && (
          <span className="TrackNode__PrioFlag">!</span>
        )}
      </div>

      <div className="TrackNode__Title">{title}</div>

      <div className="TrackNode__Footer">
        <span className="TrackNode__Status">
          <span className="TrackNode__StatusDot" style={{ background: statusColor }} />
          <span className="TrackNode__StatusLabel">{statusLabel}</span>
        </span>
        <span className="TrackNode__Spacer" />
        {dueDate && (
          <span className="TrackNode__Due">
            <CalendarDays size={11} />
            {formatDue(dueDate)}
          </span>
        )}
        {assignees && assignees.length > 0 && (
          <span
            className="TrackNode__Avatar"
            style={{ background: assignees[0].color }}
            title={assignees[0].username}
          >
            {assignees[0].initial}
          </span>
        )}
      </div>

      {otherTracksCount > 0 && (
        <div className="TrackNode__OtherTracks">
          <Layers size={10} />
          <span>also in {otherTracksCount}</span>
        </div>
      )}

      {/* 4방향 핸들. id로 구분해서 edge가 가까운 면 골라 쓰게 */}
      <Handle id="l-in"  type="target" position={Position.Left}   className="TrackNode__Handle TrackNode__Handle--left" />
      <Handle id="r-out" type="source" position={Position.Right}  className="TrackNode__Handle TrackNode__Handle--right" />
      <Handle id="t-in"  type="target" position={Position.Top}    className="TrackNode__Handle TrackNode__Handle--top" />
      <Handle id="t-out" type="source" position={Position.Top}    className="TrackNode__Handle TrackNode__Handle--top-out" />
      <Handle id="b-in"  type="target" position={Position.Bottom} className="TrackNode__Handle TrackNode__Handle--bottom" />
      <Handle id="b-out" type="source" position={Position.Bottom} className="TrackNode__Handle TrackNode__Handle--bottom-out" />
    </div>
  );
});

export default CrossBranchTaskNode;
