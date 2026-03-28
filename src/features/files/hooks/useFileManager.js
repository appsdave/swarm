import { useState, useCallback } from 'react';
import { validateFileList } from '../utils/validate';

export default function useFileManager() {
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState([]);

  const addFiles = useCallback((incoming) => {
    const list = Array.from(incoming);
    const validationErrors = validateFileList(list, files.length);

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return false;
    }

    setErrors([]);
    setFiles((prev) => [
      ...prev,
      ...list.map((f) => ({
        id: `${f.name}-${f.size}-${Date.now()}`,
        file: f,
        name: f.name,
        size: f.size,
        type: f.type,
        status: 'pending',
        progress: 0,
      })),
    ]);
    return true;
  }, [files.length]);

  const removeFile = useCallback((id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setErrors([]);
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    setErrors([]);
  }, []);

  const updateFileStatus = useCallback((id, status, progress = 0) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status, progress } : f)),
    );
  }, []);

  return { files, errors, addFiles, removeFile, clearFiles, updateFileStatus };
}
