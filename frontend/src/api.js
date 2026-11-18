const csrfCookie = () => document.cookie.split('; ').find((part) => part.startsWith('csrftoken='))?.split('=')[1];

export async function request(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const token = csrfCookie();
  if (token && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-CSRFToken'] = decodeURIComponent(token);
  const response = await fetch(`/api/v1${path}`, { credentials: 'include', ...options, method, headers });
  if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error?.message || 'Request failed'); }
  return response.status === 204 ? null : response.json();
}

export async function bootstrapCsrf() { return request('/auth/csrf/'); }
