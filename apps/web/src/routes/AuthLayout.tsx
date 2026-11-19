import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { LangSwitch, Logo } from '../components/ui';
import { t } from '../lib/i18n';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex items-center justify-between px-6 py-5">
        <Link to="/" aria-label={t('Talkio home')}>
          <Logo />
        </Link>
        <LangSwitch />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[6vh] pb-16">
        <div className="w-full max-w-[400px]">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-1.5 mb-7 text-sm text-muted">{subtitle}</p>
          {children}
          <p className="mt-6 text-center text-sm text-muted">{footer}</p>
        </div>
      </main>
    </div>
  );
}
