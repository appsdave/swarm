import { get, post, patch, del } from './client';

export function fetchTasks(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return get(`/tasks${qs ? `?${qs}` : ''}`);
}

export function fetchTask(id) {
  return get(`/tasks/${id}`);
}

export function createTask(data) {
  return post('/tasks', data);
}

export function updateTask(id, data) {
  return patch(`/tasks/${id}`, data);
}

export function deleteTask(id) {
  return del(`/tasks/${id}`);
}
