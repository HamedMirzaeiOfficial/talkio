import { useOptionalChatContext } from '../context.js';
import { defaultStrings } from '../strings.js';
import { cx, formatNumber } from '../utils.js';

export interface UnreadBadgeProps {
  count: number;
  /** Visually quieter badge (e.g. muted conversations). */
  muted?: boolean;
  max?: number;
  className?: string;
  label?: string;
}

export function UnreadBadge({ count, muted = false, max = 99, className, label }: UnreadBadgeProps) {
  const context = useOptionalChatContext();
  if (count <= 0) return null;
  const locale = context?.locale;
  const word = context?.strings.unread ?? defaultStrings.unread;
  return (
    <span
      aria-label={label ?? `${formatNumber(count, locale)} ${word}`}
      className={cx(
        'rc:inline-flex rc:h-5 rc:min-w-5 rc:items-center rc:justify-center rc:rounded-full rc:px-1.5 rc:text-[11px] rc:font-semibold rc:tabular-nums',
        muted ? 'rc:bg-surface-2 rc:text-muted' : 'rc:bg-primary rc:text-primary-fg',
        className,
      )}
    >
      {count > max ? `${formatNumber(max, locale)}+` : formatNumber(count, locale)}
    </span>
  );
}
