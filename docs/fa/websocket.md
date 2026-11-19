# پروتکل WebSocket — نسخهٔ ۱

[English](../api/websocket.md) · **فارسی**

## endpointها

| آدرس | محدوده |
| --- | --- |
| `/ws/chat/v1/` | همهٔ گفت‌وگوهای کاربر احراز هویت‌شده (پیشنهادی؛ یک سوکت برای هر کلاینت). |
| `/ws/chat/v1/conversations/{id}/` | فقط یک گفت‌وگو (اگر عضو نباشید با `4404` بسته می‌شود). |

frameها متن JSON هستند، حداکثر ۶۴ کیلوبایت. هر frame یک `type` دارد.

پارامتر اختیاری `?lang=fa` (یا `en`) زبان پیام‌های خطای همین اتصال را تعیین می‌کند؛ بدون آن `Accept-Language` درخواست handshake و بعد `LANGUAGE_CODE` سرور استفاده می‌شود. `code` خطاها همیشه ثابت است.

## احراز هویت

1. **کوکی نشست** (استقرار روی یک سایت): `AuthMiddlewareStack` در Channels نشست Django را از handshake می‌خواند.
2. **بلیت** (بک‌اند روی سایت دیگر، توکن bearer): `POST /api/chat/v1/ws-ticket/` روی HTTPS احراز هویت‌شده یک بلیت برمی‌گرداند؛ به `…/ws/chat/v1/?ticket=<ticket>` وصل شوید. بلیت‌ها با `SECRET_KEY` سرور امضا می‌شوند، بعد از `CHAT_WS_TICKET_TTL` ثانیه (پیش‌فرض ۶۰) منقضی می‌شوند و فقط **یک بار** قابل استفاده‌اند (`cache.add` اتمی؛ با چند worker از کش مشترکی مثل Redis استفاده کنید).

handshake همیشه **مبدأ را بررسی می‌کند** (`AllowedHostsOriginValidator`، یا فهرست صریحی که به `chat_websocket_application(allowed_origins=[…])` داده می‌شود). بدون آن هر وب‌سایتی می‌توانست با کوکی‌های بازدیدکننده سوکت باز کند.

سرور اتصال را پیش از بررسی احراز هویت می‌پذیرد تا کلاینت بتواند کد بستن را بخواند:

| کد بستن | معنی | رفتار کلاینت |
| --- | --- | --- |
| `4401` | احراز هویت نشده | دیگر وصل نشود؛ دوباره احراز هویت کند. |
| `4404` | گفت‌وگوی محدوده پیدا نشد / عضو نیستید | متوقف شود. |
| `4000` | بسته‌شده توسط کلاینت (تمام شدن مهلت ضربان، آفلاین شدن مرورگر) | دوباره وصل شود. |
| بقیه | شبکه / ری‌استارت سرور | با backoff دوباره وصل شود. |

## رویدادهای سرور ← کلاینت

| `type` | محتوا | محدوده |
| --- | --- | --- |
| `connection.ready` | `protocol_version`، `connection_id`، `user`، `conversation_ids`، `heartbeat_interval` (ثانیه)، `server_time` | یک بار بعد از احراز هویت. |
| `message.created` | `conversation_id`، `message` | اعضای گفت‌وگو |
| `message.updated` | `conversation_id`، `message` (ویرایش، تغییر سنجاق) | اعضا |
| `message.deleted` | `conversation_id`، `message` (سنگ قبر) | اعضا |
| `reaction.updated` | `conversation_id`، `message_id`، `seq`، `reactions` | اعضا |
| `typing.updated` | `conversation_id`، `user_id`، `is_typing`، `expires_in` (ثانیه) | اعضا به‌جز نویسنده |
| `presence.updated` | `conversation_id`، `user_id`، `online`، `last_seen_at` | اعضای هر گفت‌وگوی مشترک (ممکن است برای هر گفت‌وگوی مشترک یک بار برسد) |
| `read.updated` | `conversation_id`، `user_id`، `last_read_seq` | اعضا |
| `conversation.updated` | `conversation` (محتوای مخصوص بیننده) | سوکت خود هر عضو؛ سرور سوکت را در گفت‌وگوهای جدید هم مشترک می‌کند |
| `conversation.removed` | `conversation_id` | کاربر حذف‌شده؛ سرور اشتراک سوکت را لغو می‌کند |
| `ack` | `request_id`، `data` | فقط سوکت درخواست‌کننده |
| `error` | `code`، `message`، `request_id`؟، `details`؟ | فقط سوکت درخواست‌کننده |
| `pong` | `request_id`، `server_time` | فقط سوکت درخواست‌کننده |

