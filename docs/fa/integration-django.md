# یکپارچه کردن `django-realtime-chat` با یک پروژهٔ Django موجود

[English](../integration/django.md) · **فارسی**

یک نمونهٔ کامل در [`examples/django-integration`](../../examples/django-integration) هست (`django.contrib.auth.User` استاندارد، یک policy سفارشی، فضای ذخیره‌سازی خصوصی، تست‌ها).

## ۱. نصب

```bash
pip install "django-realtime-chat[redis,images]"   # redis: حضور چندپروسه‌ای؛ images: بررسی تصاویر با Pillow
```

پیش‌نیازها: Python 3.10 به بالا، Django 4.2 یا 5.2، DRF 3.14 به بالا، Channels 4. برای WebSocket یک سرور ASGI (Daphne، Uvicorn) لازم است.

## ۲. تنظیمات

```python
INSTALLED_APPS += ["rest_framework", "channels", "django_realtime_chat"]

ASGI_APPLICATION = "myproject.asgi.application"
CHANNEL_LAYERS = {"default": {"BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [REDIS_URL]}}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}

STORAGES = {
    **STORAGES,
    # عمومی سرو نمی‌شود. هر storage جنگو کار می‌کند (مثلاً S3 بدون ACL عمومی).
    "chat_files": {"BACKEND": "django.core.files.storage.FileSystemStorage",
                   "OPTIONS": {"location": BASE_DIR / "private_media", "base_url": None}},
}
CHAT_ATTACHMENT_STORAGE = "chat_files"
CHAT_PRESENCE_BACKEND = "redis"
CHAT_REDIS_URL = REDIS_URL
```

بعد `python manage.py migrate`.

**زبان.** پکیج پیام‌های انگلیسی و فارسی دارد (`locale/fa/`، کاتالوگ‌های استاندارد gettext). برای اینکه به زبان کلاینت جواب بدهد، middleware زبان جنگو را فعال کنید و زبان‌هایی را که پشتیبانی می‌کنید فهرست کنید:

```python
MIDDLEWARE.insert(MIDDLEWARE.index("django.middleware.common.CommonMiddleware"), "django.middleware.locale.LocaleMiddleware")
LANGUAGES = [("en", "English"), ("fa", "فارسی")]
```

آن وقت خطاهای REST از `Accept-Language` پیروی می‌کنند و خطاهای WebSocket از `?lang=` در آدرس سوکت (که گزینهٔ `language` در SDK می‌فرستد) یا `Accept-Language` درخواست handshake. پروژهٔ شما می‌تواند هر پیامی را با گذاشتن همان msgid در کاتالوگی زیر `LOCALE_PATHS` بازنویسی کند؛ جنگو اول آن‌جا را می‌گردد.

## ۳. URLها و ASGI

```python
# urls.py — فضای نام "realtime_chat" را include تعیین می‌کند
path("api/chat/v1/", include("django_realtime_chat.urls")),
```

```python
# asgi.py
from channels.routing import ProtocolTypeRouter
from django.core.asgi import get_asgi_application
django_app = get_asgi_application()
from django_realtime_chat.routing import chat_websocket_application

application = ProtocolTypeRouter({
    "http": django_app,
    "websocket": chat_websocket_application(),  # احراز هویت با نشست و بلیت، با بررسی مبدأ
})
```

برای ساختن استک خودتان، از `ChatAuthMiddlewareStack` و `websocket_urlpatterns` در `django_realtime_chat.routing` استفاده کنید و یک بررسی‌کنندهٔ مبدأ را جلویش نگه دارید.

## ۴. احراز هویت

پکیج هیچ‌وقت خودش کاربران را احراز هویت نمی‌کند.

