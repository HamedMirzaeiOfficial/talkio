# فصل ۲ — ساختن یک پکیج Django قابل‌استفاده‌ی مجدد

فایل‌های این فصل: `packages/django-chat/pyproject.toml`، `src/django_realtime_chat/{apps,conf,checks,users,permissions,urls,routing}.py`

## ۱. تفاوت «app درون پروژه» با «پکیج»

یک app معمولی Django می‌تواند هر چیزی از پروژه را import کند. یک **پکیج** نمی‌تواند، چون نمی‌داند در کدام پروژه نصب می‌شود. کد قدیمی `from accounts.models import User` داشت؛ یعنی بدون اپ `accounts` اصلاً کار نمی‌کرد. قدم اول ساختن پکیج، بریدن همه‌ی این وابستگی‌هاست.

## ۲. مدل کاربر قابل تعویض

Django اجازه می‌دهد هر پروژه مدل کاربر خودش را داشته باشد (`AUTH_USER_MODEL`). پکیج باید با هر مدلی کار کند:

```python
# models.py
sender = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="rtchat_messages")
```

و در migration:

```python
dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
```

`swappable_dependency` به Django می‌گوید «این migration به migration اولِ هر مدل کاربری که پروژه انتخاب کرده وابسته است».

**درس `related_name`:** هر `ForeignKey` روی مدل مقصد یک «accessor معکوس» می‌سازد (`user.chat_messages`). اگر پکیج اسم ساده‌ای انتخاب کند، ممکن است با accessor یک app دیگر در پروژه‌ی میزبان تداخل کند. دقیقاً همین در این پروژه رخ داد: `chat_attachments` هم در پکیج بود و هم در app قدیمی، و `manage.py check` خطای `fields.E304` داد. راه‌حل: پیشوند اختصاصی `rtchat_`. **یک پکیج باید در فضای نام‌های مشترک (accessorها، جدول‌ها، کلیدهای cache، اسم groupها) همیشه پیشوند بگذارد.** نمونه‌ها در کد: `rtchat:throttle:`، `rtchat:presence:`، `rtchat.c.` و `rtchat.u.`.

## ۳. نمایش کاربر بدون دانستن مدلش: Adapter

پکیج باید اسم کاربر و عکسش را نشان بدهد، ولی نمی‌داند مدل کاربر فیلد `avatar` دارد یا `photo` یا هیچ‌کدام. الگوی **Adapter** این مشکل را حل می‌کند (`users.py`):

```python
class DefaultUserAdapter:
    def display_name(self, user): ...
    def handle(self, user): ...
    def avatar_url(self, user): ...
    def search(self, queryset, query): ...
```

میزبان یک زیرکلاس می‌نویسد و با `CHAT_USER_ADAPTER` معرفی می‌کند. نمونه‌ی واقعی: `apps/server/accounts/chat_adapter.py` که دو مشکل داده‌های قدیمی را حل می‌کند. یکی اینکه نام خانوادگی `NULL` بود و `get_full_name()` نتیجه‌ی «Alice None» می‌داد. دیگری اینکه کاربران قدیمی شماره‌ی تلفن را به‌عنوان username داشتند و نباید نمایش داده شود (حریم خصوصی).

## ۴. مجوزها قابل توسعه: Policy

همه‌ی تصمیم‌های «آیا اجازه دارد؟» در یک کلاس جمع شده‌اند (`permissions.py::ChatPolicy`). مزیت‌ها:

- **یک جا برای بازبینی امنیتی.** لازم نیست در ده فایل دنبال if بگردید.
- **قابل توسعه بدون fork.** مثال واقعی در `examples/django-integration/host_project/policies.py`: فقط هم‌تیمی‌ها می‌توانند همدیگر را پیدا کنند.

```python
class TeamPolicy(ChatPolicy):
    def user_queryset(self, user):
        teams = Group.objects.filter(user=user)
        return super().user_queryset(user).filter(groups__in=teams).distinct()
```

