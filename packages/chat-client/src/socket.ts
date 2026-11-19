import { Emitter } from './emitter.js';
import { ChatError } from './errors.js';
import type { ClientEvent, ConnectionReadyEvent, ServerEvent } from './types.js';

export type ConnectionStatus =
  'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline' | 'unauthenticated' | 'closed';

export interface ConnectionState {
  status: ConnectionStatus;
  /** Consecutive failed attempts since the last successful connection. */
  attempt: number;
  /** Epoch ms of the next scheduled attempt while reconnecting. */
  nextRetryAt: number | null;
  /** True once a session was established at least once (later opens are recoveries). */
  everConnected: boolean;
}

export interface ReconnectOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Give up after this many consecutive failures (default: never). */
  maxAttempts?: number;
}

export interface SocketOptions {
  /** ws(s):// URL, or a path resolved against the page origin. */
  url: string;
  /** Async hook that may append auth (e.g. ?ticket=) right before each attempt. */
  resolveUrl?: (url: string) => Promise<string>;
  WebSocket?: typeof WebSocket;
  reconnect?: ReconnectOptions;
  /** Max wait for a pong before the connection is considered dead. */
  pongTimeoutMs?: number;
  /** Max wait for an ack to a request. */
  requestTimeoutMs?: number;
  /** Random source for jitter (tests). */
  random?: () => number;
}

type SocketEvents = {
  status: ConnectionState;
  event: ServerEvent;
  ready: ConnectionReadyEvent & { recovered: boolean };
};

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: ChatError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_NOT_FOUND = 4404;