- **REST:** از `REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]` شما استفاده می‌کند، یا از `CHAT_API_AUTHENTICATION_CLASSES` (مسیرهای نقطه‌دار) برای بازنویسی فقط در چت؛ مثلاً کلاس JWT خودتان.
- **WebSocket:** وقتی مرورگر روی همان سایت به سوکت می‌رسد، کوکی نشست کار می‌کند. وگرنه کلاینت `POST /api/chat/v1/ws-ticket/` را (با احراز هویت REST شما) صدا می‌زند و با `?ticket=` وصل می‌شود. بلیت‌ها امضاشده‌اند، ۶۰ ثانیه اعتبار دارند و یک‌بارمصرف‌اند.

حالت «به این شناسهٔ کاربر اعتماد کن» وجود ندارد. هویت کاربر همیشه از `request.user` / `scope["user"]` می‌آید.

## ۵. مرجع تنظیمات

همه اختیاری‌اند و هنگام شروع با system checkها (`realtime_chat.E00x`) اعتبارسنجی می‌شوند.

| تنظیم | پیش‌فرض | کاربرد |
| --- | --- | --- |
| `CHAT_ENABLE_GROUPS` | `True` | اجازهٔ گفت‌وگوی گروهی |
| `CHAT_ENABLE_ATTACHMENTS` | `True` | اجازهٔ آپلود |
| `CHAT_ENABLE_REACTIONS` | `True` | اجازهٔ واکنش |
| `CHAT_ENABLE_USER_SEARCH` | `True` | اجازهٔ `/users/search/` |
| `CHAT_ENABLE_STICKERS` | `True` | بسته‌های استیکر و پیام استیکری |
| `CHAT_ENABLE_VOICE` | `True` | پیام صوتی (پیوست هم باید فعال باشد) |
| `CHAT_MAX_VOICE_DURATION` | `600` | ثانیه |
| `CHAT_MAX_STICKER_SIZE` | `512 KiB` | بایت برای هر فایل استیکر |
| `CHAT_THUMBNAIL_SIZE` | `480` | بلندترین ضلع پیش‌نمایش تصویر (پیکسل) |
| `CHAT_MAX_MESSAGE_LENGTH` | `4000` | نویسه |
| `CHAT_MAX_ATTACHMENT_SIZE` | `10 MiB` | بایت برای هر فایل |
| `CHAT_MAX_ATTACHMENTS_PER_MESSAGE` | `10` | |
| `CHAT_MAX_PENDING_ATTACHMENTS` | `20` | آپلود ارسال‌نشده برای هر کاربر در ۲۴ ساعت |
| `CHAT_MAX_GROUP_MEMBERS` | `256` | |
| `CHAT_ALLOWED_ATTACHMENT_TYPES` | تصاویر (با GIF)، PDF، متن، صوت (با `audio/webm` و `audio/mp4` برای پیام صوتی)، ویدیو | فهرست مجاز نوع تشخیص‌داده‌شده (SVG/HTML را یک check رد می‌کند) |
| `CHAT_ATTACHMENT_STORAGE` | `"default"` | نام مستعار در `STORAGES`؛ از یک storage خصوصی استفاده کنید |
| `CHAT_ATTACHMENT_UPLOAD_TO` | `"chat/attachments/%Y/%m/"` | پوشه؛ نام فایل‌ها تصادفی است |
| `CHAT_ALLOWED_REACTIONS` | `None` | `None` یعنی هر ایموجی؛ یک فهرست واکنش‌ها را محدود می‌کند |
| `CHAT_QUICK_REACTIONS` | ۸ ایموجی | اول در انتخابگرها پیشنهاد می‌شوند |
| `CHAT_DEFAULT_PERMISSIONS` | پایین را ببینید | کلیدهای policy پیش‌فرض |
| `CHAT_POLICY` | `django_realtime_chat.permissions.ChatPolicy` | قلاب‌های مجوز |
| `CHAT_USER_ADAPTER` | `django_realtime_chat.users.DefaultUserAdapter` | نام نمایشی، شناسه، آواتار، فیلدهای جست‌وجو |
| `CHAT_PRESENCE_BACKEND` | `"memory"` | برای بیش از یک پروسه `"redis"` (وگرنه هشدار `W002`) |
| `CHAT_REDIS_URL` | `None` | برای حضور با Redis لازم است |
| `CHAT_PRESENCE_TTL` | `60` | ثانیهٔ lease؛ کلاینت‌ها هر TTL/2 ping می‌فرستند |
| `CHAT_TYPING_TIMEOUT` | `6` | ثانیه‌هایی که «در حال نوشتن» بدون تازه شدن می‌ماند |
| `CHAT_EDIT_WINDOW` | `None` | ثانیه‌های بعد از ارسال که ویرایش مجاز است |
| `CHAT_WS_TICKET_TTL` | `60` | ثانیه |
| `CHAT_API_AUTHENTICATION_CLASSES` | `None` | بازنویسی احراز هویت DRF برای viewهای چت |
| `CHAT_RATE_LIMITS` | `http_write 120/m, http_upload 30/m, http_search 60/m, ws_message 30/10s, ws_typing 20/10s, ws_other 60/10s` | با پیش‌فرض‌ها ادغام می‌شود |

