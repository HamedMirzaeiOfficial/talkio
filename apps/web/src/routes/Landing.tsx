import { ArrowRight, Boxes, CheckCheck, Globe2, Lock, RefreshCcw, Users } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useSession } from '../app/session';
import { LangSwitch, Logo } from '../components/ui';
import { intlLocale, msg, t } from '../lib/i18n';

const features: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <RefreshCcw className="size-5" />,
    title: msg('Resilient real-time'),
    body: msg(
      'One WebSocket per client with backoff, heartbeats and gap recovery by per-conversation sequence numbers.',
    ),
  },
  {
    icon: <CheckCheck className="size-5" />,
    title: msg('Receipts & presence'),
    body: msg('Read markers, unread counts, typing indicators and multi-device presence with last-seen.'),
  },
  {
    icon: <Users className="size-5" />,
    title: msg('Groups with roles'),
    body: msg(
      'Owners, admins and members. Add, remove, promote, transfer ownership — enforced on the server.',
    ),
  },
  {
    icon: <Lock className="size-5" />,
    title: msg('Private by default'),
    body: msg(
      'Membership-scoped access, sniffed and size-limited uploads, origin-checked sockets, inert message rendering.',
    ),
  },
  {
    icon: <Globe2 className="size-5" />,
    title: msg('RTL & accessible'),
    body: msg(
      'Automatic text direction for Persian and Arabic, keyboard navigation, focus states and reduced motion.',
    ),
  },
  {
    icon: <Boxes className="size-5" />,
    title: msg('Embeddable'),
    body: msg(
      'The same Django package, TypeScript SDK and React components power this app and your product.',
    ),
  },
];

