import type { ChatUser, UserId } from '@realtime-chat/client';
import { Users } from 'lucide-react';

import { usePresence } from '../hooks.js';
import { cx, initials, tintFor } from '../utils.js';

const sizes = {
  xs: 'rc:size-6 rc:text-[10px]',
  sm: 'rc:size-8 rc:text-[11px]',
  md: 'rc:size-10 rc:text-[13px]',
  lg: 'rc:size-14 rc:text-base',
  xl: 'rc:size-20 rc:text-xl',
} as const;

export interface UserAvatarProps {
  user: Pick<ChatUser, 'id' | 'display_name' | 'avatar_url'> | null | undefined;
  size?: keyof typeof sizes;
  /** Show a live presence dot for this user. */
  showPresence?: boolean;
  /** Render a group glyph instead of initials. */
  group?: boolean;
  className?: string;
}

export function UserAvatar({
  user,
  size = 'md',
  showPresence = false,
  group = false,
  className,
}: UserAvatarProps) {
  const name = user?.display_name ?? 'Unknown';
  return (
    <span className={cx('rc:relative rc:inline-flex rc:shrink-0', className)}>
      <span
        className={cx(
          'rc:inline-grid rc:place-items-center rc:overflow-hidden rc:rounded-full rc:font-semibold rc:text-white rc:select-none',
          sizes[size],
        )}
        style={{ backgroundColor: user?.avatar_url ? undefined : tintFor(user?.id ?? name) }}
        aria-hidden
      >
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt="" className="rc:size-full rc:object-cover" loading="lazy" />
        ) : group ? (
          <Users className="rc:size-[45%]" />
        ) : (
          initials(name)
        )}
      </span>
      {showPresence && user && <PresenceDot userId={user.id} size={size} />}
    </span>
  );
}

function PresenceDot({ userId, size }: { userId: UserId; size: keyof typeof sizes }) {
  const { online } = usePresence(userId);
  if (!online) return null;
  return (
    <span
      className={cx(
        'rc:absolute rc:end-0 rc:bottom-0 rc:rounded-full rc:bg-success rc:ring-2 rc:ring-[var(--rc-surface)]',
        size === 'xs' || size === 'sm' ? 'rc:size-2.5' : 'rc:size-3',
      )}
    />
  );
}
