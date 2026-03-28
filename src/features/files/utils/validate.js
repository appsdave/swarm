import {
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_FILES,
  ALLOWED_MIME_TYPES,
} from './constants';

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function validateFile(file) {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return `"${file.name}" has an unsupported file type (${file.type || 'unknown'}).`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `"${file.name}" is ${formatBytes(file.size)} — max allowed is ${formatBytes(MAX_FILE_SIZE)}.`;
  }
  return null;
}

export function validateFileList(files, existingCount = 0) {
  const errors = [];

  if (existingCount + files.length > MAX_FILES) {
    errors.push(`You can attach up to ${MAX_FILES} files. Currently ${existingCount}, trying to add ${files.length}.`);
    return errors;
  }

  let totalSize = 0;
  for (const file of files) {
    const err = validateFile(file);
    if (err) errors.push(err);
    totalSize += file.size;
  }

  if (totalSize > MAX_TOTAL_SIZE) {
    errors.push(`Total upload size is ${formatBytes(totalSize)} — max allowed is ${formatBytes(MAX_TOTAL_SIZE)}.`);
  }

  return errors;
}
