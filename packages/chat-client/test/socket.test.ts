import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSocket } from '../src';
import { FakeWebSocket } from './fakes';

const make = (extra = {}) =>
  new ChatSocket({
    url: 'ws://localhost/ws/chat/v1/',
    WebSocket: FakeWebSocket as never,
    random: () => 1,
    ...extra,
  });

describe('ChatSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.reset();
  });
  afterEach(() => vi.useRealTimers());

  it('reconnects with exponential backoff and resets after success', async () => {
    const socket = make({ reconnect: { minDelayMs: 100, maxDelayMs: 1000 } });
    const statuses: string[] = [];
    socket.on('status', (s) => statuses.push(s.status));
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last.serverClose();
    expect(socket.state).toMatchObject({ status: 'reconnecting', attempt: 1 });
    await vi.advanceTimersByTimeAsync(100);
    FakeWebSocket.last.serverClose();
    expect(socket.state.attempt).toBe(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    FakeWebSocket.last.ready();
    expect(socket.state).toMatchObject({ status: 'open', attempt: 0, everConnected: true });
    expect(statuses).toContain('reconnecting');
    socket.dispose();
  });

  it('stops reconnecting on 4401 and on disconnect()', async () => {
    const socket = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last.serverClose(4401);
    expect(socket.state.status).toBe('unauthenticated');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const other = make();
    other.connect();
    await vi.advanceTimersByTimeAsync(0);
    other.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(other.state.status).toBe('closed');
  });

  it('marks recovered sessions on reconnect', async () => {
    const socket = make({ reconnect: { minDelayMs: 10 } });
    const ready = vi.fn();
    socket.on('ready', ready);
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last.ready();
    FakeWebSocket.last.serverClose();
    await vi.advanceTimersByTimeAsync(20);
    FakeWebSocket.last.ready();
    expect(ready.mock.calls.map(([e]) => e.recovered)).toEqual([false, true]);
    socket.dispose();
  });

  it('correlates acks and errors, and times out', async () => {
    const socket = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.last;
    ws.ready();
    const ok = socket.request({ type: 'read.mark', conversation_id: 'c', seq: 1, request_id: 'a' });
    ws.emit({ type: 'ack', request_id: 'a', data: { last_read_seq: 1 } });
    await expect(ok).resolves.toEqual({ last_read_seq: 1 });
    const bad = socket.request({ type: 'read.mark', conversation_id: 'c', seq: 1, request_id: 'b' });
    ws.emit({ type: 'error', request_id: 'b', code: 'not_found', message: 'x' });
    await expect(bad).rejects.toMatchObject({ kind: 'socket', code: 'not_found' });
    const slow = socket.request({ type: 'read.mark', conversation_id: 'c', seq: 1 }, 1000);
    vi.advanceTimersByTime(1000);
    await expect(slow).rejects.toMatchObject({ code: 'ack_timeout' });
    socket.dispose();
  });

  it('detects a dead connection when pongs stop', async () => {
    const socket = make({ pongTimeoutMs: 1000, reconnect: { minDelayMs: 10 } });
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.last;
    ws.ready({ heartbeat_interval: 5 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(ws.lastSent('ping')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ws.closedWith).toBe(4000);
    await vi.advanceTimersByTimeAsync(20);
    expect(FakeWebSocket.instances).toHaveLength(2);
    socket.dispose();
  });

  it('rejects pending requests when the connection drops', async () => {
    const socket = make();
    socket.connect();
    await vi.advanceTimersByTimeAsync(0);
    FakeWebSocket.last.ready();
    const pending = socket.request({ type: 'ping' });
    FakeWebSocket.last.serverClose();
    await expect(pending).rejects.toMatchObject({ code: 'connection_lost' });
    socket.dispose();
  });
});
