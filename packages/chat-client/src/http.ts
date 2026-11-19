import type { AuthAdapter } from './auth.js';
import { ChatError } from './errors.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HttpClientOptions {
  baseUrl: string;
  auth: AuthAdapter;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Current UI language, sent as Accept-Language so server messages match the interface. */
  language?: () => string | undefined;
}

/** Resolve a possibly relative URL against the page (browser) or throw (non-browser). */
export function absoluteUrl(url: string): URL {
  if (/^[a-z]+:\/\//i.test(url)) return new URL(url);
  if (typeof location !== 'undefined') return new URL(url, location.href);
  throw new Error(`Relative URL "${url}" requires a browser environment; pass an absolute URL.`);
}

export class HttpClient {
  readonly baseUrl: string;
  private readonly auth: AuthAdapter;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly language: (() => string | undefined) | undefined;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.auth = options.auth;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.language = options.language;
  }

  url(path: string, query?: RequestOptions['query']): string {
    const target = path.startsWith('/api/') || /^https?:/.test(path) ? path : `${this.baseUrl}${path}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${target}${target.includes('?') ? '&' : '?'}${qs}` : target;
  }

  /** Absolute origin-qualified URL for a server-provided path such as attachment.url. */
  resolve(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    if (/^https?:\/\//.test(this.baseUrl)) return new URL(path, this.baseUrl).toString();
    return path;
  }

  async headersFor(method: string, url: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const language = this.language?.();
    if (language) headers['Accept-Language'] = language;
    return { ...headers, ...((await this.auth.getHeaders?.({ method, url })) ?? {}) };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const url = this.url(path, options.query);
    const headers = await this.headersFor(method, url);
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) body = options.body;
    else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException('timeout', 'TimeoutError')),
      options.timeoutMs ?? this.timeoutMs,
    );
    const onAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) controller.abort(options.signal.reason);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        credentials: this.auth.credentials ?? 'same-origin',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new ChatError({
          kind: 'timeout',
          code: 'timeout',
          message: 'The server did not respond in time.',
        });
      }
      throw ChatError.from(error);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
    return this.parse<T>(response);
  }

  async parse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    if (!response.ok) {
      const error = new ChatError({
        kind: 'http',
        status: response.status,
        code: payload?.error?.code ?? `http_${response.status}`,
        message: payload?.error?.message ?? `Request failed with status ${response.status}.`,
        details: payload?.error?.details,
      });
      if (error.code === 'not_authenticated' || response.status === 401) this.auth.onUnauthorized?.();
      throw error;
    }
    return payload as T;
  }

  /** Multipart upload with progress (XMLHttpRequest when available, fetch otherwise). */
  async upload<T>(
    path: string,
    form: FormData,
    options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
  ): Promise<T> {
    const url = this.url(path);
    const headers = await this.headersFor('POST', url);
    if (typeof XMLHttpRequest === 'undefined' || !options.onProgress) {
      return this.request<T>(path, { method: 'POST', body: form, signal: options.signal });
    }
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = (this.auth.credentials ?? 'same-origin') === 'include';
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        const response = new Response(xhr.status === 204 ? null : xhr.responseText, { status: xhr.status });
        this.parse<T>(response).then(resolve, reject);
      };
      xhr.onerror = () =>
        reject(new ChatError({ kind: 'network', code: 'network_error', message: 'Upload failed.' }));
      xhr.onabort = () =>
        reject(new ChatError({ kind: 'aborted', code: 'aborted', message: 'Upload cancelled.' }));
      options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(form);
    });
  }
}
