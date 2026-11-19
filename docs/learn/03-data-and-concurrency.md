# فصل ۳ — داده، تراکنش و همزمانی

فایل‌های این فصل: `models.py`، `services/messages.py`، `services/conversations.py`، `events.py`، `tests/test_concurrency.py`

این مهم‌ترین فصل بک‌اند است. بیشتر باگ‌های سخت سیستم‌های چت از همزمانی می‌آیند: دو درخواست در یک لحظه.

## ۱. قید دیتابیس، آخرین خط دفاع

کد اپلیکیشن می‌تواند بررسی کند «آیا گفتگوی خصوصی بین A و B وجود دارد؟» و اگر نبود بسازد. ولی بین «بررسی» و «ساختن» چند میلی‌ثانیه فاصله است. اگر دو درخواست همزمان برسند، هر دو «نه» می‌بینند و هر دو می‌سازند. به این الگو **check-then-act race** می‌گویند.

تنها راه مطمئن، **قید یکتا در دیتابیس** است:

```python
direct_key = models.CharField(max_length=200, null=True, unique=True)   # "3:17"
```

حالا درخواست دوم موقع `INSERT` خطای `IntegrityError` می‌گیرد، و کد آن را این‌طور مدیریت می‌کند (`start_direct`):

```python
try:
    with transaction.atomic():
        conv = Conversation.objects.create(kind="direct", direct_key=key, ...)
        ...
except IntegrityError:
    return Conversation.objects.get(direct_key=key), False   # برنده‌ی رقابت را برگردان
```

**درس:** بررسی در کد برای تجربه‌ی کاربری خوب است (پیام خطای خوانا)؛ قید دیتابیس برای درستی است. هر دو لازم‌اند.

قیدهای دیگر پروژه: `unique(conversation, seq)`، `unique(conversation, sender, client_id)`، `unique(conversation, user)` برای عضویت، `unique(message, user, emoji)` برای ری‌اکشن.

## ۲. شماره‌ی ترتیبی بدون فاصله (`seq`)

### مسئله

کد قدیمی برای صفحه‌بندی از `timestamp` استفاده می‌کرد. دو پیام با زمان یکسان؟ یکی در مرز صفحه گم یا تکرار می‌شود. کلاینت هم بعد از قطع اتصال نمی‌توانست بفهمد پیامی از دستش رفته یا نه.

### راه‌حل

هر پیام در هر گفتگو یک عدد پشت‌سرهم می‌گیرد: ۱، ۲، ۳، و الی آخر. اگر کلاینت پیام ۷ را دیده و الان پیام ۱۰ رسیده، می‌فهمد ۸ و ۹ را ندیده.

### پیاده‌سازی (`_create`)

```python
with transaction.atomic():
    Conversation.objects.filter(pk=conv.pk).update(last_seq=F("last_seq") + 1, ...)
    seq = Conversation.objects.values_list("last_seq", flat=True).get(pk=conv.pk)
    message = Message.objects.create(conversation=conv, seq=seq, ...)
```

چرا درست کار می‌کند؟ در PostgreSQL، `UPDATE` روی یک ردیف آن ردیف را **تا پایان تراکنش قفل می‌کند**. تراکنش دومی که همان گفتگو را آپدیت می‌کند صبر می‌کند تا اولی commit یا rollback شود، و بعد مقدار جدید را می‌بیند. پس هیچ دو پیامی یک `seq` نمی‌گیرند.

**چرا `F("last_seq") + 1`؟** اگر مقدار را در Python بخوانید، یکی اضافه کنید و ذخیره کنید (`conv.last_seq += 1; conv.save()`)، دو درخواست هر دو ۵ را می‌خوانند و هر دو ۶ می‌نویسند. به این **lost update** می‌گویند. عبارت `F()` محاسبه را به خود دیتابیس می‌سپارد و اتمیک است.