export function toWebSocketUrl(url: string): string {
  if (/^wss?:\/\//.test(url)) return url;
  if (/^https?:\/\//.test(url)) return url.replace(/^http/, 'ws');
  if (typeof location === 'undefined') throw new Error('Relative wsUrl requires a browser; pass ws(s)://…');
  const base = new URL(url, location.href);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return base.toString();
}

/**
 * Resilient WebSocket: exponential backoff with full jitter, heartbeat-based stale
 * detection, request/ack correlation and lifecycle events. It never throws from
 * event handlers; failures surface as status changes and rejected requests.
 */
export class ChatSocket {
  private readonly emitter = new Emitter<SocketEvents>();
  private readonly options: Required<Pick<SocketOptions, 'pongTimeoutMs' | 'requestTimeoutMs'>> &
    SocketOptions;
  private ws: WebSocket | null = null;
  private stateValue: ConnectionState = {
    status: 'idle',
    attempt: 0,
    nextRetryAt: null,
    everConnected: false,
  };
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, Pending>();
  private requestCounter = 0;
  private stopped = true;
  private readyEvent: ConnectionReadyEvent | null = null;
  private generation = 0;
  private removeBrowserListeners: (() => void) | null = null;

  constructor(options: SocketOptions) {
    this.options = { pongTimeoutMs: 10_000, requestTimeoutMs: 8_000, ...options };
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  get ready(): ConnectionReadyEvent | null {
    return this.stateValue.status === 'open' ? this.readyEvent : null;
  }

  on<K extends keyof SocketEvents>(event: K, listener: (payload: SocketEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attachBrowserListeners();
    void this.open();
  }

  /** Close and stop reconnecting. `connect()` may be called again later. */
  disconnect(): void {
    this.stopped = true;
    this.generation += 1;
    this.clearTimers();
    this.removeBrowserListeners?.();
    this.removeBrowserListeners = null;
    this.rejectAll(new ChatError({ kind: 'socket', code: 'disconnected', message: 'Connection closed.' }));
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState < 2) ws.close(1000, 'client closed');
    this.setState({ status: 'closed', nextRetryAt: null });
  }

  dispose(): void {
    this.disconnect();
    this.emitter.clear();
  }

  /** Force an immediate reconnect attempt (e.g. after the browser comes back online). */
  reconnectNow(): void {
    if (this.stopped || this.stateValue.status === 'open' || this.stateValue.status === 'connecting') return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.open();
  }

  isOpen(): boolean {
    return this.stateValue.status === 'open' && this.ws?.readyState === 1;
  }

  /** Fire-and-forget event. Returns false when the socket is not open. */
  send(event: ClientEvent): boolean {
    if (!this.isOpen() || !this.ws) return false;
    this.ws.send(JSON.stringify(event));
    return true;
  }

  /** Send an event that the server acknowledges; resolves with the ack `data`. */
  request<T>(
    event: ClientEvent & { request_id?: string },
    timeoutMs = this.options.requestTimeoutMs,
  ): Promise<T> {
    const requestId = event.request_id ?? `r${Date.now().toString(36)}-${(this.requestCounter += 1)}`;
    return new Promise<T>((resolve, reject) => {
      if (!this.send({ ...event, request_id: requestId } as ClientEvent)) {
        reject(new ChatError({ kind: 'socket', code: 'not_connected', message: 'Not connected.' }));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new ChatError({
            kind: 'timeout',
            code: 'ack_timeout',
            message: 'The server did not acknowledge in time.',
          }),
        );
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
    });
  }

  private async open(): Promise<void> {
    const generation = (this.generation += 1);
    this.setState({ status: this.stateValue.attempt > 0 ? 'reconnecting' : 'connecting', nextRetryAt: null });
    let url: string;
    try {
      url = toWebSocketUrl(this.options.url);
      if (this.options.resolveUrl) url = await this.options.resolveUrl(url);
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      const chatError = ChatError.from(error);
      if (chatError.status === 401 || chatError.status === 403) {
        this.setState({ status: 'unauthenticated', nextRetryAt: null });
        this.stopped = true;
        return;
      }
      this.scheduleReconnect();
      return;
    }
    if (generation !== this.generation || this.stopped) return;
    const Impl = this.options.WebSocket ?? globalThis.WebSocket;
    let ws: WebSocket;
    try {
      ws = new Impl(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onmessage = (message) => this.handleMessage(message.data);
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      this.rejectAll(new ChatError({ kind: 'socket', code: 'connection_lost', message: 'Connection lost.' }));
      if (this.stopped) return;
      if (event.code === CLOSE_UNAUTHENTICATED) {
        this.stopped = true;
        this.setState({ status: 'unauthenticated', nextRetryAt: null });
        return;
      }
      if (event.code === CLOSE_NOT_FOUND) {
        this.stopped = true;
        this.setState({ status: 'closed', nextRetryAt: null });
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows and handles reconnection */
    };
  }

  private handleMessage(raw: unknown): void {
    let event: ServerEvent;
    try {
      event = JSON.parse(String(raw)) as ServerEvent;
    } catch {
      return;
    }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
    if (event.type === 'connection.ready') {
      const recovered = this.stateValue.everConnected;
      this.readyEvent = event;
      this.setState({ status: 'open', attempt: 0, nextRetryAt: null, everConnected: true });
      this.startHeartbeat(event.heartbeat_interval);
      this.emitter.emit('ready', { ...event, recovered });
    } else if (event.type === 'pong') {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
    } else if (event.type === 'ack' && event.request_id && this.pending.has(event.request_id)) {
      const entry = this.pending.get(event.request_id)!;
      this.pending.delete(event.request_id);
      clearTimeout(entry.timer);
      entry.resolve(event.data);
    } else if (event.type === 'error' && event.request_id && this.pending.has(event.request_id)) {
      const entry = this.pending.get(event.request_id)!;
      this.pending.delete(event.request_id);
      clearTimeout(entry.timer);
      entry.reject(
        new ChatError({ kind: 'socket', code: event.code, message: event.message, details: event.details }),
      );
    }
    this.emitter.emit('event', event);
  }

  private scheduleReconnect(): void {
    const attempt = this.stateValue.attempt + 1;
    const { minDelayMs = 500, maxDelayMs = 30_000, maxAttempts = Infinity } = this.options.reconnect ?? {};
    if (attempt > maxAttempts) {
      this.stopped = true;
      this.setState({ status: 'closed', attempt, nextRetryAt: null });
      return;
    }
    // Full jitter avoids synchronized reconnect storms after a server restart.
    const ceiling = Math.min(maxDelayMs, minDelayMs * 2 ** (attempt - 1));
    const delay = Math.max(minDelayMs, Math.round((this.options.random ?? Math.random)() * ceiling));
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    this.setState({ status: offline ? 'offline' : 'reconnecting', attempt, nextRetryAt: Date.now() + delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delay);
  }

  private startHeartbeat(intervalSeconds: number): void {
    this.stopHeartbeat();
    const interval = Math.max(5, intervalSeconds) * 1000;
    this.heartbeatTimer = setInterval(() => {
      if (!this.send({ type: 'ping' })) return;
      if (this.pongTimer) return;
      this.pongTimer = setTimeout(() => {
        // No pong: the TCP connection is probably dead without a close frame.
        this.pongTimer = null;
        this.ws?.close(4000, 'heartbeat timeout');
      }, this.options.pongTimeoutMs);
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.heartbeatTimer = null;
    this.pongTimer = null;
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private rejectAll(error: ChatError): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private setState(patch: Partial<ConnectionState>): void {
    this.stateValue = { ...this.stateValue, ...patch };
    this.emitter.emit('status', this.stateValue);
  }

  private attachBrowserListeners(): void {
    if (typeof window === 'undefined' || this.removeBrowserListeners) return;
    const online = () => this.reconnectNow();
    const offline = () => {
      // The OS reports no network: the open socket cannot deliver anymore, but browsers may
      // keep it "open" until a TCP timeout. Close it now so state and recovery are accurate.
      if (this.ws && this.ws.readyState < 2) this.ws.close(4000, 'browser offline');
      else if (this.stateValue.status !== 'open') this.setState({ status: 'offline' });
    };
    const visible = () => {
      if (document.visibilityState === 'visible') this.reconnectNow();
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    this.removeBrowserListeners = () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }
}
