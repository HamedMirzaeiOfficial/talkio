import { describe, expect, it, vi } from 'vitest';

import { bearerAuth, ChatError, HttpClient } from '../src';
import { fakeFetch } from './fakes';

describe('HttpClient', () => {
  it('maps the error envelope to ChatError', async () => {
    const { fetch } = fakeFetch({
      'POST /api/x/': () =>
        new Response(
          JSON.stringify({ error: { code: 'rate_limited', message: 'slow', details: { retry_after: 2 } } }),
          { status: 429 },
        ),
    });
    const http = new HttpClient({ baseUrl: 'http://localhost/api', auth: {}, fetch });
    const error = await http.request('/x/', { method: 'POST', body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ChatError);
    expect(error).toMatchObject({
      kind: 'http',
      status: 429,
      code: 'rate_limited',
      retryAfter: 2,
      retryable: true,
    });
  });

  it('sends the current UI language as Accept-Language', async () => {
    let lang = 'fa';
    const http = new HttpClient({ baseUrl: 'http://localhost/api', auth: {}, language: () => lang });
    expect((await http.headersFor('GET', '/x'))['Accept-Language']).toBe('fa');
    lang = 'en';
    expect((await http.headersFor('GET', '/x'))['Accept-Language']).toBe('en');
    const plain = new HttpClient({ baseUrl: 'http://localhost/api', auth: {} });
    expect(await plain.headersFor('GET', '/x')).not.toHaveProperty('Accept-Language');
  });

  it('adds auth headers per request and never caches the token', async () => {
    let token = 'one';
    const { fetch, calls } = fakeFetch({ 'GET /api/me/': () => ({ ok: true }) });
    const http = new HttpClient({
      baseUrl: 'http://localhost/api',
      auth: bearerAuth({ getToken: () => token }),
      fetch,
    });
    await http.request('/me/');
    token = 'two';
    await http.request('/me/');
    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Bearer one', 'Bearer two']);
  });

  it('notifies the auth adapter on not_authenticated', async () => {
    const onUnauthorized = vi.fn();
    const { fetch } = fakeFetch({
      'GET /api/me/': () =>
        new Response(JSON.stringify({ error: { code: 'not_authenticated', message: 'x' } }), { status: 403 }),
    });
    const http = new HttpClient({ baseUrl: 'http://localhost/api', auth: { onUnauthorized }, fetch });
    await expect(http.request('/me/')).rejects.toMatchObject({ code: 'not_authenticated' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('supports cancellation', async () => {
    const { fetch } = fakeFetch({ 'GET /api/slow/': () => new Promise(() => undefined) });
    const http = new HttpClient({ baseUrl: 'http://localhost/api', auth: {}, fetch });
    const controller = new AbortController();
    controller.abort();
    await expect(http.request('/slow/', { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  it('builds query strings and skips empty values', () => {
    const http = new HttpClient({ baseUrl: '/api/chat/v1/', auth: {} });
    expect(http.url('/messages/', { before: 5, after: undefined, q: '' })).toBe(
      '/api/chat/v1/messages/?before=5',
    );
    expect(
      new HttpClient({ baseUrl: 'https://chat.example/api/chat/v1', auth: {} }).resolve(
        '/api/chat/v1/attachments/a/download/',
      ),
    ).toBe('https://chat.example/api/chat/v1/attachments/a/download/');
  });
});
