import './Input.css';

export default function Input({
  label,
  id,
  error,
  className = '',
  ...rest
}) {
  return (
    <div className={`input-group ${className}`}>
      {label && <label htmlFor={id} className="input-group__label">{label}</label>}
      <input id={id} className={`input-group__field ${error ? 'input-group__field--error' : ''}`} {...rest} />
      {error && <span className="input-group__error">{error}</span>}
    </div>
  );
}
