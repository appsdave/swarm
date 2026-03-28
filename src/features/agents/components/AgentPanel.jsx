import './AgentPanel.css';

export default function AgentPanel({ id, label, size = 'primary' }) {
  return (
    <div className={`agent-panel agent-panel--${size}`}>
      <div className="agent-panel__header">
        <span className="agent-panel__dot" />
        <span className="agent-panel__label">{label}</span>
        <span className="agent-panel__id">{id}</span>
      </div>
      <div className="agent-panel__body">
        <p className="agent-panel__placeholder">Waiting for task…</p>
      </div>
    </div>
  );
}
