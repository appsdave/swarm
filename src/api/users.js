import { get, post, patch, del } from './client';

export function fetchUsers() {
  return get('/users');
}

export function fetchUser(id) {
  return get(`/users/${id}`);
}

export function createUser(data) {
  return post('/users', data);
}

export function updateUser(id, data) {
  return patch(`/users/${id}`, data);
}

export function deleteUser(id) {
  return del(`/users/${id}`);
}
