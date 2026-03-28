import './StatusBadge.css';

const COLOR_MAP = {
  active: 'success',
  done: 'success',
  completed: 'success',
  'in-progress': 'warning',
  in_progress: 'warning',
  todo: 'neutral',
  archived: 'neutral',
};

export default function StatusBadge({ status }) {
  const color = COLOR_MAP[status] || 'neutral';
  return <span className={`badge badge--${color}`}>{status}</span>;
}