**چرا فاصله نمی‌افتد؟** اگر بعد از افزایش `seq` خطایی رخ دهد (مثلاً پیوست نامعتبر)، کل تراکنش rollback می‌شود، از جمله افزایش. تست `test_failed_send_rolls_back_sequence` همین را بررسی می‌کند.

**هزینه:** ارسال‌ها در *یک* گفتگو پشت‌سرهم اجرا می‌شوند (نه در کل سیستم). برای چت قابل قبول است و در [ADR 0003](../architecture/decisions/0003-per-conversation-sequence-numbers.md) مستند شده.

### شمارش پیام‌های خوانده‌نشده

با `seq`، «خوانده‌شده» یک عدد به ازای هر عضو است (`Membership.last_read_seq`)، نه یک جدول بزرگ که برای هر پیام ثبت کند چه کسی دیده. تعداد خوانده‌نشده یک کوئری شمارش روی بازه است:

```
پیام‌های حذف‌نشده‌ی دیگران با seq > last_read_seq
```

این شمارش در `serializers.annotate_for_viewer` به شکل **subquery** در همان کوئری لیست گفتگوها محاسبه می‌شود، پس برای ۵۰ گفتگو ۵۰ کوئری جدا زده نمی‌شود (مشکل **N+1**).

به‌روزرسانی marker هم بدون تراکنش اتمیک است:

```python
Membership.objects.filter(pk=..., last_read_seq__lt=seq).update(last_read_seq=seq)
```

شرط `last_read_seq__lt=seq` تضمین می‌کند marker هیچ‌وقت عقب نرود، حتی اگر دو درخواست با ترتیب برعکس برسند. این الگو اسم دارد: **monotonic update**.

## ۳. Idempotency: تکرار امن

شبکه قابل اعتماد نیست. کلاینت پیام را می‌فرستد، پاسخ نمی‌رسد. آیا سرور پیام را گرفته؟ نمی‌داند. اگر دوباره بفرستد ممکن است پیام تکراری شود، و اگر نفرستد ممکن است پیام گم شود.

راه‌حل: کلاینت برای هر پیام یک شناسه‌ی یکتا می‌سازد (`client_id`، یک UUID) و در **همه‌ی تلاش‌ها** همان را می‌فرستد. سرور:

1. اول نگاه می‌کند پیامی با این `(conversation, sender, client_id)` هست یا نه. اگر بود، همان را برمی‌گرداند (`created=False`، شماره‌ی جدید مصرف نمی‌شود، رویداد دوباره پخش نمی‌شود).
2. اگر دو تلاش دقیقاً همزمان برسند، قید یکتا یکی را با `IntegrityError` رد می‌کند و کد همان «برنده» را برمی‌گرداند.

به این **at-least-once delivery + idempotent writes** می‌گویند. سیستم ادعای «exactly-once» نمی‌کند، چون روی شبکه‌ی واقعی تقریباً غیرممکن است. به‌جایش تضمین می‌کند تکرار، اثر تکراری ندارد. ([ADR 0002](../architecture/decisions/0002-at-least-once-idempotent-writes.md))

## ۴. `transaction.on_commit`

```python
events.to_conversation(conv.pk, "message.created", {...})
# در داخل: transaction.on_commit(lambda: _send(group, event))
```

چرا رویداد را بلافاصله نفرستیم؟ چون اگر تراکنش بعداً rollback شود، کلاینت‌ها پیامی دیده‌اند که در دیتابیس وجود ندارد (**phantom event**). `on_commit` تابع را فقط بعد از commit موفق اجرا می‌کند.

**تله در تست:** `TestCase` کل تست را در یک تراکنش می‌گذارد که هیچ‌وقت commit نمی‌شود، پس callbackهای `on_commit` اجرا نمی‌شوند. دو راه دارید: `django_capture_on_commit_callbacks(execute=True)` یا `@pytest.mark.django_db(transaction=True)`. تست‌های WebSocket از دومی استفاده می‌کنند.

## ۵. `SELECT … FOR UPDATE`

