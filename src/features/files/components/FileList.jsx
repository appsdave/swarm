import { formatBytes } from '../utils/validate';
import Button from '../../../components/ui/Button';
import './FileList.css';

function statusIcon(status) {
  if (status === 'uploading') return '⏳';
  if (status === 'done') return '✓';
  if (status === 'error') return '✗';
  return '•';
}

export default function FileList({ files, onRemove }) {
  if (files.length === 0) return null;

  return (
    <ul className="file-list">
      {files.map((f) => (
        <li key={f.id} className={`file-list__item file-list__item--${f.status}`}>
          <span className="file-list__icon">{statusIcon(f.status)}</span>
          <span className="file-list__name" title={f.name}>{f.name}</span>
          <span className="file-list__size">{formatBytes(f.size)}</span>
          {f.status === 'uploading' && (
            <span className="file-list__progress">{f.progress}%</span>
          )}
          <Button variant="ghost" size="sm" onClick={() => onRemove(f.id)} aria-label={`Remove ${f.name}`}>
            &times;
          </Button>
        </li>
      ))}
    </ul>
  );
}
