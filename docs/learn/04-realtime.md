# فصل ۴ — ارتباط بلادرنگ: ASGI، Channels و طراحی پروتکل

فایل‌های این فصل: `apps/server/core/asgi.py`، `ws/consumer.py`، `ws/middleware.py`، `events.py`، `presence.py`، `services/presence.py`، [websocket.md](../api/websocket.md)

## ۱. WSGI در برابر ASGI

**WSGI** (مدل کلاسیک Django) فرض می‌کند هر درخواست یک پاسخ دارد و تمام می‌شود. WebSocket یک اتصال طولانی است که هر دو طرف هر زمانی پیام می‌فرستند. **ASGI** نسخه‌ی async این استاندارد است و از اتصال‌های طولانی پشتیبانی می‌کند. **Daphne** سرور ASGI است، و **Channels** لایه‌ای است که WebSocket را به Django می‌آورد.

```python
# core/asgi.py
application = ProtocolTypeRouter({
    "http": django_application,                         # درخواست‌های معمولی
    "websocket": chat_websocket_application(...),        # WebSocket
})
```

## ۲. Consumer و channel layer

هر اتصال WebSocket یک نمونه از `ChatConsumer` است. مسئله: پیامی که در پروسه‌ی A ذخیره شده باید به کاربری برسد که socketش روی پروسه‌ی B است. **Channel layer** (در production، Redis) این مشکل را حل می‌کند:

- هر consumer یک «کانال» یکتا دارد.
- کانال‌ها می‌توانند عضو **group** شوند (`group_add`).
- `group_send(group, message)` پیام را به همه‌ی کانال‌های عضو می‌رساند، در هر پروسه‌ای که باشند.

در این پروژه دو نوع group هست:

| Group | اعضا | کاربرد |
| --- | --- | --- |
| `rtchat.c.<conversation>` | همه‌ی socketهای اعضای گفتگو | پیام، ویرایش، تایپ، خواندن، presence |
| `rtchat.u.<user>` | همه‌ی socketهای یک کاربر | `conversation.updated` / `removed` (payload مخصوص هر بیننده) |

## ۳. یک socket برای هر کلاینت

کد قدیمی برای هر اتاق یک socket باز می‌کرد. برای لیست گفتگوها با badge «خوانده‌نشده» باید از همه‌ی گفتگوها رویداد بگیرید؛ با ۳۰ گفتگو یعنی ۳۰ socket. طراحی جدید: **یک socket در `/ws/chat/v1/`** که موقع اتصال به group همه‌ی گفتگوهای کاربر می‌پیوندد ([ADR 0004](../architecture/decisions/0004-one-socket-per-client.md)).

وقتی کاربر به گفتگوی جدیدی اضافه می‌شود، socket باید بدون اتصال مجدد عضو group جدید شود. این‌طور انجام می‌شود: سرویس `conversation.updated` را به group کاربر می‌فرستد و consumer در `chat_event` همان لحظه `group_add` می‌کند. برعکسش هم هست: `conversation.removed` باعث `group_discard` می‌شود، به‌علاوه‌ی یک فیلتر که رویدادهای «جامانده» (که قبل از discard در صف بودند) را دور بریزد.

## ۴. چرخه‌ی عمر اتصال

```python
async def connect(self):
    await self.accept()                          # ۱. اول قبول کن
    if not self.user.is_authenticated:
        await self._error("not_authenticated", ...)
        await self.close(code=4401)              # ۲. بعد با کد مشخص ببند
        return
```

چرا اول accept و بعد close؟ اگر handshake رد شود، مرورگر فقط یک خطای کلی شبکه می‌بیند و فرقش را با «سرور خاموش است» نمی‌فهمد، پس مدام تلاش مجدد می‌کند. با accept و close با **کد اپلیکیشن** (۴۴۰۱ یعنی احراز هویت نشده)، SDK می‌فهمد تلاش مجدد فایده ندارد. کدهای ۴۰۰۰ تا ۴۹۹۹ برای اپلیکیشن‌ها رزرو شده‌اند.

## ۵. از thread تا async: `database_sync_to_async`

consumer روی event loop کار می‌کند (async). ORM جنگو sync است. اگر ORM را مستقیم در کد async صدا بزنید، کل loop قفل می‌شود و Django هم خطای `SynchronousOnlyOperation` می‌دهد. راه‌حل:

```python
@database_sync_to_async
def _send_message(user, data): ...       # در یک thread اجرا می‌شود
result = await _send_message(self.user, content)
```

همین تابع‌های service که view استفاده می‌کند، اینجا هم استفاده می‌شوند. این نتیجه‌ی جداسازی لایه‌ها در فصل ۱ است.

