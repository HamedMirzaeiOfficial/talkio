# فصل ۱۱ — بسته‌بندی، CI و استقرار

## ۱. پکیج پایتون مدرن

`packages/django-chat/pyproject.toml`:

- **src layout** (`src/django_realtime_chat/`): پکیج فقط بعد از نصب قابل import است، پس تست‌ها نسخه‌ی نصب‌شده را تست می‌کنند، نه پوشه‌ی جاری را. این جلوی باگ «روی ماشین من کار می‌کند ولی فایل X در wheel نیست» را می‌گیرد.
- **بازه‌ی نسخه‌ی وابستگی‌ها** (`Django>=4.2,<6.0`): پکیج نباید نسخه‌ی دقیق پین کند (`==`)، وگرنه با پروژه‌ی میزبان تداخل می‌کند. پین دقیق جای اپلیکیشن است (فایل `requirements.txt` سرور)، نه کتابخانه.
- **extras** (`[redis]`، `[images]`، `[test]`): وابستگی‌های اختیاری. کسی که Redis نمی‌خواهد آن را نصب نمی‌کند.
- `py.typed`: به ابزارهای type checking می‌گوید این پکیج type hint دارد.
- `python -m build` هر دو خروجی را می‌سازد: `sdist` (سورس) و `wheel` (آماده‌ی نصب).

## ۲. پکیج npm با ESM

`packages/chat-client/package.json`:

```json
"type": "module",
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
"sideEffects": false
```

- `exports` مشخص می‌کند دقیقاً چه چیزی قابل import است؛ فایل‌های داخلی خصوصی می‌مانند.
- `sideEffects: false` به bundlerها اجازه‌ی **tree-shaking** می‌دهد (کد استفاده‌نشده حذف شود). در کتابخانه‌ی React، فقط فایل‌های CSS side effect دارند.
- **peerDependencies** برای React: کتابخانه نباید نسخه‌ی خودش از React را بیاورد. دو نسخه‌ی React در یک صفحه یعنی خطای «A React Element from an older version». این دقیقاً در این پروژه رخ داد، وقتی npm نسخه‌ی ۱۹ را در ریشه گذاشت و پکیج نسخه‌ی ۱۸ داشت.

### پسوند `.js` در import

```ts
import { ChatError } from './errors.js';   // در فایل .ts!
```

عجیب به نظر می‌رسد، ولی ESM استاندارد در Node پسوند را حدس نمی‌زند. TypeScript هم importها را بازنویسی نمی‌کند. bundlerها (Vite) بدون پسوند هم کار می‌کنند، پس این باگ فقط وقتی دیده می‌شود که پکیج در Node خام import شود، که `verify-packages.sh` دقیقاً همین را تست می‌کند.

## ۳. npm workspaces

یک `package-lock.json` و یک `node_modules` در ریشه. پکیج‌ها با symlink به هم وصل‌اند. مشکل رایج اینجا **چند نسخه از یک وابستگی** است (React 18 و 19، Vite 5 و 6). راه‌حل: نسخه‌ی مشترک را در `devDependencies` ریشه پین کنید تا یک نسخه hoist شود، و با `npm ls react` بررسی کنید.

## ۴. Docker

`Dockerfile`:

- ایمیج `python:3.12-slim`، با `PYTHONDONTWRITEBYTECODE` و `PYTHONUNBUFFERED` (لاگ‌ها فوراً دیده شوند).
- اول فقط `requirements.txt` و پکیج کپی می‌شوند، بعد بقیه‌ی کد. این‌طور لایه‌ی نصب وابستگی‌ها تا وقتی requirements عوض نشده cache می‌ماند و build سریع است.
- کاربر غیر root (`useradd … talkio`): اگر برنامه نفوذپذیر باشد، مهاجم root کانتینر نمی‌شود.
- `HEALTHCHECK` روی `/api/health/`.

`docker-compose.yml` برای توسعه: Postgres و Redis با healthcheck، و سرور با `depends_on: condition: service_healthy`. سرور تا وقتی دیتابیس واقعاً آماده نشده شروع نمی‌کند، نه فقط تا وقتی کانتینرش بالا آمده.

## ۵. CI (`.github/workflows/ci.yml`)

- **ماتریس:** پکیج روی Django 4.2 و 5.2، و روی SQLite و PostgreSQL (به‌شکل service container).
- **`makemigrations --check`:** اگر کسی مدل را عوض کند و migration نسازد، CI شکست می‌خورد.
- **`check --deploy`** با `DEBUG=0`: هشدارهای امنیتی production.
- **`concurrency`:** با push جدید، اجرای قبلی همان branch لغو می‌شود.
- **trace در شکست:** گزارش Playwright به‌عنوان artifact آپلود می‌شود تا شکست قابل بررسی باشد.

یک باگ قدیمی: CI قبلی روی پوشه‌ی `src/` تنظیم شده بود که وجود نداشت، پس **هرگز** پاس نمی‌شد. CIای که همیشه قرمز است، از نبودن CI بدتر است، چون همه یاد می‌گیرند نادیده‌اش بگیرند.

## ۶. تنظیمات production

[deployment.md](../deployment.md) را کامل بخوانید. نکات کلیدی که یاد گرفتنی‌اند:

- **Fail fast:** بدون `DJANGO_SECRET_KEY` و با `DEBUG=0`، سرور اصلاً بالا نمی‌آید، به‌جای اینکه بی‌صدا با یک کلید پیش‌فرض ناامن کار کند.
- **Twelve-factor:** همه‌ی تنظیمات محیطی از environment variable خوانده می‌شوند (`.env.example` لیست کامل است). کد بین dev و production یکی است.
- **Redis برای بیش از یک پروسه:** حافظه‌ی پروسه بین workerها مشترک نیست؛ presence، throttle و ticket یک‌بارمصرف بدون Redis فقط در یک پروسه درست کار می‌کنند. system check `W002` این را یادآوری می‌کند.
- **`TRUSTED_PROXY_COUNT`:** فصل ۵.
- **سقف حجم درخواست روی proxy:** Daphne کل بدنه‌ی درخواست را قبل از رسیدن به Django روی دیسک می‌نویسد. پس جلوگیری از آپلود چندگیگابایتی باید روی nginx یا proxy پلتفرم انجام شود.
- **Healthcheck دوگانه:** `/api/health/` (پروسه زنده است) در برابر `/api/health/ready/` (دیتابیس و Redis در دسترس‌اند). load balancer باید ترافیک را فقط به نمونه‌های «ready» بفرستد.

## تمرین

1. `./scripts/verify-packages.sh` را اجرا کنید. بعد موقتاً یکی از importهای `.js` را در SDK بدون پسوند کنید، build کنید و دوباره اجرا کنید.
2. با `npm ls react` و `npm ls vite` بررسی کنید فقط یک نسخه از هر کدام نصب است.
3. یک `render.yaml` طراحی کنید که web service و متغیرهای محیطی لازم را تعریف کند. کدام متغیرها secret هستند؟