پیش‌فرض‌های `CHAT_DEFAULT_PERMISSIONS`: `members_can_add_members=False`، `members_can_edit_info=False`، `members_can_pin=True`، `admins_can_delete_messages=True`.

## ۶. قلاب‌های گسترش

```python
# myproject/chat.py
from django_realtime_chat.permissions import ChatPolicy
from django_realtime_chat.users import DefaultUserAdapter

class TenantPolicy(ChatPolicy):
    def user_queryset(self, user):          # چه کسانی قابل پیدا کردن و افزودن‌اند
        return super().user_queryset(user).filter(tenant=user.tenant)

    def can_send_message(self, user, conversation, membership):
        return super().can_send_message(user, conversation, membership) and not user.is_suspended

class ProfileAdapter(DefaultUserAdapter):
    search_fields = ("username", "profile__nickname")
    def display_name(self, user): return user.profile.nickname or user.get_username()
    def avatar_url(self, user):   return user.profile.photo.url if user.profile.photo else None
```

```python
CHAT_POLICY = "myproject.chat.TenantPolicy"
CHAT_USER_ADAPTER = "myproject.chat.ProfileAdapter"
```

متدهای policy: `user_queryset`، `can_search_users`، `can_start_direct`، `can_create_group`، `can_edit_conversation`، `can_add_members`، `can_remove_member`، `can_change_role`، `can_send_message`، `can_edit_message`، `can_delete_message`، `can_pin_message`.

## ۷. سیگنال‌ها

بعد از commit از `django_realtime_chat.signals` فرستاده می‌شوند: `message_created(message, created_by)`، `message_updated`، `message_deleted`، `conversation_created`، `members_changed(conversation, added_user_ids, removed_user_ids, changed_by)`. برای اعلان push، خلاصهٔ ایمیلی یا ایندکس جست‌وجو از آن‌ها استفاده کنید.

## ۸. صدا زدن مستقیم سرویس‌ها

`django_realtime_chat.services.*` توابع هم‌گام ساده‌ای هستند که همان مجوزهای API را اعمال می‌کنند؛ مثلاً `send_message(user, conversation_id, body="…")`، `start_direct(user, other_id)`، `create_group(user, title=…, member_ids=[…])`. پخش رویدادها بعد از commit زمان‌بندی می‌شود. پیام خطاها به زبان فعال جنگو در لحظهٔ صدا زدن است (`translation.override("fa")`).

## ۹. نگهداری

- `python manage.py chat_purge_uploads --hours 24` (در cron) آپلودهایی را که هیچ‌وقت فرستاده نشده‌اند پاک می‌کند.
- ادمین: گفت‌وگوها، پیام‌ها (در فهرست فقط فراداده)، پیوست‌ها، واکنش‌ها و حضور ثبت شده‌اند.
