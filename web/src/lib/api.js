// Thin client for the API (hld § API surface). Adds the bearer token, turns
// error bodies into thrown ApiErrors, and sends any 401 back to the login screen.

import { readSession, clearSession } from './session.js';

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export const apiUrl = (path) => `${BASE}${path}`;

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  const session = readSession();
  if (session) headers.authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Cannot reach the server.');
  }
  if (res.status === 401 && path !== '/api/login') {
    clearSession();
    onUnauthorized();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}
