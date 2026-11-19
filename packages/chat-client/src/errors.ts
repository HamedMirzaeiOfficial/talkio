/** Standardized error for every SDK failure (HTTP, WebSocket, network, timeout, abort). */
export type ChatErrorKind = 'http' | 'socket' | 'network' | 'timeout' | 'aborted';

export class ChatError extends Error {
  override readonly name = 'ChatError';
  readonly kind: ChatErrorKind;
  readonly code: string;
  readonly status: number | null;
  readonly details: unknown;

  constructor(options: {
    kind: ChatErrorKind;
    code: string;
    message: string;
    status?: number | null;
    details?: unknown;
  }) {
    super(options.message);
    this.kind = options.kind;
    this.code = options.code;
    this.status = options.status ?? null;
    this.details = options.details;
  }

  /** Seconds to wait before retrying, when the server rate-limited the request. */
  get retryAfter(): number | null {
    const details = this.details as { retry_after?: number } | undefined;
    return typeof details?.retry_after === 'number' ? details.retry_after : null;
  }

  /** Whether retrying the same request later can reasonably succeed. */
  get retryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true;
    return this.status === null || this.status === 429 || this.status >= 500;
  }

  static from(error: unknown): ChatError {
    if (error instanceof ChatError) return error;
    if (isAbortError(error))
      return new ChatError({ kind: 'aborted', code: 'aborted', message: 'The request was cancelled.' });
    const message = error instanceof Error ? error.message : 'Network request failed.';
    return new ChatError({ kind: 'network', code: 'network_error', message });
  }
}

export function isChatError(value: unknown): value is ChatError {
  return value instanceof ChatError;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}
