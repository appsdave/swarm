import { get, post } from './client';

export function sendPrompt(data) {
  return post('/prompts', data);
}

export function fetchPromptStatus(id) {
  return get(`/prompts/${id}/status`);
}

export function fetchPrompts(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return get(`/prompts${qs ? `?${qs}` : ''}`);
}
