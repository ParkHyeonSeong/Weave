import BoardCard from './BoardCard';

export default function BoardColumn({ status, label, tasks, onCardClick, onStatusChange }) {
  return (
    <div className="BoardColumn">
      <div className="BoardColumn__Header">
        <span className={`BoardColumn__Dot BoardColumn__Dot--${status}`} />
        <span className="BoardColumn__Label">{label}</span>
        <span className="BoardColumn__Count">{tasks.length}</span>
      </div>

      <div className="BoardColumn__Body">
        {tasks.map((task) => (
          <BoardCard
            key={task.task_id}
            task={task}
            onClick={() => onCardClick(task)}
          />
        ))}
        {tasks.length === 0 && (
          <div className="BoardColumn__Empty">No tasks</div>
        )}
      </div>
    </div>
  );
}
