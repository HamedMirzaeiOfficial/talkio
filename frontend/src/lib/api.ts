import type { Conversation, Message, Page, User } from '../types/chat';

const csrfCookie = (): string | undefined => document.cookie.split('; ').find((part) => part.startsWith('csrftoken='))?.split('=')[1];

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const csrf = csrfCookie();
  if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRFToken', decodeURIComponent(csrf));
  const response = await fetch(`/api/v1${path}`, { ...options, method, credentials: 'include', headers });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    throw new ApiError(response.status, detail.error?.message ?? 'Something went wrong.', detail.error?.code);
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export const api = {
  csrf: () => request<{ csrf_token: string }>('/auth/csrf/'),
  me: () => request<{ user: User }>('/auth/me/'),
  login: (phone: string, code: string) => request<{ user: User }>('/auth/login/', { method: 'POST', body: JSON.stringify({ phone, code }) }),
  logout: () => request<void>('/auth/logout/', { method: 'POST' }),
  conversations: () => request<{ results: Conversation[] }>('/conversations/'),
  createConversation: (name: string, memberIds: number[]) => request<Conversation>('/conversations/', { method: 'POST', body: JSON.stringify({ name, member_ids: memberIds }) }),
  messages: (slug: string) => request<Page<Message>>(`/conversations/${encodeURIComponent(slug)}/messages/`),
  createMessage: (slug: string, body: string, clientId: string) => request<{ message: Message }>(`/conversations/${encodeURIComponent(slug)}/messages/`, { method: 'POST', body: JSON.stringify({ body, client_id: clientId }) }),
  editMessage: (id: string, body: string) => request<{ message: Message }>(`/messages/${id}/`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteMessage: (id: string) => request<void>(`/messages/${id}/`, { method: 'DELETE' }),
  uploadAttachment: (messageId: string, file: File) => { const form = new FormData(); form.append('message_id', messageId); form.append('file', file); return request<{ id: number; name: string; content_type: string; size: number }>('/attachments/', { method: 'POST', body: form }); },
};
