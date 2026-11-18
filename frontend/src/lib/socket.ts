import type { ConnectionStatus, ServerEvent } from '../types/chat';

interface SocketOptions { slug: string; onEvent: (event: ServerEvent) => void; onStatus: (status: ConnectionStatus) => void; }

export class ChatSocket {
  private socket: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private timer: number | undefined;
  constructor(private readonly options: SocketOptions) { this.connect(); }

  private connect() {
    if (this.stopped) return;
    this.options.onStatus(this.retry ? 'reconnecting' : 'connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${protocol}://${window.location.host}/ws/chat/${encodeURIComponent(this.options.slug)}/`);
    this.socket.onopen = () => { this.retry = 0; this.options.onStatus('online'); };
    this.socket.onmessage = (event) => { try { const payload = JSON.parse(event.data) as ServerEvent; this.options.onEvent(payload); if (payload.type === 'message.created') window.dispatchEvent(new CustomEvent('chat:incoming', { detail: payload })); } catch { /* Ignore malformed events. */ } };
    this.socket.onerror = () => this.socket?.close();
    this.socket.onclose = () => {
      if (this.stopped) return;
      this.options.onStatus('reconnecting');
      const delay = Math.min(1000 * 2 ** this.retry, 10000);
      this.retry += 1;
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }

  sendMessage(body: string, requestId: string) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ event: 'message.create', request_id: requestId, body }));
    return true;
  }

  sendTyping(isTyping: boolean) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ event: isTyping ? 'typing.start' : 'typing.stop' }));
  }

  close() { this.stopped = true; if (this.timer) window.clearTimeout(this.timer); this.socket?.close(); }
}
