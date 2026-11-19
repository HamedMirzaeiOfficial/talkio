# REST API — `/api/chat/v1/`

[English](../api/rest-api.md) · **فارسی**

این API را `django_realtime_chat` فراهم می‌کند. نقطهٔ اتصال را میزبان انتخاب می‌کند (`path("api/chat/v1/", include("django_realtime_chat.urls"))`)؛ مسیرهای زیر نسبت به آن‌اند.

## قراردادها

- **احراز هویت:** کلاس‌های احراز هویت DRF میزبان (پیش‌فرض نشست)، یا `CHAT_API_AUTHENTICATION_CLASSES`. همهٔ endpointها کاربر احراز هویت‌شده لازم دارند.
- **CSRF:** با احراز هویت نشست، متدهای غیرامن `X-CSRFToken` لازم دارند (کوکی double-submit جنگو).
- **بدنه‌ها** JSON هستند مگر خلافش گفته شود. **زمان‌ها** ISO 8601 با منطقهٔ زمانی‌اند.
- **شناسه‌ها:** گفت‌وگو، پیام و پیوست UUID هستند؛ کاربران نوع کلید اصلی میزبان را نگه می‌دارند.
- **حریم خصوصی:** گفت‌وگو، پیام یا پیوستی که به آن دسترسی ندارید `404` برمی‌گرداند، هیچ‌وقت `403`؛ تا منابع خصوصی قابل کاوش نباشند.
- **زبان:** با `LocaleMiddleware` در میزبان، `message` خطاها به زبان `Accept-Language` درخواست است (مثلاً `fa`). `code` و `details` هیچ‌وقت ترجمه نمی‌شوند؛ تصمیم‌گیری کلاینت باید بر اساس `code` باشد.
- **خطاها** همیشه یک قالب دارند:

```json
{ "error": { "code": "message_too_long", "message": "Messages are limited to 4000 characters.", "details": { "max_length": 4000 } } }
```

| وضعیت | کدهای رایج |
| --- | --- |
| 400 | `validation_error`، `empty_message`، `message_too_long`، `invalid_client_id`، `invalid_cursor`، `invalid_reply`، `invalid_members`، `invalid_attachments`، `unsupported_file_type`، `file_too_large`، `invalid_image`، `too_many_pending`، `message_deleted` |
| 403 | `not_authenticated`، `forbidden`، `feature_disabled`، `edit_window_expired` |
| 404 | `not_found` |
| 429 | `rate_limited` (با `details.retry_after` به ثانیه و هدر `Retry-After`) |

محدودیت نرخ (`CHAT_RATE_LIMITS`): `http_write` برای متدهای غیرامن، `http_upload` برای آپلود، `http_search` برای جست‌وجو؛ برای هر کاربر و در کش جنگو (با چند worker از Redis استفاده کنید).

## پیکربندی

`GET /config/`: سقف‌ها و پرچم‌های قابلیت برای کلاینت، به‌علاوهٔ کاربر فعلی.

```json
{
  "version": "0.1.0", "protocol_version": 1,
  "user": { "id": 1, "display_name": "Alice Moreau", "username": "alice", "avatar_url": null, "online": true, "last_seen_at": null },
  "features": { "groups": true, "attachments": true, "reactions": true, "user_search": true, "stickers": true, "voice": true },
  "limits": { "max_message_length": 4000, "max_attachment_size": 10485760, "max_attachments_per_message": 10, "max_group_members": 256, "edit_window": null },
  "allowed_attachment_types": ["image/jpeg", "image/png", "…"],
  "allowed_reactions": null, "quick_reactions": ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"],
  "presence_ttl": 60, "typing_timeout": 6
}
```

