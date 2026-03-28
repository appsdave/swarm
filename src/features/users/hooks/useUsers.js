import { useCallback } from 'react';
import useAsync from '../../../hooks/useAsync';
import { fetchUsers } from '../../../api/users';

export default function useUsers() {
  const loader = useCallback(() => fetchUsers(), []);
  return useAsync(loader);
}
