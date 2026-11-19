# راهنمای یادگیری Talkio

این راهنما برای **مطالعه** نوشته شده، نه برای مرجع سریع. هدفش این است که با خواندن کد واقعی همین پروژه، مفاهیم مهندسی نرم‌افزار را عمیق یاد بگیرید: چرا هر تصمیم گرفته شده، چه جایگزین‌هایی وجود داشت، و چه باگ‌هایی در مسیر پیدا شد.

> مرجع فنی دقیق (انگلیسی): [backend.md](../backend.md) و [frontend.md](../frontend.md). قراردادهای API: [rest-api.md](../api/rest-api.md) و [websocket.md](../api/websocket.md).

## پیش‌نیاز

- Python و مقدمات Django (model، view، migration)
- JavaScript/TypeScript و مقدمات React (component، hook، state)
- آشنایی با HTTP و Git

لازم نیست Channels، WebSocket، Tailwind یا Playwright بلد باشید؛ در فصل‌ها توضیح داده می‌شوند.

## فصل‌ها

| # | فصل | موضوع اصلی |
| --- | --- | --- |
| ۱ | [نقشه‌ی معماری](01-architecture.md) | monorepo، لایه‌ها، چرا سه پکیج |
| ۲ | [پکیج قابل‌استفاده‌ی مجدد Django](02-reusable-django-app.md) | `AUTH_USER_MODEL`، تنظیمات، system check، policy و adapter |
| ۳ | [داده، تراکنش و همزمانی](03-data-and-concurrency.md) | constraint، `seq`، قفل ردیف، idempotency، `on_commit` |
| ۴ | [ارتباط بلادرنگ](04-realtime.md) | ASGI، Channels، group، طراحی پروتکل، presence |
| ۵ | [امنیت](05-security.md) | session/CSRF، ticket، origin، rate limit، آپلود امن، XSS |
| ۶ | [SDK تایپ‌اسکریپت](06-typescript-sdk.md) | state machine، backoff، store، optimistic UI، بازیابی |
| ۷ | [React و کتابخانه‌ی کامپوننت](07-react-library.md) | `useSyncExternalStore`، StrictMode، اسکرول، دسترس‌پذیری |
| ۸ | [CSS، طراحی و ایزوله‌سازی](08-css-and-design.md) | specificity، cascade layers، توکن‌ها، RTL |
| ۹ | [رسانه: ایموجی، استیکر، ویس، فایل](09-media.md) | یونیکد و grapheme، فونت در برابر تصویر، MediaRecorder |
| ۱۰ | [تست](10-testing.md) | هرم تست، fake، تست تراکنشی، همزمانی، Playwright |
| ۱۱ | [بسته‌بندی، CI و استقرار](11-packaging-and-ops.md) | `pyproject`، ESM، Docker، CI، تنظیمات production |
| ۱۲ | [درس‌های باگ‌ها](12-bug-stories.md) | ۱۲ باگ واقعی این پروژه و درس هرکدام |

## مسیر پیشنهادی مطالعه

1. فصل ۱ را بخوانید و پروژه را با Quick start در README اجرا کنید. با دو مرورگر و دو کاربر پیام بدهید.
2. فصل‌های ۲ تا ۵ (بک‌اند) را به ترتیب بخوانید و هر بار فایل‌هایی را که اسم برده می‌شود کنارش باز کنید.
3. فصل‌های ۶ تا ۹ (فرانت) را بخوانید.
4. فصل ۱۰ را بخوانید و تست‌ها را خودتان اجرا کنید؛ یک تست را عمداً بشکنید و ببینید چه می‌شود.
5. فصل ۱۲ را آخر بخوانید؛ بعد از دیدن کد، داستان باگ‌ها معنای بیشتری دارد.

هر فصل با چند **تمرین** تمام می‌شود. تمرین‌ها را واقعاً انجام دهید؛ بیشترین یادگیری همان‌جاست.

## نحوه‌ی خواندن کد

- **از قراردادها شروع کنید، نه از جزئیات.** اول [websocket.md](../api/websocket.md) را بخوانید، بعد `ws/consumer.py`.
- **مسیر یک درخواست را دنبال کنید.** مثلاً «ارسال پیام» را از دکمه‌ی Send در `MessageComposer.tsx` تا `services/messages.py::_create` و برگشت `message.created` دنبال کنید.
- **تست‌ها مستندات اجرایی‌اند.** وقتی نمی‌دانید یک تابع دقیقاً چه می‌کند، تستش را بخوانید.
