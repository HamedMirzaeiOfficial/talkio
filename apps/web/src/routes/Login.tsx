import { useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useSession } from '../app/session';
import { Button, Field } from '../components/ui';
import { AuthError, authApi } from '../lib/auth';
import { AuthLayout } from './AuthLayout';

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
      setError(e instanceof AuthError ? e.message : 'Could not reach the server. Try again.');
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
      title="Welcome back"
      subtitle="Sign in to continue your conversations."
      footer={
        <>
          New to Talkio?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {demo && (
        <div
          role="tablist"
          aria-label="Sign-in method"
          className="mb-5 grid grid-cols-2 gap-1 rounded-ui bg-surface-2 p-1"
        >
          {(
            [
              ['phone', 'Phone number'],
              ['password', 'Username'],
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
              {label}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {method === 'phone' ? (
          <>
            <Field
              label="Phone number"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              autoFocus
              placeholder="09121234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Field
              label="Login code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              hint="Development mode — the default code is 1234."
            />
          </>
        ) : (
          <>
            <Field
              label="Username or email"
              autoComplete="username"
              autoFocus
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
            <Field
              label="Password"
              type="password"
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
          Sign in
        </Button>
      </form>
      {session.data && session.data.providers.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <div className="flex items-center gap-3 text-[12px] text-subtle">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          {session.data.providers.map((p) => (
            <a
              key={p.id}
              href={p.login_url}
              className="inline-flex h-10 items-center justify-center rounded-ui border border-border bg-surface text-sm font-medium text-fg hover:bg-surface-2"
            >
              Continue with {p.name}
            </a>
          ))}
        </div>
      )}
      {import.meta.env.DEV && method === 'password' && (
        <p className="mt-6 rounded-ui border border-dashed border-border px-3 py-2 text-[12.5px] text-muted">
          Seeded demo users: <code className="text-fg">alice</code> /{' '}
          <code className="text-fg">talkio-demo-2026</code> (after{' '}
          <code className="text-fg">manage.py seed_demo</code>).
        </p>
      )}
    </AuthLayout>
  );
}
