export class ApiError extends Error {
  constructor(payload, status) {
    super(payload?.error?.message || `Request failed (${status})`);
    this.code = payload?.error?.code || 'REQUEST_FAILED';
    this.status = status;
    this.retryable = Boolean(payload?.error?.retryable);
  }
}

export async function request(path, options = {}, token = '') {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload, response.status);
  return payload;
}

export function formatDateTime(value, locale = 'en', timeZone = undefined) {
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {})
  }).format(new Date(value));
}
