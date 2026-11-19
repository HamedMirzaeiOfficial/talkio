# استفاده از SDK تایپ‌اسکریپت و کامپوننت‌های React

[English](../integration/react.md) · **فارسی**

نمونهٔ کامل: [`examples/react-integration`](../../examples/react-integration)؛ یک اپ موجود با CSS سراسری سخت‌گیرانه که `<ChatWidget/>` را روی نشست Django خودش جاسازی می‌کند.

```bash
npm install @realtime-chat/client @realtime-chat/react
# وابستگی‌های همتا: react >= 18.2، react-dom >= 18.2
```

## ۱. ساخت کلاینت

```ts
import { bearerAuth, createChatClient, sessionAuth } from '@realtime-chat/client';

// نشست Django روی همان سایت (پیش‌فرض): کوکی‌ها و X-CSRFToken از کوکی csrftoken.
const client = createChatClient({
  baseUrl: '/api/chat/v1',
  wsUrl: '/ws/chat/v1',
  auth: sessionAuth({ onUnauthorized: () => location.assign('/login') }),
});

// احراز هویت با توکن: SDK در هر درخواست توکن را از کد شما می‌خواهد و هیچ‌وقت ذخیره‌اش نمی‌کند.
const tokenClient = createChatClient({
  baseUrl: 'https://chat.example.com/api/chat/v1',
  wsUrl: 'wss://chat.example.com/ws/chat/v1',
  auth: bearerAuth({ getToken: () => auth.currentAccessToken() }), // بلیت‌های WS را هم فعال می‌کند
});
```

`AuthAdapter` یک رابط کوچک است (`credentials`، `getHeaders()`، `useSocketTicket`، `onUnauthorized()`)؛ برای روش‌های دیگر خودتان یکی بنویسید.

## ۲. رندر کامپوننت‌ها

```tsx
import '@realtime-chat/react/styles.css';
import { ChatProvider, ChatWindow, ConversationList, useCreateChatClient } from '@realtime-chat/react';

function Messages({ conversationId, onOpen }: { conversationId?: string; onOpen: (id: string) => void }) {
  // کلاینت را برای طول عمر همین کامپوننت می‌سازد؛ با StrictMode امن است و هنگام unmount آزاد می‌شود.
  const client = useCreateChatClient(() => createChatClient({ baseUrl: '/api/chat/v1', wsUrl: '/ws/chat/v1' }), []);
  if (!client) return null;
  return (
    <ChatProvider client={client}>
      <div style={{ display: 'flex', height: '100%' }}>
        <ConversationList activeId={conversationId} onSelect={(c) => onOpen(c.id)} getHref={(c) => `/messages/${c.id}`} />
        <ChatWindow conversationId={conversationId} />
      </div>
    </ChatProvider>
  );
}
```

کامپوننت‌ها هیچ‌وقت خودشان ناوبری نمی‌کنند. `onSelect`/`getHref`/`onBack` را بدهید و آن‌ها را با router خودتان هدایت کنید.

یا همه‌چیز را یک‌جا جاسازی کنید:

```tsx
<ChatProvider client={client} tokens={{ primary: '#0f766e', 'bubble-out': '#0f766e' }}>
  <ChatWidget position="bottom-right" title="Support" />
</ChatProvider>
```

`ChatWidget` از `open`/`onOpenChange` و `conversationId`/`onConversationChange` کنترل‌شده، `position`، `offset`، `zIndex`، `launcherLabel` و `allowNewConversations` پشتیبانی می‌کند. زیر ۶۴۰ پیکسل تمام‌صفحه می‌شود و با Esc بسته می‌شود.

## کامپوننت‌ها

