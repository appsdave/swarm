import './FileErrors.css';

export default function FileErrors({ errors }) {
  if (!errors || errors.length === 0) return null;

  return (
    <div className="file-errors" role="alert">
      {errors.map((msg, i) => (
        <p key={i} className="file-errors__msg">{msg}</p>
      ))}
    </div>
  );
}
