import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Lock, X } from 'lucide-react';

const RestrictedNode = memo(function RestrictedNode({ data, selected }) {
  const { itemId, onDelete } = data;
  return (
    <div className={`TrackNode TrackNode--restricted ${selected ? 'TrackNode--selected' : ''}`}>
      <div className="TrackNode__RestrictedFrost" />
      {onDelete && (
        <button
          className="TrackNode__DeleteBtn"
          onClick={(e) => { e.stopPropagation(); onDelete(itemId); }}
          title="Remove from track"
          aria-label="Remove from track"
        >
          <X size={11} />
        </button>
      )}
      <div className="TrackNode__RestrictedContent">
        <Lock size={14} className="TrackNode__RestrictedIcon" />
        <div className="TrackNode__RestrictedTitle">Restricted</div>
        <div className="TrackNode__RestrictedHint">{data.hint || 'No access'}</div>
      </div>
      <Handle id="l-in"  type="target" position={Position.Left}   className="TrackNode__Handle TrackNode__Handle--left" />
      <Handle id="r-out" type="source" position={Position.Right}  className="TrackNode__Handle TrackNode__Handle--right" />
      <Handle id="t-in"  type="target" position={Position.Top}    className="TrackNode__Handle TrackNode__Handle--top" />
      <Handle id="b-out" type="source" position={Position.Bottom} className="TrackNode__Handle TrackNode__Handle--bottom-out" />
    </div>
  );
});

export default RestrictedNode;
