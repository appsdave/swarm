import { get, post, patch, del } from './client';

export function fetchProjects(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return get(`/projects${qs ? `?${qs}` : ''}`);
}

export function fetchProject(id) {
  return get(`/projects/${id}`);
}

export function createProject(data) {
  return post('/projects', data);
}

export function updateProject(id, data) {
  return patch(`/projects/${id}`, data);
}

export function deleteProject(id) {
  return del(`/projects/${id}`);
}
