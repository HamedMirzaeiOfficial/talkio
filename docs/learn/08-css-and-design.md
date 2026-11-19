# فصل ۸ — CSS، طراحی و ایزوله‌سازی استایل

فایل‌های این فصل: `packages/react-chat/src/styles/{index,base}.css`، `apps/web/src/styles.css`، `packages/react-chat/test/styles.test.tsx`، [design-system.md](../design-system.md)، [ADR 0007](../architecture/decisions/0007-style-isolation.md)

## ۱. مسئله: کامپوننتی که در خانه‌ی دیگران زندگی می‌کند

ویجت چت داخل سایت میزبان رندر می‌شود. دو خطر هست:

1. **CSS میزبان ویجت را خراب کند.** مثلاً `button { border-radius: 0 }` یا `* { font-family: Georgia }`.
2. **CSS ویجت سایت میزبان را خراب کند.** مثلاً یک reset سراسری مثل `* { margin: 0 }` در CSS کتابخانه.

راه‌حل‌های رایج و چرا انتخاب نشدند:

- **Shadow DOM:** ایزوله‌سازی کامل، ولی portalهای Radix، فونت‌ها و تم میزبان را می‌شکند.
- **iframe:** خیلی سنگین است و ارتباطش با اپ میزبان سخت.

انتخاب شد: **پیشوند + متغیرها + reset محدود + کنترل دقیق cascade.**

## ۲. Specificity: چه قانونی برنده می‌شود؟

وقتی دو قانون CSS یک ویژگی را تنظیم می‌کنند، به ترتیب این‌ها بررسی می‌شود:

1. **Cascade layer** (`@layer`): قوانین بیرون از هر layer از قوانین داخل layer قوی‌ترند.
2. **Specificity:** `(id, class, element)`؛ `#a` = (1,0,0)، `.a` = (0,1,0)، `button` = (0,0,1)، `*` = (0,0,0).
3. **ترتیب در سورس:** با specificity برابر، قانونی که بعد آمده برنده است.

`:where(...)` specificity صفر دارد. پس `.rc-root :where(*)` = (0,1,0).

## ۳. طراحی reset

```css
.rc-root, .rc-root :where(*) {          /* (0,1,0) */
  margin: 0; padding: 0; box-sizing: border-box;
  font-family: inherit; line-height: inherit; ...
}
```

- در برابر `button { ... }` میزبان (0,0,1): reset برنده است. ✓
- در برابر `.rc\:px-3 { padding-inline: ... }` خود کتابخانه (0,1,0): برابرند، پس **ترتیب** تعیین می‌کند. reset باید **قبل** از utilityها بیاید.

### باگ: reset بعد از utilityها

اولین نسخه این شکلی بود:

```css
@import 'tailwindcss/utilities.css' prefix(rc);
/* … */
.rc-root :where(*) { padding: 0; }   /* بعد از utilityها! */
```

`@import`ها همیشه در ابتدای فایل قرار می‌گیرند. پس reset بعد از همه‌ی utilityها آمد و **همه‌ی paddingها صفر شد**. این در اسکرین‌شات‌ها کاملاً مشخص بود (همه‌چیز به هم چسبیده بود)، در حالی که هیچ تست واحدی آن را نگرفته بود، چون jsdom layout ندارد. راه‌حل: reset به فایل جدای `base.css` منتقل و **قبل از** utilityها import شد. یک تست هم ترتیب را در CSS نهایی بررسی می‌کند.

### باگ: ارث‌بری فونت

قانون `* { font-family: Georgia }` در سایت میزبان specificity صفر دارد ولی **مستقیماً** روی هر عنصر اعمال می‌شود. قاعده‌ی مهم CSS: **هر قانون صریح، حتی با specificity صفر، از ارث‌بری قوی‌تر است.** ارث‌بری فقط وقتی کار می‌کند که هیچ قانونی آن ویژگی را تعیین نکرده باشد. پس متن داخل ویجت Georgia می‌شد. راه‌حل: reset خودش `font-family: inherit` را با specificity (0,1,0) تنظیم می‌کند و ارث‌بری را از `.rc-root` دوباره برقرار می‌کند. تست E2E `widget-example.spec.ts` فونت یک عنصر **داخلی** را بررسی می‌کند. نسخه‌ی اول تست فقط ریشه را بررسی می‌کرد و برای همین این باگ را ندید.

## ۴. Cascade layers و unlayered بودن utilityها