وقتی می‌خواهید «بخوانید، تصمیم بگیرید، بنویسید» بدون اینکه کسی وسطش داده را عوض کند، ردیف را هنگام خواندن قفل کنید:

```python
attachments = Attachment.objects.select_for_update().filter(pk__in=ids, uploaded_by=user, message__isnull=True)
```

اینجا (`_bind_attachments`) تضمین می‌شود که یک فایل pending همزمان به دو پیام وصل نشود.

### یک کشف جالب از همین پروژه

در `get_membership(for_update=True)` از `select_related("conversation")` همراه با `select_for_update()` **بدون** `of=` استفاده شده. در PostgreSQL این یعنی هم ردیف عضویت و هم ردیف گفتگوی join شده قفل می‌شوند. من حدس زدم افزودن همزمان یک عضو توسط دو ادمین race دارد. با تست واقعی روی Postgres (`test_concurrent_add_of_the_same_member_is_safe`) معلوم شد **race وجود ندارد**، چون همین قفل ضمنی عملیات را سریالی می‌کند. درس دوگانه:

1. **حدس درباره‌ی همزمانی را با تست واقعی بسنجید.** هم حدس «باگ هست» ممکن است غلط باشد و هم حدس «باگ نیست».
2. رفتاری را که کد به آن تکیه می‌کند **مستند و تست کنید** (یک کامنت و یک تست در پروژه هست)، تا کسی آن را با اضافه کردن `of=("self",)` ندانسته نشکند.

## ۶. Soft delete و tombstone

پیام حذف‌شده واقعاً حذف نمی‌شود: متنش پاک می‌شود و `deleted_at` می‌گیرد. چرا؟

- `seq`ها پشت‌سرهم می‌مانند (کلاینت فاصله‌ی ساختگی نمی‌بیند).
- پاسخ‌هایی که به آن پیام اشاره دارند نمی‌شکنند («این پیام حذف شده»).
- همه‌ی دستگاه‌ها رویداد `message.deleted` را می‌گیرند و نسخه‌ی محلی‌شان را جایگزین می‌کنند.

فایل‌ها ولی واقعاً پاک می‌شوند (حریم خصوصی)، آن هم بعد از commit و فقط اگر ردیف دیگری به همان فایل اشاره نکند (forward فایل را کپی نمی‌کند، فقط ارجاع می‌دهد).

## ۷. صفحه‌بندی cursor-based

صفحه‌بندی با `OFFSET` دو مشکل دارد: در جدول بزرگ کند است، و اگر وسط کار پیام جدیدی بیاید، آیتم‌ها جابه‌جا می‌شوند. **Cursor** یعنی «از بعد از این نقطه بده»:

- پیام‌ها: `before=<seq>` و `after=<seq>`. `seq` یکتا و پایدار است، پس cursor ساده و دقیق است.
- گفتگوها: ترتیب بر اساس `last_activity_at` است که یکتا نیست، پس cursor جفت `(زمان، id)` است و شرط ادامه: `activity < t OR (activity = t AND id < id_cursor)`.

یک باگ واقعی اینجا پیدا شد: cursor اول به شکل خام `2026-11-19T10:00:00+00:00|uuid` بود، و `+` در query string به فاصله تبدیل می‌شد. راه‌حل: **cursor را opaque کنید** (base64url). کلاینت نباید ساختار cursor را بداند.

## تمرین

1. روی PostgreSQL محلی (فصل ۱۰ روش `pgserver` را می‌گوید) تست `test_many_concurrent_sends_and_retries_stay_gap_free` را با ۲۰ thread اجرا کنید. بعد موقتاً در `_create` به‌جای `F()` از `conv.last_seq += 1; conv.save()` استفاده کنید و ببینید تست چطور می‌شکند.
2. توضیح دهید چرا مسیر سریع idempotency (جستجوی `client_id` قبل از تراکنش) به تنهایی کافی نیست.
3. اگر کاربری که قبلاً از گروه رفته دوباره اضافه شود، `last_read_seq` او چه می‌شود و چرا؟ (`add_members` را بخوانید.)
