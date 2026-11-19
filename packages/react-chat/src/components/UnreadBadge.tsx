import { cx } from '../utils.js';

export interface UnreadBadgeProps {
  count: number;
  /** Visually quieter badge (e.g. muted conversations). */
  muted?: boolean;
  max?: number;
  className?: string;
  label?: string;
}

export function UnreadBadge({ count, muted = false, max = 99, className, label }: UnreadBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label ?? `${count} unread`}
      className={cx(
        'rc:inline-flex rc:h-5 rc:min-w-5 rc:items-center rc:justify-center rc:rounded-full rc:px-1.5 rc:text-[11px] rc:font-semibold rc:tabular-nums',
        muted ? 'rc:bg-surface-2 rc:text-muted' : 'rc:bg-primary rc:text-primary-fg',
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