Tailwind v4 به‌طور پیش‌فرض utilityها را در `@layer utilities` می‌گذارد. اگر سایت میزبان CSS بدون layer داشته باشد، مثل `button { background: red }`، آن قانون از **هر** قانون layer‌دار قوی‌تر است، حتی از `.rc\:bg-primary`. برای همین utilityهای کتابخانه بدون layer import شده‌اند:

```css
@import 'tailwindcss/utilities.css' prefix(rc);   /* بدون layer() */
```

## ۵. پیشوند

با `prefix(rc)`، کلاس‌ها `rc:flex` و `rc:bg-surface` هستند. حتی اگر میزبان خودش Tailwind داشته باشد، کلاس‌های دو طرف تداخل نمی‌کنند.

## ۶. Design token با CSS custom properties

```css
.rc-root { --rc-bg: #f9fafb; --rc-primary: #4f46e5; ... }
.rc-root[data-rc-theme='dark'] { --rc-bg: #0f1117; --rc-primary: #818cf8; ... }
```

و در Tailwind:

```css
@theme inline { --color-surface: var(--rc-surface); }
```

مزیت‌ها:

- تغییر تم = عوض شدن یک attribute. هیچ کلاسی در کامپوننت‌ها عوض نمی‌شود.
- میزبان رنگ برندش را با یک prop می‌دهد (`tokens={{ primary: '#0f766e' }}`) و `useThemeRoot` آن را به شکل `style` inline روی ریشه می‌گذارد.
- اپ Talkio همان توکن‌ها را در Tailwind خودش استفاده می‌کند، پس chrome اپ و کامپوننت‌های چت هرگز رنگ‌های متفاوت نمی‌گیرند.

`.rc-tokens` کلاسی است برای صفحه‌ای که فقط متغیرها را می‌خواهد و reset را نه. `<html>` اپ این کلاس را دارد. نسخه‌ی اول `rc-root` روی `<html>` بود و reset کتابخانه روی کل اپ اعمال می‌شد؛ یکی از دلایل همان باگ padding بود.

## ۷. جلوگیری از چشمک تم

اگر تم بعد از لود شدن React اعمال شود، صفحه یک لحظه سفید و بعد تیره می‌شود. `apps/web/index.html` یک اسکریپت کوچک **قبل از** bundle دارد که تنظیم ذخیره‌شده را از `localStorage` می‌خواند و `data-rc-theme` را فوراً روی `<html>` می‌گذارد.

## ۸. RTL و متن دوجهته

- **Logical properties:** به‌جای `padding-left` از `padding-inline-start` (`rc:ps-3`) استفاده شده. وقتی میزبان `dir="rtl"` بگذارد، کل UI خودکار آینه می‌شود.
- **`dir="auto"` روی متن کاربر:** مرورگر جهت را از اولین کاراکتر «قوی» تعیین می‌کند. پیام فارسی راست‌چین و پیام انگلیسی چپ‌چین می‌شود، داخل یک UI واحد.
- آیکون‌های جهت‌دار (فلش «برگشت»، آیکون ارسال) در RTL برعکس می‌شوند (`rc:rtl:rotate-180`).

## ۹. باگ عجیب: `.gitignore` و Tailwind

Tailwind v4 فایل‌های **gitignored** را برای پیدا کردن کلاس‌ها اسکن نمی‌کند. فایل `.gitignore` قدیمی یک خط `media` داشت (برای آپلودهای Django)، که پوشه‌ی `components/media/` (انتخابگر ایموجی) را هم شامل می‌شد. نتیجه دو مشکل بود: کلاس‌های آن کامپوننت‌ها در CSS ساخته نمی‌شد (پنل ۲۶ هزار پیکسل ارتفاع گرفت!)، و **git هم آن فایل‌ها را نادیده می‌گرفت**، یعنی در commit گم می‌شدند. درس: الگوهای `.gitignore` را **لنگر** بزنید (`/apps/server/media/`، نه `media`).

## تمرین

1. در DevTools روی یک دکمه‌ی ویجت در `examples/react-integration`، پنل Computed را باز کنید و ببینید کدام قانون `border-radius` برنده شده و چرا.
2. موقتاً `@import './base.css'` را به بعد از خط utilities منتقل کنید و `npm run build` و تست `styles.test.tsx` را اجرا کنید.
3. یک تم جدید «sepia» با بازتعریف چند توکن روی `.rc-root[data-rc-theme='sepia']` بسازید. چه چیز دیگری لازم است تا از `ChatSettings` قابل انتخاب شود؟
