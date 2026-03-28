import { useRef, useState, useCallback } from 'react';
import { ALLOWED_MIME_TYPES } from '../utils/constants';
import './FileDropZone.css';

export default function FileDropZone({ onFiles, disabled = false }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const dt = e.dataTransfer;
      if (dt.files.length) onFiles(dt.files);
    },
    [onFiles, disabled],
  );

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleInput = (e) => {
    if (e.target.files.length) onFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <div
      className={`dropzone ${dragging ? 'dropzone--active' : ''} ${disabled ? 'dropzone--disabled' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_MIME_TYPES.join(',')}
        className="dropzone__input"
        onChange={handleInput}
      />
      <p className="dropzone__text">
        {dragging ? 'Drop files here…' : 'Click or drag files to upload'}
      </p>
      <p className="dropzone__hint">Max 5 MB per file · 25 MB total · up to 10 files</p>
    </div>
  );
}
