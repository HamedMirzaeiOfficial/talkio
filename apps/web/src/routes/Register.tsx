import { useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button, Field } from '../components/ui';
import { AuthError, authApi } from '../lib/auth';
import { AuthLayout } from './AuthLayout';
import { t } from '../lib/i18n';

type Errors = Partial<
  Record<'username' | 'display_name' | 'email' | 'password' | 'confirm' | 'form', string>
>;

export function Register() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = (): Errors => {
    const next: Errors = {};
    if (!/^[A-Za-z0-9_.]{3,30}$/.test(form.username))
      next.username = t('Use 3–30 letters, numbers, dots or underscores.');
    if (!form.display_name.trim()) next.display_name = t('Tell people what to call you.');
    if (form.password.length < 8) next.password = t('Use at least 8 characters.');
    if (form.password !== form.confirm) next.confirm = t('Passwords do not match.');
    return next;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await authApi.register({
        username: form.username,
        display_name: form.display_name.trim(),
        email: form.email.trim() || undefined,
        password: form.password,
      });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate('/app', { replace: true });
    } catch (e) {
      if (e instanceof AuthError && e.field) setErrors({ [e.field]: e.message });
      else setErrors({ form: e instanceof Error ? e.message : t('Registration failed.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t('Create your account')}
      subtitle={t('It takes less than a minute.')}
      footer={
        <>
          {t('Already have an account?')}{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            {t('Sign in')}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          label={t('Display name')}
          autoComplete="name"
          autoFocus
          value={form.display_name}
          onChange={set('display_name')}
          error={errors.display_name}
          dir="auto"
        />
        <Field
          label={t('Username')}
          autoComplete="username"
          dir="ltr"
          value={form.username}
          onChange={set('username')}
          error={errors.username}
          hint={t('Others can find you by this handle.')}
        />
        <Field
          label={t('Email (optional)')}
          type="email"
          dir="ltr"
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
        />
        <Field
          label={t('Password')}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
        />
        <Field
          label={t('Confirm password')}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
        />
        {errors.form && (
          <p role="alert" className="text-[13px] text-danger">
            {errors.form}
          </p>
        )}
        <Button type="submit" loading={busy} className="mt-1 w-full">
          {t('Create account')}
        </Button>
      </form>
    </AuthLayout>
  );
}
