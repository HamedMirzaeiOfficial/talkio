# فصل ۷ — React و کتابخانه‌ی کامپوننت

[English](en/07-react-library.md) · **فارسی**

فایل‌های این فصل: `packages/react-chat/src/{context.tsx,hooks.ts}`، `components/MessageList.tsx`، `components/MessageComposer.tsx`، `components/MessageBubble.tsx`، `components/primitives.tsx`

## ۱. اتصال store به React: `useSyncExternalStore`

React 18 hook مخصوصی برای خواندن از store خارجی دارد:

```ts
useSyncExternalStore(client.subscribe, getSnapshot)
```

این hook تضمین می‌کند همه‌ی کامپوننت‌ها در یک render یک نسخه‌ی یکسان از state را ببینند (جلوگیری از **tearing** در rendering همزمان).

ظرافت: `getSnapshot` باید برای state یکسان **همان مقدار** را برگرداند، وگرنه React فکر می‌کند همیشه تغییر رخ داده و در حلقه‌ی بی‌نهایت می‌افتد. برای همین `useChatState(selector)` نتیجه را memoize می‌کند. `useStableArray` یک قدم جلوتر می‌رود: اگر selector یک آرایه‌ی **جدید** با همان آیتم‌ها برگرداند (مثل `filter`)، آرایه‌ی قبلی برگردانده می‌شود.

## ۲. درس StrictMode: چه کسی مالک منابع است؟

در حالت توسعه، React StrictMode هر effect را عمداً **دو بار** اجرا می‌کند (mount، unmount، mount) تا کدهایی که پاک‌سازی درستی ندارند را لو دهد. کد اولیه‌ی اپ این بود:

```tsx
const client = useMemo(() => createAppChatClient(), [userId]);
useEffect(() => () => client.dispose(), [client]);
```

StrictMode: mount، بعد cleanup (client dispose می‌شود!)، بعد mount دوباره **با همان client مرده**، چون `useMemo` مقدارش را نگه داشته. نتیجه این بود که اپ لود می‌شد ولی هیچ گفتگویی نشان نمی‌داد. این را تست E2E پیدا کرد، نه تست واحد.

راه درست: منبع را **داخل** effect بسازید و در cleanup همان را از بین ببرید:

```ts
export function useCreateChatClient(factory, deps) {
  const [client, setClient] = useState(null);
  useEffect(() => {
    const instance = factory();
    setClient(instance);
    return () => instance.dispose();
  }, deps);
  return client;
}
```

هر mount client خودش را دارد و هر cleanup client خودش را از بین می‌برد. این hook به کتابخانه اضافه شد تا هر میزبانی از این تله در امان باشد، و تست مخصوصش با StrictMode وجود دارد.

**درس:** «چه کسی منبع را می‌سازد و چه کسی از بین می‌برد» را همیشه صریح کنید. `ChatProvider` عمداً client را از بین **نمی‌برد**، چون مالکش نیست.

## ۳. Context برای چیزهای سراسری

`ChatProvider` چیزهایی را نگه می‌دارد که همه‌ی کامپوننت‌ها لازم دارند: client، تم، رشته‌های متن (برای ترجمه)، توکن‌های رنگ، و آدرس تصاویر ایموجی. نکته‌ی کارایی: `value` با `useMemo` ساخته شده، وگرنه با هر render والد، همه‌ی مصرف‌کننده‌ها re-render می‌شدند.

## ۴. لیست پیام‌ها: سخت‌ترین کامپوننت

### حفظ محل اسکرول هنگام بارگذاری پیام‌های قدیمی

وقتی کاربر بالا می‌رود و ۵۰ پیام قدیمی‌تر **بالای** لیست اضافه می‌شود، محتوای قابل‌مشاهده پایین می‌پرد. راه‌حل در `useLayoutEffect` (که قبل از paint اجرا می‌شود، پس کاربر پرش را نمی‌بیند):

```ts
if (first !== previous.first && last === previous.last) {      // به ابتدا اضافه شده
  el.scrollTop += el.scrollHeight - prevHeight;
}
```

مرورگرها قابلیتی به اسم **scroll anchoring** دارند که همین کار را خودکار انجام می‌دهد. اگر هر دو فعال باشند، اصلاح دو بار انجام می‌شود. برای همین `overflow-anchor: none` تنظیم شده و کنترل دستی است.

### چسبیدن به پایین، ولی نه همیشه

پیام جدید رسید. اگر کاربر پایین لیست است، اسکرول کن. اگر بالا رفته و دارد تاریخچه می‌خواند، **اسکرول نکن** (خیلی آزاردهنده است) و یک دکمه‌ی «۳ پیام جدید» نشان بده. استثنا: اگر پیام مال خود کاربر است، همیشه اسکرول کن.

