# Chapter 5 — Security

**English** · [فارسی](../05-security.md)

Files for this chapter: `apps/server/accounts/api.py`, `accounts/authentication.py`, `ws/middleware.py`, `ws/tickets.py`, `files.py`, `api/views.py::_harden`, `apps/server/tests/test_hardening.py`, [security.md](../../security.md)

## 1. Session authentication and CSRF

After signing in, the browser gets a `sessionid` cookie that is `HttpOnly` (JavaScript cannot read it, so XSS cannot steal it). Its danger is **CSRF**: a malicious site submits a form to your server and the browser attaches the cookie automatically.

Django's defense is the **double-submit** pattern: a `csrftoken` cookie that your own page's JavaScript can read and send back in an `X-CSRFToken` header. The malicious site has no access to your cookie, so it cannot build the right header.

### A trap: CSRF on sign-in

DRF does not check CSRF for an **unauthenticated** user. So the sign-in endpoint had no defense. A **login CSRF** attack means the attacker silently signs the victim into the attacker's own account, so everything the victim writes afterwards lands in the attacker's account. The fix in `accounts/api.py`:

```python
@method_decorator(csrf_protect, name="dispatch")
class LoginView(AuthView): ...
```

Test: `test_login_and_register_require_csrf`.

### A trap: CSRF token rotation

Django rotates the CSRF token after `login()` (to prevent session fixation). A client that keeps the old token gets a 403 on its next request. That is why the sign-in API returns the new token in its response and `lib/auth.ts` stores it.

## 2. WebSocket: origin and tickets

### Cross-Site WebSocket Hijacking

Browsers send cookies on the WebSocket handshake too, **and unlike fetch, they do not apply the CORS policy.** Any site can open `new WebSocket("wss://talkio.app/ws/chat/v1/")` and read the victim's messages with the victim's cookie. The only defense is checking the `Origin` header. The old code had no such check. Now `chat_websocket_application()` always puts `AllowedHostsOriginValidator` in front of the stack, and the test `test_session_auth_and_origin_validation` rejects a connection from `https://evil.example`.

### Tickets for when the cookie cannot reach

If the backend lives on another domain, or the host uses bearer tokens, the socket has no cookie. Putting the real token in the URL is a bad idea (URLs get logged). The solution (`ws/tickets.py`):

1. The client calls `POST /ws-ticket/` with its normal HTTP authentication.
2. The server returns a ticket signed with `SECRET_KEY`, valid for 60 seconds.
3. The ticket can be used **only once**: `cache.add(nonce)` is atomic and only the first call succeeds.

A ticket leaked into a log is worthless after a minute or after its first use.

## 3. Rate limiting and the `X-Forwarded-For` bug

A cap of 20 sign-in attempts per minute per IP stops password guessing (brute force). The key question: **where do we read the client's IP from?**

- `REMOTE_ADDR`: the real address of the TCP connection. It cannot be forged, but behind a reverse proxy it is the proxy's own address and every user shares one IP.
- `X-Forwarded-For`: the proxy writes the client's real address here. But **any client can send this header itself.**

When `NUM_PROXIES` is not set, DRF accepts the whole `X-Forwarded-For`. So an attacker sends a fake IP with every request and is never limited. A test proved the bug: 25 attempts, zero blocked. The fix:

```python
"NUM_PROXIES": int(os.getenv("TRUSTED_PROXY_COUNT", "0")),
```

With `0` only `REMOTE_ADDR` is read. With `1` (behind one proxy) only the **last** address in the header is read, the one the proxy itself added; earlier addresses were written by the client and are worthless.

**The general lesson:** any data coming from the client, headers included, can be forged unless you have defined the chain of trust exactly.

## 4. Privacy: 404 instead of 403

If someone guesses the id of a private conversation and gets a 403 (forbidden), they have learned that the conversation exists. So the project returns 404 for both "does not exist" and "you are not a member" (`get_membership`). The same applies to messages and files. Ids are UUIDs, not consecutive numbers, so their count cannot be guessed.

## 5. Safe file uploads

The browser declares a file's `Content-Type` itself, and an attacker can send `virus.exe` as `image/png`. The old code trusted that declaration. The layers of defense in this project:

1. **Detection from content (magic bytes):** PNG always starts with `89 50 4E 47 0D 0A 1A 0A`, JPEG with `FF D8 FF`, PDF with `%PDF-`. `files.detect_content_type` decides the type from the bytes. The declared type is used in exactly one case: choosing between audio and video for containers (WebM, MP4) that were already identified reliably.
2. **An allow-list, not a deny-list.** SVG is never allowed, because it can contain `<script>`.
3. **Real image verification with Pillow:** a corrupt image or a **decompression bomb** (a small file that expands to billions of pixels) is rejected.
4. **Random names on disk:** the user's file name (`../../etc/passwd`) never becomes a storage path.
5. **Private storage:** files are not in the public `MEDIA_ROOT`. In DEBUG only `media/avatars/` is served; previously all of `MEDIA_ROOT` was served, and chat files could be downloaded without authentication.
6. **Download response headers** (`_harden`): `nosniff` (the browser must not guess the type), `Content-Security-Policy: default-src 'none'; sandbox` (even if HTML opens, no script runs), and `Content-Disposition: attachment` for everything except media.

## 6. XSS: inert rendering

The old code inserted messages with `innerHTML`, so a message like `<img src=x onerror=alert(1)>` executed. In React, text is rendered as a **text node** and HTML is never interpreted. `MessageText` splits the text into text and link pieces with `tokenize`, and only `http(s)` becomes a link (`javascript:` does not). Links carry `rel="noopener noreferrer nofollow ugc"`. The test `renders message text inertly` checks this.

A lesser-known attack: **Trojan Source**. Unicode direction-control characters (U+202E and similar) reverse the display order of text. `normalize_body` strips them.

## 7. Malformed input

Instead of a numeric id a user can send `abc` or `99999999999999999999999`. If that reaches the query directly it raises `ValueError` or `OverflowError` (and a database error on Postgres), which becomes a 500. It is not a security hole, but it creates monitoring alerts and log noise and widens the attack surface. The fix is one central function: `users.clean_user_id`, which checks the type and range of the primary key. **Validate at the system boundary, in one place.**

## 8. Demo sign-in with a fixed code

"Any number + 1234" sign-in is effectively an **authentication bypass**. It has three safeguards:

1. It is enabled only with `DEBUG=1` (`DEMO_AUTH_ENABLED = env_bool(...) and DEBUG`), and a test checks that it is always off with `DEBUG=0`.
2. The comparison uses `secrets.compare_digest` (constant time, so the code cannot be guessed from response times).
3. A random username, not the phone number (numbers are not shown to others).

## 9. Honest limitations

Read the "Known limitations" section of [security.md](../../security.md): no end-to-end encryption, socket rate limits are per connection, and so on. **Documenting limitations is part of security**; claiming more security than there is, is more dangerous than admitting a limitation.

## Exercises

1. Create an HTML file and give it a `.png` extension. Upload it. What does the server answer, and which line of code rejects it?
2. With `curl`, perform a WebSocket handshake with `Origin: https://evil.example` and a valid cookie. Which code do you get?
3. Read `test_login_throttle_cannot_be_bypassed_with_spoofed_forwarded_for`, temporarily remove `NUM_PROXIES` from the settings, and run the test.
4. Think about it: to add link previews (a site's title and image), the server would have to fetch the URL. What security risk does that bring? (Keyword: SSRF.)
