export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', data, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Planner-Request'] = '1';
  }
  const response = await fetch('/api/v1' + path, {
    method, headers, credentials: 'same-origin', signal,
    body: method === 'GET' ? undefined : JSON.stringify(data ?? {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    if (result?.error?.code === 'SESSION_REQUIRED') window.dispatchEvent(new Event('planner-session-expired'));
    throw new ApiError(response.status, result?.error?.code, result?.error?.message ?? 'Unable to reach Study Planner. Try again.', result?.error?.details);
  }
  return result.data;
}

export async function getHealth(signal) {
  const result = await api('/health', { signal });
  if (result.status !== 'ok') throw new Error('Unexpected health response');
  return result;
}