### جداکننده‌ی «پیام‌های جدید»

موقع باز شدن گفتگو، `my_last_read_seq + 1` **یک‌بار** snapshot گرفته می‌شود. اگر از مقدار زنده‌ی state استفاده می‌شد، به محض اینکه گفتگو «خوانده‌شده» علامت می‌خورد، جداکننده ناپدید می‌شد.

## ۵. Composer: جزئیاتی که حرفه‌ای بودن را می‌سازند

- **IME:** کاربرانی که با کیبورد فارسی، چینی یا ژاپنی تایپ می‌کنند، Enter را برای تأیید کلمه می‌زنند. `event.nativeEvent.isComposing` بررسی می‌شود تا پیام نصفه فرستاده نشود.
- **پیش‌نویس هر گفتگو:** یک `Map` در سطح ماژول. با عوض کردن گفتگو، متن نیمه‌کاره گم نمی‌شود.
- **ارتفاع خودکار:** `height = auto` و بعد `height = scrollHeight`، با سقف ۲۰۰ پیکسل.
- **موبایل:** فونت ۱۶ پیکسل روی صفحه‌های کوچک (iOS برای فونت زیر ۱۶ پیکسل صفحه را zoom می‌کند) و `env(safe-area-inset-bottom)` برای iPhoneهای بدون دکمه.
- **فوکوس:** بعد از انتخاب «Reply» از منو، Radix فوکوس را به دکمه‌ی منو برمی‌گرداند و composer فوکوس نمی‌گرفت. راه‌حل: `onCloseAutoFocus` با `preventDefault` و فوکوس با تأخیر (`setTimeout 0`)، چون focus trap منو هنوز در همان commit فعال است. این را تست واحد `replies via the message menu and cancels with Escape` پیدا کرد.

## ۶. Portalها و تم

منوها و دیالوگ‌های Radix در یک **portal** رندر می‌شوند، یعنی مستقیماً زیر `<body>` و بیرون از درخت DOM کامپوننت. پس متغیرهای CSS که روی `.rc-root` کامپوننت تعریف شده‌اند به آن‌ها نمی‌رسند. راه‌حل: `useThemeRoot()` روی محتوای هر portal هم کلاس `rc-root` و `data-rc-theme` و توکن‌ها را می‌گذارد.

## ۷. دسترس‌پذیری (a11y)

- هر دکمه‌ی آیکون‌دار `aria-label` دارد (`IconButton` بدون `label` ساخته نمی‌شود).
- لیست پیام `role="log"` و `aria-live="polite"` دارد: صفحه‌خوان پیام‌های جدید را اعلام می‌کند بی‌آنکه حرف کاربر را قطع کند.
- لیست گفتگوها با کلیدهای ↑/↓ پیمایش می‌شود.
- `prefers-reduced-motion` همه‌ی انیمیشن‌ها را خاموش می‌کند.
- تست‌ها با `getByRole` و نام دسترس‌پذیر می‌نویسند (`getByRole('button', { name: 'Reply' })`). اگر تست نتواند دکمه را با نقش و نامش پیدا کند، صفحه‌خوان هم نمی‌تواند. **تست‌نویسی با role خودش آزمون دسترس‌پذیری است.**

## ۸. کامپوننت‌هایی که مسیریابی نمی‌کنند

`ConversationList` هیچ‌وقت `navigate` صدا نمی‌زند؛ `onSelect` و `getHref` را از میزبان می‌گیرد. میزبان ممکن است React Router، Next.js یا اصلاً بدون router باشد. با `href` واقعی، کلیک وسط یا Ctrl+کلیک تب جدید باز می‌کند، و کلیک عادی `onSelect` را صدا می‌زند. **کتابخانه نباید تصمیم‌های اپلیکیشن را بگیرد.**

## تمرین

1. در `MessageList.tsx`، `useLayoutEffect` را به `useEffect` تغییر دهید و در مرورگر تاریخچه را بالا ببرید. چه می‌بینید؟ چرا؟
2. با React DevTools (Highlight updates) ببینید وقتی کاربر دیگری تایپ می‌کند کدام کامپوننت‌ها re-render می‌شوند. آیا `MessageBubble`ها هم re-render می‌شوند؟ چرا نه؟ (راهنما: `memo`.)
3. یک hook جدید `useConversationMembers(id)` بنویسید که فقط لیست اعضا را برگرداند و با تغییر پیام‌ها re-render نشود.
