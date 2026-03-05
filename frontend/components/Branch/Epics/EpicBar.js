const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export default function EpicBar({ epic, getPosition, onClick }) {
  const hasRange = epic.start_date && epic.due_date;
  const left = hasRange ? getPosition(epic.start_date) : null;
  const right = hasRange ? getPosition(epic.due_date) : null;

  return (
    <div className="EpicBar" onClick={onClick}>
      {/* 왼쪽: 에픽 이름 */}
      <div className="EpicBar__Info">
        <span className="EpicBar__Color" style={{ backgroundColor: epic.color || '#5E6AD2' }} />
        <span className="EpicBar__Name">{epic.epic_name}</span>
        <span className={`EpicBar__Status EpicBar__Status--${epic.status}`}>
          {STATUS_LABELS[epic.status] || epic.status}
        </span>
        <span className="EpicBar__TaskCount">{epic.task_count || 0} tasks</span>
      </div>

      {/* 오른쪽: 타임라인 바 */}
      <div className="EpicBar__Timeline">
        {hasRange ? (
          <div
            className="EpicBar__Bar"
            style={{
              left: `${left}%`,
              width: `${Math.max(right - left, 0.5)}%`,
              backgroundColor: epic.color || '#5E6AD2',
            }}
          >
            <span className="EpicBar__BarLabel">{epic.epic_name}</span>
          </div>
        ) : (
          <div className="EpicBar__NoDate">No dates set</div>
        )}
      </div>
    </div>
  );
}
