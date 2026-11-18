# Security Notes

## Current findings

The audited baseline contains hardcoded secrets, a debug-first configuration, missing WebSocket authorization, unbounded message operations, and unsafe client-side HTML interpolation. These are tracked as remediation work; their presence means the baseline must not be presented as production-ready.

## Security decisions

- Secrets are loaded from environment variables and must be rotated if they were ever deployed.
- Session cookies remain the authentication mechanism for the server-rendered application and WebSocket handshake.
- Conversation membership is checked for every HTTP and WebSocket operation.
- Message text is inserted with DOM text APIs; no untrusted message content is marked safe.
- Attachment access is authorized through the conversation membership, not by a public guessable path.
- Rate limits protect login, message submission, typing, and upload endpoints. Limits are configuration, not performance claims.
- Logs exclude credentials, cookies, message bodies, and attachment contents.

## Operational checklist

- Set `DEBUG=0`, a unique `DJANGO_SECRET_KEY`, explicit `ALLOWED_HOSTS`, and HTTPS-related settings in deployment.
- Rotate any credential that was previously committed.
- Run migrations before serving traffic and collect static files in the release process.
- Use PostgreSQL and Redis for multi-worker deployments.
- Configure a real object store or protected media volume before enabling attachments.
