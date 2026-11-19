import { useChatContext } from '../context.js';
import { useNow, useTypingUsers } from '../hooks.js';
import { cx } from '../utils.js';

export function useTypingLabel(conversationId: string | null | undefined): string | null {
  const users = useTypingUsers(conversationId);
  const { strings } = useChatContext();
  useNow(1000, users.length > 0); // expire stale typing entries
  if (users.length === 0) return null;
  const names = users.map((u) => u.display_name.split(' ')[0]);
  if (names.length === 1) return `${names[0]} ${strings.typingOne}`;
  if (names.length === 2) return `${names[0]} & ${names[1]} ${strings.typingMany}`;
  return `${names.length} people ${strings.typingMany}`;
}

export function TypingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx('rc:inline-flex rc:items-center rc:gap-0.5', className)}>
      <span className="rc-typing-dot rc:size-1 rc:rounded-full rc:bg-current" />
      <span className="rc-typing-dot rc:size-1 rc:rounded-full rc:bg-current" />
      <span className="rc-typing-dot rc:size-1 rc:rounded-full rc:bg-current" />
    </span>
  );
}

export interface TypingIndicatorProps {
  conversationId: string;
  className?: string;
}

/** Live "X is typing" line; renders nothing (but keeps an aria-live region) when idle. */
export function TypingIndicator({ conversationId, className }: TypingIndicatorProps) {
  const label = useTypingLabel(conversationId);
  return (
    <div aria-live="polite" className={cx('rc:h-5 rc:px-4 rc:text-[12px] rc:text-muted', className)}>
      {label && (
        <span className="rc-enter rc:inline-flex rc:items-center rc:gap-2">
          <TypingDots className="rc:text-primary" />
          {label}
        </span>
      )}
    </div>
  );
}
