export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MB
export const MAX_FILES = 10;

export const ALLOWED_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'application/zip': ['.zip'],
};

export const ALLOWED_EXTENSIONS = Object.values(ALLOWED_TYPES).flat();
export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_TYPES);