| کامپوننت | کار |
| --- | --- |
| `ChatProvider` | کلاینت، پوسته، تنظیمات (کنترل‌شده یا ذخیره‌شده)، متن‌ها، توکن‌ها و `onError` را فراهم می‌کند |
| `ChatWindow` | سربرگ + بنر اتصال + فهرست پیام + «در حال نوشتن» + کادر نوشتن + دیالوگ هدایت |
| `ChatWidget` | دکمهٔ شناور با نشان نخوانده و پنل فهرست ← گفت‌وگو |
| `ConversationList` / `ConversationItem` | فهرست قابل جست‌وجو و پیمایش با صفحه‌کلید، با نشان نخوانده، «در حال نوشتن» و پیش‌نمایش |
| `ConversationHeader` | عنوان، حضور یا تعداد اعضا، «در حال نوشتن»، دکمه‌های بازگشت/جزئیات |
| `MessageList` | اسکرول بی‌پایان با جای ثابت، جداکنندهٔ روز، گروه‌بندی، جداکنندهٔ نخوانده، رفتن به آخرین پیام، تیک خوانده‌شدن، علامت‌گذاری خودکار خوانده‌شده |
| `MessageBubble` / `MessageText` | متن بی‌خطر با جهت خودکار و لینک امن؛ منوی پیام (واکنش، پاسخ، کپی، ویرایش، سنجاق، هدایت، حذف)؛ تلاش دوباره/دور انداختن برای ارسال ناموفق |
| `MessageComposer` | کادر متن خودبزرگ‌شو، پیش‌نویس برای هر گفت‌وگو، Enter/Ctrl+Enter، چسباندن و کشیدن فایل، انتخابگر ایموجی و استیکر، ضبط صدا (Esc لغو می‌کند)، اعتبارسنجی با سقف‌های سرور، حالت پاسخ/ویرایش، سیگنال «در حال نوشتن» |
| `TypingIndicator`، `PresenceIndicator`، `UnreadBadge`، `UserAvatar` | اجزای کوچک |
| `AttachmentPreview` | تصویر (نمایش بزرگ)، صوت، ویدیو، فایل با دانلود و پیشرفت آپلود |
| `GroupMemberList`، `ConversationInfoPanel` | اعضا با نقش و کارهای مدیریتی، پیام‌های سنجاق‌شده، ویرایش جزئیات، ترک گروه |
| `ChatSearch` | جست‌وجوی پیام در سرور با برجسته‌سازی |
| `ChatSettings` | پوسته، ارسال با Enter، حالت فشرده |
| `NewConversationDialog`، `AddMembersDialog`، `ForwardDialog`، `UserPicker` | پیدا کردن افراد و ساختن گفت‌وگو |
| `ConnectionBanner` | حالت‌های در حال اتصال دوباره / آفلاین / خارج‌شده با «همین حالا امتحان کن» |
| `EmojiPicker` | انتخابگر قابل جست‌وجو روی کل مجموعهٔ یونیکد (داده در اولین باز شدن بار می‌شود)، دسته‌ها، موارد اخیر |
| `StickerPicker`، `StickerImage` | بسته‌های استیکر سرور؛ دکمهٔ ایموجی کادر نوشتن از آن استفاده می‌کند |
| `VoicePlayer`، `useVoiceRecorder` | پخش‌کنندهٔ شکل موج با جابه‌جایی و سرعت ۱×/۱٫۵×/۲×؛ ضبط با MediaRecorder و نمایش زندهٔ سطح صدا |

## هوک‌ها

`useChatClient`، `useChatState(selector)`، `useConversations`، `useConversation(id)`، `useMessages(id)` (در اولین استفاده بار می‌کند)، `useTypingUsers(id)`، `usePresence(userId)`، `useConnection`، `useUnreadTotal`، `useChatConfig`، `useMe`، `useUserSearch(q)`، `useAttachmentUrl(attachment)`، `useCreateChatClient(factory, deps)`.

## SDK بدون React

```ts
await client.start();                         // تنظیمات + گفت‌وگوها + سوکت
const off = client.subscribe(() => render(client.getState()));
await client.loadMessages(id);
await client.sendMessage(id, { body: 'Hi', files: [file] });
await client.sendMessage(id, { voice: { file, duration: 3.2, waveform } });
await client.loadStickers(); // state.stickers.packs
await client.sendMessage(id, { sticker: client.getState().stickers.packs[0]!.stickers[0]! });
client.on('incoming', ({ message }) => notify(message));
client.on('connection', (state) => console.log(state.status));
client.dispose();
```