نکته‌ی ظریف: `user_queryset` نه فقط برای جستجو، بلکه در `_resolve_users` هم استفاده می‌شود؛ یعنی کسی که نمی‌توانید پیدایش کنید را با فرستادن مستقیم id هم نمی‌توانید به گروه اضافه کنید. **مجوز باید در مسیر نوشتن اعمال شود، نه فقط در UI.**

## ۵. تنظیمات: پیش‌فرض‌های معقول + اعتبارسنجی

`conf.py` همه‌ی تنظیمات را با پیشوند `CHAT_` و یک دیکشنری `DEFAULTS` تعریف می‌کند. سه نکته‌ی طراحی:

1. **خواندن lazy در هر دسترسی** (`__getattr__`). اگر تنظیمات یک‌بار موقع import کپی می‌شد، `override_settings` در تست کار نمی‌کرد.
2. **ادغام دیکشنری‌ها.** میزبان می‌تواند فقط `{"http_write": "60/m"}` بدهد و بقیه‌ی rate limitها پیش‌فرض بمانند.
3. **System check** (`checks.py`). Django موقع `runserver`، `migrate` و `check --deploy` این تابع را اجرا می‌کند. اشتباه تایپی `CHAT_MAX_MESAGE_LENGTH` همان اول هشدار `W001` می‌دهد، نه اینکه بی‌صدا نادیده گرفته شود. یا اگر کسی `image/svg+xml` را به فایل‌های مجاز اضافه کند، خطای `E007` می‌گیرد (SVG می‌تواند JavaScript داشته باشد).

**درس:** خطای پیکربندی باید **زود و بلند** باشد. بدترین باگ‌ها تنظیماتی‌اند که بی‌صدا نادیده گرفته می‌شوند.

## ۶. URLها با namespace

```python
# urls.py
app_name = "realtime_chat"
```

میزبان تصمیم می‌گیرد پکیج را کجا mount کند (`/api/chat/v1/` یا هر جای دیگر). پکیج آدرس‌ها را hardcode نمی‌کند؛ با `reverse("realtime_chat:attachment-download", args=[id])` می‌سازد. برای همین لینک فایل‌ها همیشه با محل نصب درست است.

## ۷. یک تله‌ی واقعی: callable storage

```python
file = models.FileField(storage=attachment_storage, ...)
```

مستندات Django می‌گوید `storage` می‌تواند یک callable باشد. چیزی که کمتر گفته می‌شود: این callable **یک‌بار موقع load شدن مدل‌ها** صدا زده می‌شود. پس اگر تابع مستقیم `storages["..."]` را برگرداند، تغییر تنظیمات بعدی (مثلاً در تست) اثری ندارد. این را یک تست نشان داد: فایل‌ها به‌جای storage حافظه‌ای تست، روی دیسک نوشته می‌شدند. راه‌حل در `models.py` یک `LazyObject` است که با سیگنال `setting_changed` ریست می‌شود.

## ۸. سازگاری با چند نسخه‌ی Django

پکیج روی Django 4.2 و 5.2 (هر دو LTS) تست شده: یک venv جدا با Django 4.2، DRF 3.14 و Channels 4.0 همه‌ی تست‌ها را پاس می‌کند. در CI هم ماتریس نسخه‌ها وجود دارد. برای پکیج، **حداقل نسخه‌ای را که ادعا می‌کنید واقعاً تست کنید.** مثال واقعی: Channels 4.0 در `channels.testing` به `daphne` نیاز دارد. این فقط با تست روی نسخه‌ی قدیمی معلوم شد و به `test` extras اضافه شد.

## تمرین

1. یک تنظیم جدید `CHAT_MAX_PINNED_MESSAGES` اضافه کنید: پیش‌فرض در `DEFAULTS`، بررسی در `checks.py`، اعمال در `toggle_pin`، و یک تست.
2. یک `ChatPolicy` بنویسید که پیام فرستادن را برای کاربرانی که `is_staff` نیستند در گروه‌هایی با عنوان شروع‌شده با `[Announcement]` ممنوع کند. کجا تستش می‌کنید؟
3. چرا `get_policy()` با `lru_cache` روی **مقدار تنظیم** cache شده، نه به‌صورت یک متغیر global ساده؟ (راهنما: تست‌هایی که `CHAT_POLICY` را عوض می‌کنند.)