## ۶. طراحی پروتکل

اصولی که در [websocket.md](../api/websocket.md) رعایت شده:

- **هر فریم یک `type` دارد.** پیام سرور و کلاینت هر دو JSON با `type`.
- **request/ack correlation.** کلاینت `request_id` می‌فرستد؛ پاسخ (`ack` یا `error`) همان را برمی‌گرداند. این‌طوری چند درخواست همزمان روی یک socket قاطی نمی‌شوند.
- **payload یکسان با REST.** `message.created` همان شیء پیامی را دارد که `GET /messages/` برمی‌گرداند، چون هر دو از `serializers.message_payload` می‌آیند.
- **محدودیت‌ها مستند:** سقف ۶۴ کیلوبایت هر فریم، rate limit برای هر دسته.
- **صداقت درباره‌ی تضمین‌ها:** ترتیب فقط داخل یک گفتگو (با `seq`) تضمین می‌شود، نه بین گفتگوها. رویدادها ممکن است گم شوند و کلاینت باید با `after` و `updated_since` بازیابی کند.

## ۷. تایپ کردن: داده‌ی گذرا

«علی در حال تایپ است» در دیتابیس ذخیره نمی‌شود. مستقیم به channel layer می‌رود. سه محافظ دارد:

1. **Throttle سمت سرور:** حداکثر یک `typing.start` هر ۲ ثانیه برای هر اتصال و گفتگو.
2. **انقضا:** هر رویداد `expires_in` دارد؛ اگر `typing.stop` گم شود، کلاینت بعد از ۶ ثانیه خودش نشانگر را پاک می‌کند.
3. **فیلتر:** رویداد تایپ خود شخص برایش فرستاده نمی‌شود.

**درس:** داده‌ی گذرا را از داده‌ی پایدار جدا کنید. چیزی که اگر گم شود مهم نیست، نباید هزینه‌ی دیتابیس داشته باشد.

## ۸. Presence: آنلاین بودن با چند دستگاه

کد قدیمی یک `Boolean online` داشت: گوشی وصل می‌شد و می‌شد `True`، لپ‌تاپ قطع می‌شد و می‌شد `False`، در حالی که گوشی هنوز وصل بود. یک شمارنده (`active_connections`) هم مشکل را حل نمی‌کند، چون اگر سرور crash کند، `disconnect` اجرا نمی‌شود و شمارنده برای همیشه بالا می‌ماند.

### راه‌حل: lease با انقضا

هر اتصال یک **lease** دارد: «اتصال X تا زمان T زنده است». کاربر آنلاین است اگر حداقل یک lease منقضی‌نشده داشته باشد. کلاینت هر ۳۰ ثانیه `ping` می‌فرستد و lease تمدید می‌شود. اگر سرور crash کند، leaseها بعد از ۶۰ ثانیه خودبه‌خود منقضی می‌شوند و نیازی به پاک‌سازی نیست.

در Redis این با یک **sorted set** پیاده شده (`RedisPresenceStore`): عضو = id اتصال، امتیاز = زمان انقضا.

```
ZREMRANGEBYSCORE key -inf now     # حذف منقضی‌ها
ZCARD key                         # قبل از افزودن: آیا آفلاین بود؟
ZADD key expiry connection_id
EXPIRE key ttl*2                  # خود کلید هم بالاخره پاک شود
```

همه در یک **pipeline**، یعنی یک رفت‌وبرگشت شبکه.

بخش پایدار، یعنی «آخرین بازدید»، فقط وقتی آخرین lease آزاد می‌شود در دیتابیس (`UserPresence`) نوشته می‌شود.

## ۹. پخش بعد از commit و «best effort»

`events._send` خطاهای channel layer را log می‌کند ولی بالا نمی‌اندازد. اگر Redis لحظه‌ای در دسترس نباشد، **پیام ذخیره می‌شود** ولی پخش نمی‌شود. کلاینت‌ها بعداً با بازیابی آن را می‌گیرند. درس طراحی: **مسیر حیاتی (ذخیره‌ی داده) نباید به مسیر کمکی (اعلان) وابسته باشد.**

## تمرین

1. دو تب مرورگر با یک کاربر باز کنید. یکی را ببندید. تب کاربر دیگر چه presence‌ای نشان می‌دهد؟ کجای کد این را تضمین می‌کند؟
2. تست `test_membership_changes_update_subscriptions` را بخوانید و قدم‌به‌قدم توضیح دهید چرا پیام بعد از حذف عضو به او نمی‌رسد.
3. یک رویداد جدید `message.viewed` (رسید «دیده شد» برای پیام‌های ویس) طراحی کنید: payload، اینکه پایدار است یا گذرا، و به کدام group فرستاده شود.