`POST /ws-ticket/` ← `{ "ticket": "…", "expires_in": 60 }`؛ بلیت امضاشده و یک‌بارمصرف برای احراز هویت WebSocket وقتی کوکی به سوکت نمی‌رسد ([websocket.md](websocket.md#احراز-هویت) را ببینید).

## گفت‌وگوها

### شیء

```json
{
  "id": "uuid", "kind": "group", "title": "Product design", "description": "",
  "created_at": "…", "last_seq": 12, "last_message": { "…message…" }, "last_activity_at": "…",
  "unread_count": 3, "my_role": "owner", "my_last_read_seq": 9, "member_count": 6,
  "peer": null,
  "members": [{ "id": 2, "display_name": "Bob", "username": "bob", "avatar_url": null,
                "online": false, "last_seen_at": "…", "role": "member", "last_read_seq": 12, "joined_at": "…" }]
}
```

برای `kind: "direct"`، `title` نام نمایشی طرف مقابل و `peer` خود اوست. محتوا مخصوص بیننده است (`unread_count`، `my_*`).

| متد | مسیر | بدنه / query | توضیح |
| --- | --- | --- | --- |
| GET | `/conversations/` | `limit` (≤۱۰۰)، `before` (cursor مبهم)، `kind`، `q` | به ترتیب آخرین فعالیت. پاسخ: `{results, has_more, next_cursor}`. |
| POST | `/conversations/` | `{"kind":"direct","user_id":2}` | گفت‌وگوی موجود (`200`، `created:false`) یا جدید (`201`). برای هر جفت کاربر یکتاست، حتی هنگام هم‌زمانی. |
| POST | `/conversations/` | `{"kind":"group","title":"…","member_ids":[2,3],"description":""}` | سازنده `owner` می‌شود. `CHAT_ENABLE_GROUPS` لازم است. |
| GET | `/conversations/{id}/` | | |
| PATCH | `/conversations/{id}/` | `{"title"?, "description"?}` | فقط گروه؛ مدیران/مالک (یا `members_can_edit_info`). |
| POST | `/conversations/{id}/read/` | `{"seq": 12}` | یکنوا: نشانگر هیچ‌وقت عقب نمی‌رود؛ به `last_seq` محدود می‌شود. `read.updated` را پخش می‌کند. |
| GET | `/conversations/{id}/members/` | | `{results: Member[]}` |
| POST | `/conversations/{id}/members/` | `{"user_ids":[4]}` | مدیر/مالک (یا `members_can_add_members`). اعضایی که دوباره اضافه می‌شوند از انتهای فعلی خواندن را شروع می‌کنند. |
| PATCH | `/conversations/{id}/members/{user_id}/` | `{"role":"admin"\|"member"\|"owner"}` | فقط مالک. انتقال `owner` مالک قبلی را مدیر می‌کند. |
| DELETE | `/conversations/{id}/members/{user_id}/` | | حذف عضو، یا ترک گروه وقتی `user_id` خود شما باشد. مالکی که ترک می‌کند مالکیت را به قدیمی‌ترین مدیر، وگرنه عضو، می‌دهد. |

## پیام‌ها

### شیء

```json
{
  "id": "uuid", "conversation_id": "uuid", "seq": 42, "client_id": "8c0b…",
  "sender": { "id": 1, "display_name": "Alice", "username": "alice", "avatar_url": null },
  "body": "Hello", "created_at": "…", "edited_at": null, "deleted_at": null, "is_deleted": false,
  "reply_to": { "id": "uuid", "seq": 40, "conversation_id": "uuid", "sender": {…}, "body": "first 280 chars", "is_deleted": false },
  "forwarded_from": null, "pinned_at": null,
  "attachments": [{ "id": "uuid", "name": "voice.webm", "content_type": "audio/webm", "size": 1234,
                    "width": null, "height": null, "url": "/api/chat/v1/attachments/{id}/download/",
                    "thumbnail_url": null, "is_voice": true, "duration": 3.4, "waveform": [0, 40, 100, 62], "…": "…" }],
  "sticker": null,
  "reactions": [{ "emoji": "👍", "count": 2, "user_ids": [2, 3] }],
  "kind": "voice"
}
```

`kind` محتوا را برای پیش‌نمایش خلاصه می‌کند: `text`، `image`، `gif`، `video`، `audio`، `voice`، `file`، `sticker` یا `deleted` (نقل‌قول پاسخ هم آن را دارد). پیام استیکری `sticker: {id, pack_id, emoji, content_type, width, height, url}` دارد و متن یا پیوست ندارد.

`body` متن ساده است. کلاینت‌ها باید آن را به‌صورت متن رندر کنند (هرگز HTML). پیام حذف‌شده `id` و `seq` خود را نگه می‌دارد (سنگ قبر) با `body`، `attachments` و `reactions` خالی.

| متد | مسیر | بدنه / query | توضیح |
| --- | --- | --- | --- |
| GET | `/conversations/{id}/messages/` | `limit` (≤۱۰۰، پیش‌فرض ۵۰) و **یکی از** `before=<seq>`، `after=<seq>`؛ یا `updated_since=<iso>`؛ یا `pinned=1` | نتیجه همیشه به ترتیب صعودی `seq` است. صفحه‌بندی را ببینید. |
| POST | `/conversations/{id}/messages/` | `{"body", "client_id", "reply_to_id"?, "attachment_ids"?, "sticker_id"?}` | با `client_id` idempotent است (پایین). `201` جدید / `200` با `deduplicated: true`. |
| PATCH | `/messages/{id}/` | `{"body"}` | فقط فرستنده، اگر تنظیم شده در مهلت `CHAT_EDIT_WINDOW`. |
| DELETE | `/messages/{id}/` | | فرستنده، یا مدیر/مالک گروه وقتی `admins_can_delete_messages`. سنگ قبر را برمی‌گرداند. فایل‌ها بعد از commit پاک می‌شوند. |
| POST | `/messages/{id}/reactions/` | `{"emoji"}` | واکنش شما را روشن/خاموش می‌کند. هر ایموجی تکی (با رنگ پوست، دنباله‌های ZWJ، پرچم‌ها) مگر `CHAT_ALLOWED_REACTIONS` فهرست مجاز بدهد. |
| POST | `/messages/{id}/pin/` | | روشن/خاموش. گروه‌ها: مدیران یا `members_can_pin`. |
| POST | `/messages/{id}/forward/` | `{"conversation_id","client_id"}` | عضویت در هر دو گفت‌وگو لازم است؛ پیوست‌ها با ارجاع کپی می‌شوند. |
| GET | `/messages/search/` | `q` (۲ تا ۱۰۰ نویسه)، `conversation_id`؟، `before` (cursor) | فقط گفت‌وگوهایی که عضو فعالشان هستید؛ پیام‌های حذف‌شده نیستند. |

### صفحه‌بندی

هر پیام یک شمارهٔ ترتیب `seq` در گفت‌وگوی خودش دارد (۱، ۲، ۳ …، بدون فاصله).

- آخرین صفحه: `GET …/messages/?limit=50` ← ۵۰ پیام جدیدتر به ترتیب صعودی. `has_more` یعنی پیام قدیمی‌تر هست؛ با `before=<next_cursor>` ادامه دهید.
- پر کردن جاافتادگی: `GET …/messages/?after=<آخرین seq دیده‌شده>` ← پیام‌های جدیدتر به ترتیب صعودی؛ تا وقتی `has_more` با `after=<next_cursor>` ادامه دهید.
- ویرایش/حذف/واکنش از یک زمان: `GET …/messages/?updated_since=<iso>` (تا ۲۰۰).

### Idempotency

`client_id` (۱ تا ۶۴ نویسه، `[A-Za-z0-9_.:-]`) برای هر `(گفت‌وگو، فرستنده)` یکتاست. فرستادن دوبارهٔ همان `client_id` پیام اصلی را برمی‌گرداند، شمارهٔ ترتیبی مصرف نمی‌کند و دوباره پخش نمی‌شود. این حتی با تلاش‌های دوبارهٔ هم‌زمان برقرار است (قید یکتایی دیتابیس + rollback تراکنش). کلاینت‌ها باید برای هر پیام یک UUID بسازند و در هر تلاش دوباره، روی HTTP یا WebSocket، همان را استفاده کنند.

## کاربران

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/users/search/?q=` | فیلدهای جست‌وجوی `CHAT_USER_ADAPTER` را میان کاربرانی که `ChatPolicy.user_queryset()` برمی‌گرداند جست‌وجو می‌کند. `q` خالی کسانی را برمی‌گرداند که با آن‌ها گفت‌وگوی مشترک دارید. حداکثر ۲۰. هیچ‌وقت ایمیل ندارد. |
| GET | `/users/{id}/` | پروفایل با حضور. وقتی قابل پیدا کردن باشد یا گفت‌وگوی مشترک داشته باشید دیده می‌شود. |

## پیوست‌ها

اول آپلود کنید، بعد هنگام ارسال به شناسه‌ها ارجاع دهید.

| متد | مسیر | توضیح |
| --- | --- | --- |
| POST | `/attachments/` | `multipart/form-data` با `conversation_id` و `file`؛ برای پیام صوتی همچنین `voice=1`، `duration` (ثانیه، ≤ `CHAT_MAX_VOICE_DURATION`) و `waveform` (فهرست JSON از حداکثر ۱۲۸ عدد صحیح ۰ تا ۱۰۰). تصاویر ثابت بزرگ یک پیش‌نمایش WebP می‌گیرند (`thumbnail_url`). نوع از روی محتوا (magic bytes) تشخیص داده می‌شود، نه از کلاینت؛ اگر Pillow نصب باشد تصاویر بررسی می‌شوند. یک پیوست در انتظار برمی‌گرداند که فقط آپلودکننده آن را می‌بیند. |
| GET | `/attachments/{id}/` | فراداده. |
| DELETE | `/attachments/{id}/` | دور انداختن آپلود در انتظار خودتان. |
| GET | `/attachments/{id}/download/` | دانلود با بررسی مجوز (`?variant=thumb` برای پیش‌نمایش). هدرهای `X-Content-Type-Options: nosniff`، `Content-Security-Policy: default-src 'none'; sandbox`، `Content-Disposition` (فقط برای تصویر/صوت/ویدیو `inline`) و `Cache-Control: private` را می‌فرستد. |

ظرف‌های WebM و MP4 از روی بایت‌هایشان شناسایی می‌شوند؛ نوع اعلام‌شده فقط بین نسخهٔ صوتی (`audio/webm`، `audio/mp4`؛ ضبط صدای مرورگر) و نسخهٔ ویدیویی تصمیم می‌گیرد.

## استیکرها

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/stickers/` | بسته‌های فعال: `{results: [{id, name, stickers: [{id, pack_id, emoji, content_type, width, height, url}]}]}` |
| GET | `/stickers/{id}/file/` | تصویر (هر کاربر احراز هویت‌شده؛ کش خصوصی طولانی‌مدت). |

بسته‌ها را مدیران در ادمین Django می‌سازند؛ آپلودها اعتبارسنجی می‌شوند (PNG/WebP/GIF، ≤ `CHAT_MAX_STICKER_SIZE`، ≤ ۵۱۲×۵۱۲). با `{"sticker_id": "…"}` و بدون متن/پیوست بفرستید. بسته‌های بازنشسته (`is_active=False`) قابل ارسال نیستند ولی پیام‌های قدیمی همچنان نمایش داده می‌شوند.

سقف‌ها: `CHAT_MAX_ATTACHMENT_SIZE`، `CHAT_ALLOWED_ATTACHMENT_TYPES` (انواع فعال مثل SVG/HTML را یک system check رد می‌کند)، `CHAT_MAX_ATTACHMENTS_PER_MESSAGE`، `CHAT_MAX_PENDING_ATTACHMENTS` (برای هر کاربر در ۲۴ ساعت). `manage.py chat_purge_uploads` آپلودهای هرگز فرستاده‌نشده را پاک می‌کند.

## endpointهای اپ مستقل (جزو پکیج نیستند)

`apps/server` مسیر `/api/auth/` را اضافه می‌کند: `GET session/` (راه‌اندازی + کوکی CSRF)، `POST login/`، `POST register/`، `POST logout/`، `GET|PATCH me/`، `POST me/password/`؛ و `/api/health/`، `/api/health/ready/`. خطاهای این مسیرها هم به زبان `Accept-Language` هستند. میزبان‌هایی که پکیج را جاسازی می‌کنند از احراز هویت خودشان استفاده می‌کنند.
