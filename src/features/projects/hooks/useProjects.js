import { useCallback } from 'react';
import useAsync from '../../../hooks/useAsync';
import { fetchProjects } from '../../../api/projects';

export default function useProjects() {
  const loader = useCallback(() => fetchProjects(), []);
  return useAsync(loader);
}