`client.api` همهٔ endpointهای REST را با پشتیبانی از `AbortSignal` در اختیار می‌گذارد؛ `client.socket` مدیر اتصال است (`state`، `reconnectNow()`)؛ خطاها از نوع `ChatError` هستند (`kind`، `code`، `status`، `details`، `retryAfter`، `retryable`).

## زبان و راست‌به‌چپ

کامپوننت‌ها متن‌های انگلیسی (`defaultStrings`) و فارسی (`faStrings`) دارند. متن‌ها و locale را بدهید و به صفحه (یا عنصر دور چت) `dir="rtl"` بدهید؛ کامپوننت‌ها فقط از CSS منطقی استفاده می‌کنند، پس کل چیدمان آینه می‌شود.

```tsx
import { ChatProvider, faStrings } from '@realtime-chat/react';

<html lang="fa" dir="rtl">…
<ChatProvider client={client} strings={faStrings} locale="fa-IR">
```

- `locale` تاریخ، ساعت، زمان نسبی («۵ دقیقه پیش»)، تعداد اعضا و نشان‌های نخوانده را از طریق `Intl` تعیین می‌کند.
- هر زیرمجموعه‌ای از متن‌ها را می‌شود بازنویسی کرد: `strings={{ ...faStrings, send: 'بفرست' }}`. برای زبان دیگر همهٔ کلیدهای `ChatStrings` را بدهید؛ TypeScript کلیدهای جاافتاده را نشان می‌دهد.
- هر پیام جهت خودش را نگه می‌دارد (`dir="auto"`)؛ پس متن انگلیسی در رابط فارسی، یا برعکس، درست نمایش داده می‌شود.
- برای اینکه پیام‌های خطای سرور هم به همان زبان باشند، زبان رابط را به SDK بگویید؛ SDK آن را در درخواست‌های REST به‌صورت `Accept-Language` و روی سوکت به‌صورت `?lang=` می‌فرستد (سمت سرور را در [راهنمای Django](integration-django.md) ببینید):

```ts
createChatClient({ baseUrl, wsUrl, language: () => currentLanguage });
```

## ظاهر و تم

- `@realtime-chat/react/styles.css` را یک بار import کنید. فقط کلاس‌های پیشونددار (`.rc\:*`)، توکن‌ها روی `.rc-root` و یک reset محدود به `.rc-root` دارد؛ هیچ قاعدهٔ سراسری‌ای ندارد. تنظیمات Tailwind/Bootstrap شما تحت تأثیر قرار نمی‌گیرد.
- تم را با `<ChatProvider tokens={{ … }}>` (متغیرهای `--rc-*` درون‌خطی) یا با CSS تغییر دهید:

```css
.rc-root { --rc-primary: #0ea5e9; --rc-radius: 6px; --rc-font: 'IBM Plex Sans', sans-serif; }
.rc-root[data-rc-theme='dark'] { --rc-bg: #000; }
```

- `preferences.theme`: `'system' | 'light' | 'dark'`. فهرست توکن‌ها: [سیستم طراحی](design-system.md).
- ایموجی: `<ChatProvider emoji={{ baseUrl: '/emoji' }}>` را بدهید و SVGهای `@twemoji/svg` (مجوز CC-BY 4.0، ذکر منبع لازم است) را در همان آدرس سرو کنید تا ایموجی‌ها به‌صورت تصویر و روی همهٔ سیستم‌عامل‌ها یکسان و مستقل از فونت‌های نصب‌شده نمایش داده شوند (اپ مستقل آن‌ها را در `apps/web/vite.config.ts` کپی می‌کند). بدون این گزینه، ایموجی متنی خود سیستم استفاده می‌شود.
