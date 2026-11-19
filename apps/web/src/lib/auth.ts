import { urls } from './config';

export interface AccountUser {
  id: number;
  username: string | null;
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url: string | null;
  date_joined: string | null;
}

export interface Session {
  user: AccountUser | null;
  csrf_token: string;
  providers: { id: string; name: string; login_url: string }[];
  demo_auth: boolean;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly field?: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

function cookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (method !== 'GET') {
    const token = cookie('csrftoken') ?? csrfToken;
    if (token) headers.set('X-CSRFToken', token);
  }
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${urls.auth}${path}`, { ...init, method, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code: string; message: string; field?: string };
    csrf_token?: string;
  };
  if (data.csrf_token) csrfToken = data.csrf_token; // rotated on login
  if (!response.ok) {
    throw new AuthError(
      data.error?.message ?? 'Something went wrong.',
      data.error?.code ?? `http_${response.status}`,
      response.status,
      data.error?.field,
    );
  }
  return data as T;
}

export const authApi = {
  session: () => request<Session>('/session/'),
  login: (identifier: string, password: string) =>
    request<{ user: AccountUser }>('/login/', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
  loginWithCode: (phone: string, code: string) =>
    request<{ user: AccountUser }>('/login/', { method: 'POST', body: JSON.stringify({ phone, code }) }),
  register: (input: { username: string; display_name: string; email?: string; password: string }) =>
    request<{ user: AccountUser }>('/register/', { method: 'POST', body: JSON.stringify(input) }),
  logout: () => request<void>('/logout/', { method: 'POST' }),
  updateProfile: (data: FormData | Record<string, unknown>) =>
    request<{ user: AccountUser }>('/me/', {
      method: 'PATCH',
      body: data instanceof FormData ? data : JSON.stringify(data),
    }),
  changePassword: (current_password: string, new_password: string) =>
    request<void>('/me/password/', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    }),
};
