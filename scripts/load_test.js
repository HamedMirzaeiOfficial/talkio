import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: Number(__ENV.VUS || 1),
  duration: __ENV.DURATION || '10s',
};

export default function () {
  const base = __ENV.BASE_URL || 'ws://127.0.0.1:8000';
  const slug = __ENV.ROOM_SLUG || 'load-test-room';
  const url = `${base}/ws/chat/${slug}/`;
  const response = ws.connect(url, {}, function (socket) {
    socket.on('open', function () {
      socket.send(JSON.stringify({ event: 'message.create', request_id: `k6-${__VU}-${__ITER}`, body: 'load-test message' }));
    });
    socket.on('message', function (message) {
      check(JSON.parse(message), { 'server returned a JSON event': (event) => Boolean(event.type) });
    });
    socket.setTimeout(function () { socket.close(); }, 1000);
  });
  check(response, { 'websocket handshake accepted': (res) => res && res.status === 101 });
}
