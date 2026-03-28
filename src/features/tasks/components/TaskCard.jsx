import StatusBadge from '../../../components/ui/StatusBadge';
import './TaskCard.css';

const PRIORITY_LABELS = { 0: 'Low', 1: 'Medium', 2: 'High' };

export default function TaskCard({ task, onClick }) {
  return (
    <div className="task-card" onClick={() => onClick?.(task)} role="button" tabIndex={0}>
      <div className="task-card__header">
        <span className="task-card__title">{task.title}</span>
        <StatusBadge status={task.status} />
      </div>
      {task.description && (
        <p className="task-card__desc">{task.description}</p>
      )}
      <div className="task-card__meta">
        <span className="task-card__priority">
          {PRIORITY_LABELS[task.priority] ?? `P${task.priority}`}
        </span>
      </div>
    </div>
  );
}
