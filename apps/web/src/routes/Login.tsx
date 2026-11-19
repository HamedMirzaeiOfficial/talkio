import { useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useSession } from '../app/session';
import { Button, Field } from '../components/ui';
import { AuthError, authApi } from '../lib/auth';
import { AuthLayout } from './AuthLayout';
import { msg, t } from '../lib/i18n';

type Method = 'phone' | 'password';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = useSession();
  const demo = Boolean(session.data?.demo_auth);
  const [method, setMethod] = useState<Method>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The development code login is the quickest way in, so it is the default when enabled.
  useEffect(() => {
    if (demo) setMethod('phone');
  }, [demo]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (method === 'phone') await authApi.loginWithCode(phone.replace(/\D/g, ''), code.trim());
      else await authApi.login(identifier.trim(), password);
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate((location.state as { from?: string } | null)?.from ?? '/app', { replace: true });
    } catch (e) {
      setError(e instanceof AuthError ? e.message : t('Could not reach the server. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const ready =
    method === 'phone'
      ? phone.replace(/\D/g, '').length >= 8 && code.trim().length > 0
      : identifier && password;

  return (
    <AuthLayout
      title={t('Welcome back')}
      subtitle={t('Sign in to continue your conversations.')}
      footer={
        <>
          {t('New to Talkio?')}{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            {t('Create an account')}
          </Link>
        </>
      }
    >
      {demo && (
        <div
          role="tablist"
          aria-label={t('Sign-in method')}
          className="mb-5 grid grid-cols-2 gap-1 rounded-ui bg-surface-2 p-1"
        >
          {(
            [
              ['phone', msg('Phone number')],
              ['password', msg('Username')],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={method === value}
              onClick={() => {
                setMethod(value);
                setError(null);
              }}
              className={`h-8 rounded-[8px] text-[13px] font-medium transition ${method === value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
            >
              {t(label)}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {method === 'phone' ? (
          <>
            <Field
              label={t('Phone number')}
              type="tel"
              dir="ltr"
              inputMode="numeric"
              autoComplete="tel"
              autoFocus
              placeholder="09121234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Field
              label={t('Login code')}
              inputMode="numeric"
              dir="ltr"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              hint={t('Development mode — the default code is 1234.')}
            />
          </>
        ) : (
          <>
            <Field
              label={t('Username or email')}
              autoComplete="username"
              dir="ltr"
              autoFocus
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
            <Field
              label={t('Password')}
              type="password"
              dir="ltr"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-ui border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
          >
            {error}
          </p>
        )}
        <Button type="submit" loading={busy} disabled={!ready} className="mt-1 w-full">
          {t('Sign in')}
        </Button>
      </form>
      {session.data && session.data.providers.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <div className="flex items-center gap-3 text-[12px] text-subtle">
            <span className="h-px flex-1 bg-border" /> {t('or')} <span className="h-px flex-1 bg-border" />
          </div>
          {session.data.providers.map((p) => (
            <a
              key={p.id}
              href={p.login_url}
              className="inline-flex h-10 items-center justify-center rounded-ui border border-border bg-surface text-sm font-medium text-fg hover:bg-surface-2"
            >
              {t('Continue with {name}', { name: p.name })}
            </a>
          ))}
        </div>
      )}
      {import.meta.env.DEV && method === 'password' && (
        <p className="mt-6 rounded-ui border border-dashed border-border px-3 py-2 text-[12.5px] text-muted">
          {t('Seeded demo users:')} <code className="text-fg">alice</code> /{' '}
          <code className="text-fg">talkio-demo-2026</code> ({t('after')}{' '}
          <code className="text-fg">manage.py seed_demo</code>).
        </p>
      )}
    </AuthLayout>
  );
}
