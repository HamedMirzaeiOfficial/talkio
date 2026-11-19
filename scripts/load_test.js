/* global __ENV, __VU, __ITER */
/**
 * k6 WebSocket scenario for /ws/chat/v1/. No results are published with this repository:
 * record environment, dataset and k6 output before comparing runs.
 *
 *   k6 run -e SESSION_ID=<sessionid cookie> -e CONVERSATION_ID=<uuid> -e VUS=5 -e DURATION=30s scripts/load_test.js
 *
 * The session must belong to a member of the conversation. ORIGIN must be an allowed host.
 */
import { check } from 'k6';
import ws from 'k6/ws';

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '10s',
};

export default function () {
  const base = __ENV.BASE_URL || 'ws://127.0.0.1:4800';
  const params = {
    headers: { Cookie: `sessionid=${__ENV.SESSION_ID}`, Origin: __ENV.ORIGIN || 'http://127.0.0.1' },
  };
  const response = ws.connect(`${base}/ws/chat/v1/`, params, (socket) => {
    socket.on('message', (raw) => {
      const event = JSON.parse(raw);
      if (event.type === 'connection.ready') {
        socket.send(
          JSON.stringify({
            type: 'message.send',
            request_id: `k6-${__VU}-${__ITER}`,
            client_id: `k6-${__VU}-${__ITER}`,
            conversation_id: __ENV.CONVERSATION_ID,
            body: 'load-test message',
          }),
        );
      }
      if (event.type === 'ack') {
        check(event, {
          'message acknowledged': (e) => Boolean(e.data && e.data.message && e.data.message.seq),
        });
        socket.close();
      }
      if (event.type === 'error') check(event, { 'no protocol error': () => false });
    });
    socket.setTimeout(() => socket.close(), 5000);
  });
  check(response, { 'handshake succeeded': (r) => r && r.status === 101 });
}