function Preview() {
  const bubble = 'max-w-[75%] rounded-2xl px-3 py-2 text-[13px] leading-snug';
  return (
    <div
      aria-hidden
      className="pointer-events-none select-none overflow-hidden rounded-2xl border border-border bg-bg shadow-[var(--rc-shadow)]"
    >
      <div className="flex h-[340px] text-start sm:h-[380px]">
        <div className="hidden w-[210px] shrink-0 flex-col gap-1 border-e border-border bg-sidebar p-3 sm:flex">
          <div className="mb-2 h-8 rounded-lg bg-surface-2" />
          {[t('Product design'), t('Bahram Karimi'), t('Engineering'), t('Farnaz Ahmadi')].map((name, i) => (
            <div
              key={name}
              className={`flex items-center gap-2.5 rounded-lg px-2 py-2 ${i === 0 ? 'bg-primary-soft' : ''}`}
            >
              <span
                className="size-8 rounded-full"
                style={{ background: ['#6366f1', '#0ea5e9', '#14b8a6', '#ec4899'][i] }}
              />
              <span className="flex flex-1 flex-col gap-1">
                <span className="text-[12px] font-medium text-fg">{name}</span>
                <span className="h-2 w-3/4 rounded bg-surface-2" />
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex h-12 items-center gap-2.5 border-b border-border bg-surface px-4">
            <span className="size-7 rounded-full bg-[#6366f1]" />
            <span className="flex flex-col">
              <span className="text-[13px] font-semibold text-fg">{t('Product design')}</span>
              <span className="text-[11px] text-primary">{t('Chen is typing…')}</span>
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-1.5 p-4">
            <div className={`${bubble} self-start border border-border bg-[var(--rc-bubble-in)] text-fg`}>
              {t('The onboarding flow is ready for review.')}
            </div>
            <div
              className={`${bubble} self-start border border-border bg-[var(--rc-bubble-in)] text-fg`}
              dir="rtl"
            >
              نسخه فارسی متن‌ها را هم آماده کردم.
            </div>
            <div className={`${bubble} self-end bg-[var(--rc-bubble-out)] text-white`}>
              {t('Perfect — shipping it this afternoon')}{' '}
              <img
                src={`${import.meta.env.BASE_URL}emoji/1f389.svg`}
                alt="🎉"
                className="ms-1 inline size-4 align-[-3px]"
              />
            </div>
            <span className="self-end text-[11px] text-subtle">
              {t('Read · {time}', {
                time: new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(
                  new Date(2026, 0, 1, 14, 2),
                ),
              })}
            </span>
          </div>
          <div className="m-3 h-10 rounded-full bg-surface-2" />
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const session = useSession();
  const signedIn = Boolean(session.data?.user);
  return (
    <div className="min-h-full bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <LangSwitch />
          {signedIn ? (
            <Link
              to="/app"
              className="inline-flex h-9 items-center gap-1.5 rounded-ui bg-primary px-4 text-sm font-medium text-primary-fg hover:brightness-110"
            >
              {t('Open Talkio')} <ArrowRight className="size-4 rtl:-scale-x-100" />
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="inline-flex h-9 items-center rounded-ui px-3 text-sm font-medium text-muted hover:text-fg"
              >
                {t('Sign in')}
              </Link>
              <Link
                to="/register"
                className="inline-flex h-9 items-center rounded-ui bg-primary px-4 text-sm font-medium text-primary-fg hover:brightness-110"
              >
                {t('Get started')}
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-10 pb-20 lg:grid-cols-[1fr_1.1fr] lg:pt-16">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-muted">
              <span className="size-1.5 rounded-full bg-success" /> {t('Open, reusable building blocks')}
            </p>
            <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-fg sm:text-5xl">
              {t('Conversations that keep up with your team.')}
            </h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-muted">
              {t(
                'Talkio is real-time messaging assembled from parts you can reuse: a Django package for the backend, a TypeScript SDK for any frontend, and React components you can drop into your own product.',
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to={signedIn ? '/app' : '/register'}
                className="inline-flex h-11 items-center gap-2 rounded-ui bg-primary px-5 text-sm font-medium text-primary-fg hover:brightness-110"
              >
                {signedIn ? t('Open your chats') : t('Create a free account')}{' '}
                <ArrowRight className="size-4 rtl:-scale-x-100" />
              </Link>
              {!signedIn && (
                <Link
                  to="/login"
                  className="inline-flex h-11 items-center rounded-ui border border-border bg-surface px-5 text-sm font-medium text-fg hover:bg-surface-2"
                >
                  {t('I already have an account')}
                </Link>
              )}
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
          >
            <Preview />
          </motion.div>
        </section>

        <section aria-labelledby="features" className="border-t border-border bg-sidebar">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 id="features" className="text-xl font-semibold tracking-tight text-fg">
              {t('Built for correctness first')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              {t('Every feature below is implemented, tested and documented in the repository.')}
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-xl border border-border bg-surface p-5">
                  <div className="mb-3 grid size-9 place-items-center rounded-lg bg-primary-soft text-primary">
                    {f.icon}
                  </div>
                  <h3 className="text-[15px] font-semibold text-fg">{t(f.title)}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{t(f.body)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="developers" className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 id="developers" className="text-xl font-semibold tracking-tight text-fg">
                {t('Add chat to your product')}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t(
                  'Install the Django app, mount its routes, and render the components with your own authentication. Styles are isolated with prefixed utilities and CSS variables, so the widget never restyles the host page.',
                )}
              </p>
            </div>
            <pre
              dir="ltr"
              className="overflow-x-auto rounded-xl border border-border bg-surface p-5 text-[12.5px] leading-relaxed text-fg"
            >
              <code>{`pip install django-realtime-chat
npm install @realtime-chat/client @realtime-chat/react

const client = createChatClient({
  baseUrl: '/api/chat/v1',
  wsUrl: '/ws/chat/v1',
  auth: sessionAuth(),
});

<ChatProvider client={client}>
  <ChatWidget />
</ChatProvider>`}</code>
            </pre>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[13px] text-subtle">
          <Logo className="text-sm" />
          <span>
            Django · Channels · React · TypeScript ·{' '}
            <a
              href="https://github.com/jdecked/twemoji"
              className="hover:text-muted"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('Emoji by Twemoji (CC-BY 4.0)')}
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
