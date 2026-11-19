import { UserAvatar } from '@realtime-chat/react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import type { FormEvent } from 'react';
import { useRef, useState } from 'react';

import { useSession } from '../app/session';
import { useToast } from '../components/toast';
import { Button, Field } from '../components/ui';
import { AuthError, authApi } from '../lib/auth';
import { Page, Section } from './Page';
import { t } from '../lib/i18n';

export function Profile() {
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const user = session.data?.user;
  const [form, setForm] = useState(() => ({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    username: user?.username ?? '',
    email: user?.email ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!user) return null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['session'] });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const patch: Record<string, string> = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
      };
      if (form.username && form.username !== user.username) patch.username = form.username;
      await authApi.updateProfile(patch);
      await refresh();
      toast(t('Profile updated'), 'success');
    } catch (e) {
      if (e instanceof AuthError && e.field) setErrors({ [e.field]: e.message });
      else toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (picked: File | undefined) => {
    if (!picked) return;
    const data = new FormData();
    data.append('avatar', picked);
    try {
      await authApi.updateProfile(data);
      await refresh();
      toast(t('Avatar updated'), 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Page title={t('Profile')}>
      <Section
        title={t('Public profile')}
        description={t(
          'Shown to people you chat with. Changes appear in new events and after a refresh for others.',
        )}
      >
        <div className="mb-5 flex items-center gap-4">
          <UserAvatar user={user} size="xl" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => file.current?.click()}>
              <Camera className="size-4" /> {t('Upload photo')}
            </Button>
            {user.avatar_url && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await authApi
                    .updateProfile({ remove_avatar: true })
                    .catch((e: Error) => toast(e.message, 'error'));
                  await refresh();
                }}
              >
                <Trash2 className="size-4" /> {t('Remove')}
              </Button>
            )}
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => void uploadAvatar(e.target.files?.[0])}
            />
          </div>
        </div>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('First name')}
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            error={errors.first_name}
            dir="auto"
          />
          <Field
            label={t('Last name')}
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            error={errors.last_name}
            dir="auto"
          />
          <Field
            label={t('Username')}
            dir="ltr"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            error={errors.username}
          />
          <Field
            label={t('Email')}
            type="email"
            dir="ltr"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            error={errors.email}
            hint={t('Never shown to other users.')}
          />
          <div className="sm:col-span-2">
            <Button type="submit" loading={saving}>
              {t('Save changes')}
            </Button>
          </div>
        </form>
      </Section>
      <Section title={t('Password')}>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setChanging(true);
            setPasswordError(null);
            try {
              await authApi.changePassword(passwords.current, passwords.next);
              setPasswords({ current: '', next: '' });
              toast(t('Password changed'), 'success');
            } catch (e) {
              setPasswordError((e as Error).message);
            } finally {
              setChanging(false);
            }
          }}
        >
          <Field
            label={t('Current password')}
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={passwords.current}
            onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
          />
          <Field
            label={t('New password')}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={passwords.next}
            onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
            error={passwordError ?? undefined}
          />
          <div className="sm:col-span-2">
            <Button
              type="submit"
              variant="secondary"
              loading={changing}
              disabled={!passwords.current || !passwords.next}
            >
              {t('Change password')}
            </Button>
          </div>
        </form>
      </Section>
    </Page>
  );
}