اشیای پیام و گفت‌وگو دقیقاً همان محتوای REST هستند ([rest-api.md](rest-api.md)).

## رویدادهای کلاینت ← سرور

```jsonc
{ "type": "ping", "request_id": "p1" }
{ "type": "message.send", "request_id": "r1", "conversation_id": "uuid", "client_id": "uuid",
  "body": "Hello", "reply_to_id": null, "attachment_ids": [], "sticker_id": null }
{ "type": "typing.start", "conversation_id": "uuid" }
{ "type": "typing.stop",  "conversation_id": "uuid" }
{ "type": "read.mark", "request_id": "r2", "conversation_id": "uuid", "seq": 42 }
```

- `message.send` ← `ack` با `data: { message, deduplicated }`، یا `error` با همان `request_id`. پخش `message.created` به همهٔ اعضا (از جمله دستگاه‌های دیگر فرستنده) **بعد از commit دیتابیس** انجام می‌شود؛ فرستنده ممکن است پخش را پیش یا پس از `ack` دریافت کند.
- `read.mark` ← `ack` با `data: { conversation_id, last_read_seq }`.
- `typing.start` در سرور به یک پخش در هر ۲ ثانیه برای هر اتصال محدود می‌شود؛ کلاینت تا وقتی کاربر می‌نویسد دوباره می‌فرستد. گیرنده‌ها نشانگر را بعد از `expires_in` ثانیه بدون تازه شدن حذف می‌کنند.
- `ping` lease حضور را تازه می‌کند. آن را هر `heartbeat_interval` ثانیه بفرستید؛ اگر حدود ۱۰ ثانیه `pong` نرسید، اتصال را مرده بدانید و دوباره وصل شوید.

ویرایش، حذف، واکنش، سنجاق و تغییرات عضویت از طریق REST انجام می‌شوند؛ اثرشان به‌صورت رویداد می‌رسد.

## کدهای خطا

همهٔ کدهای خطای REST ممکن است بیایند (همان سرویس‌ها پشت هر دو انتقال اجرا می‌شوند)، به‌علاوهٔ: `invalid_frame`، `invalid_event`، `unknown_event`، `not_authenticated`، `internal_error`. `rate_limited` شامل `details.retry_after` است. سقف‌ها: `CHAT_RATE_LIMITS["ws_message"|"ws_typing"|"ws_other"]`، برای هر اتصال.

## حضور

هر اتصال یک lease دارد (`connection_id ← زمان انقضا`) که `ping` تازه‌اش می‌کند. کاربر تا وقتی هر leaseی زنده است آنلاین است؛ پس چند زبانه و دستگاه پشتیبانی می‌شوند و leaseهای workerی که کرش کرده بعد از `CHAT_PRESENCE_TTL` ثانیه منقضی می‌شوند. وقتی آخرین lease آزاد شود، سرور `last_seen_at` را (به‌طور ماندگار) ذخیره و `presence.updated` را پخش می‌کند. leaseهایی که *منقضی* می‌شوند (کرش) پخش نمی‌شوند؛ کلاینت‌ها تغییر را در تازه‌سازی بعدی گفت‌وگو می‌بینند.

## ترتیب، تحویل و بازیابی

- **نوشتن دست‌کم یک بار، رویداد با بهترین تلاش.** نوشتن‌ها با `client_id` idempotent هستند؛ رویدادها برای هر سوکت متصل حداکثر یک بار تحویل می‌شوند و با قطع اتصال ممکن است گم شوند. پروتکل تحویل دقیقاً یک‌باره **نمی‌دهد**.
- **ترتیب برای هر گفت‌وگو و با `seq` است.** ترتیب رسیدن بین گفت‌وگوهای مختلف معنایی ندارد. کلاینت‌ها بر اساس `seq` مرتب می‌کنند.
- **تشخیص جاافتادگی:** اگر یک `message.created` مقدار `seq > last_seen + 1` داشت، `GET …/messages/?after=<last_seen>` را بگیرید.
- **بعد از اتصال دوباره:** فهرست گفت‌وگوها را دوباره بار کنید (شمار نخوانده، گفت‌وگوهای جدید)، برای هر گفت‌وگوی باز `after=<آخرین seq>` را بگیرید، و برای ویرایش‌ها و حذف‌ها `updated_since=<زمان آخرین connection.ready>`. پیام‌های تأییدنشده را با همان `client_id` اصلی دوباره بفرستید.

`@realtime-chat/client` همهٔ این‌ها را پیاده‌سازی می‌کند.

## سازگاری

پروتکل پیش از پکیج (`/ws/chat/<slug>/`، `message.create`، `typing.changed` و…) حذف شده است. [migration-from-v1.md](../api/migration-from-v1.md) (انگلیسی) را ببینید.
