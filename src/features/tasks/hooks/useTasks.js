import { useCallback } from 'react';
import useAsync from '../../../hooks/useAsync';
import { fetchTasks } from '../../../api/tasks';

export default function useTasks(params = {}) {
  const loader = useCallback(() => fetchTasks(params), [JSON.stringify(params)]);
  return useAsync(loader);
}
