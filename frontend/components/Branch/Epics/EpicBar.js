import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export default function EpicBar({ epic, getPosition, timelineWidth, nameColWidth, onClick, isOverlay }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: String(epic.epic_id),
    disabled: isOverlay,
  });

  const style = isOverlay ? {} : {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const hasRange = epic.start_date && epic.due_date;
  const left = hasRange ? getPosition(epic.start_date) : null;
  const right = hasRange ? getPosition(epic.due_date) : null;

  // px 범위 클램핑 (0 ~ timelineWidth)
  const clampedLeft = left != null ? Math.max(0, left) : null;
  const clampedRight = right != null ? Math.min(timelineWidth, right) : null;
  const visible = clampedLeft != null && clampedRight != null && clampedRight > clampedLeft;

  return (
    <div
      className={`EpicBar ${isOverlay ? 'EpicBar--overlay' : ''}`}
      ref={setNodeRef}
      style={style}
      onClick={onClick}
    >
      <div className="EpicBar__Info" style={{ width: nameColWidth, minWidth: nameColWidth }}>
        <div className="EpicBar__DragHandle" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </div>
        <span className="EpicBar__Color" style={{ backgroundColor: epic.color || '#5E6AD2' }} />
        <span className="EpicBar__Name">{epic.epic_name}</span>
        <span className={`EpicBar__Status EpicBar__Status--${epic.status}`}>
          {STATUS_LABELS[epic.status] || epic.status}
        </span>
      </div>

      <div className="EpicBar__Timeline" style={{ width: timelineWidth }}>
        {hasRange && visible ? (
          <div
            className="EpicBar__Bar"
            style={{
              left: clampedLeft,
              width: Math.max(clampedRight - clampedLeft, 4),
              backgroundColor: epic.color || '#5E6AD2',
            }}
          >
            <span className="EpicBar__BarLabel">{epic.epic_name}</span>
          </div>
        ) : (
          <div className="EpicBar__NoDate">
            {hasRange ? 'Out of range' : 'No dates set'}
          </div>
        )}
      </div>
    </div>
  );
}
