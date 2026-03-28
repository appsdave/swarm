import useFileManager from '../features/files/hooks/useFileManager';
import FileDropZone from '../features/files/components/FileDropZone';
import FileList from '../features/files/components/FileList';
import FileErrors from '../features/files/components/FileErrors';
import Button from '../components/ui/Button';
import { MAX_FILE_SIZE, MAX_TOTAL_SIZE, MAX_FILES } from '../features/files/utils/constants';
import { formatBytes } from '../features/files/utils/validate';
import './FilesPage.css';

export default function FilesPage() {
  const { files, errors, addFiles, removeFile, clearFiles } = useFileManager();

  return (
    <div className="files-page">
      <div className="page-header">
        <h1>File Manager</h1>
        {files.length > 0 && (
          <Button variant="secondary" onClick={clearFiles}>Clear All</Button>
        )}
      </div>

      <div className="files-page__limits">
        <span>Max per file: {formatBytes(MAX_FILE_SIZE)}</span>
        <span>Max total: {formatBytes(MAX_TOTAL_SIZE)}</span>
        <span>Max files: {MAX_FILES}</span>
      </div>

      <FileDropZone onFiles={addFiles} />
      <FileErrors errors={errors} />
      <FileList files={files} onRemove={removeFile} />
    </div>
  );
}
