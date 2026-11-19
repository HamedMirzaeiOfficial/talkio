import type { UserId } from '@realtime-chat/client';

import { useChatContext } from '../context.js';
import { useNow, usePresence } from '../hooks.js';
import { cx, formatRelative } from '../utils.js';

export interface PresenceIndicatorProps {
  userId: UserId;
  /** Show "Online" / "Last seen …" text next to the dot. */
  showLabel?: boolean;
  className?: string;
}

export function PresenceIndicator({ userId, showLabel = true, className }: PresenceIndicatorProps) {
  const { online, last_seen_at } = usePresence(userId);
  const { strings } = useChatContext();
  const now = useNow(60_000, !online);
  const label = online
    ? strings.online
    : last_seen_at
      ? `${strings.lastSeen} ${formatRelative(last_seen_at, now)}`
      : strings.offline;
  return (
    <span className={cx('rc:inline-flex rc:items-center rc:gap-1.5 rc:text-[13px] rc:text-muted', className)}>
      <span
        aria-hidden
        className={cx('rc:size-2 rc:rounded-full', online ? 'rc:bg-success' : 'rc:bg-subtle rc:opacity-60')}
      />
      {showLabel ? <span>{label}</span> : <span className="rc:sr-only">{label}</span>}
    </span>
  );
}
