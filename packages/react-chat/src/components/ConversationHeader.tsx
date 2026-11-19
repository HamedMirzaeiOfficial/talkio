import { ArrowLeft, Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { useChatContext } from '../context.js';
import { useConversation } from '../hooks.js';
import { cx } from '../utils.js';
import { PresenceIndicator } from './PresenceIndicator.js';
import { IconButton, Skeleton } from './primitives.js';
import { TypingDots, useTypingLabel } from './TypingIndicator.js';
import { UserAvatar } from './UserAvatar.js';

export interface ConversationHeaderProps {
  conversationId: string;
  /** Shows a back button (mobile / widget navigation). */
  onBack?: () => void;
  /** Shows an info button that toggles a details panel. */
  onToggleInfo?: () => void;
  infoOpen?: boolean;
  actions?: ReactNode;
  className?: string;
}

export function ConversationHeader({
  conversationId,
  onBack,
  onToggleInfo,
  infoOpen,
  actions,
  className,
}: ConversationHeaderProps) {
  const conversation = useConversation(conversationId);
  const { strings } = useChatContext();
  const typing = useTypingLabel(conversationId);
  const online = conversation?.members.filter((m) => m.online).length ?? 0;
  return (
    <header
      className={cx(
        'rc:flex rc:h-14 rc:shrink-0 rc:items-center rc:gap-3 rc:border-b rc:border-border rc:px-3 rc:sm:px-4',
        className,
      )}
    >
      {onBack && (
        <IconButton label={strings.back} onClick={onBack} className="rc:-ms-1">
          <ArrowLeft className="rc:size-5 rc:rtl:rotate-180" />
        </IconButton>
      )}
      {conversation ? (
        <button
          type="button"
          onClick={onToggleInfo}
          disabled={!onToggleInfo}
          className="rc:flex rc:min-w-0 rc:flex-1 rc:items-center rc:gap-3 rc:text-start rc:disabled:cursor-default"
        >
          <UserAvatar
            user={
              conversation.kind === 'direct'
                ? conversation.peer
                : { id: conversation.id, display_name: conversation.title, avatar_url: null }
            }
            group={conversation.kind === 'group'}
            size="sm"
          />
          <span className="rc:flex rc:min-w-0 rc:flex-col">
            <span
              dir="auto"
              className="rc:truncate rc:text-[15px] rc:font-semibold rc:leading-tight rc:text-fg"
            >
              {conversation.title}
            </span>
            <span className="rc:truncate rc:text-[12px] rc:leading-tight">
              {typing ? (
                <span className="rc:inline-flex rc:items-center rc:gap-1.5 rc:text-primary">
                  <TypingDots />
                  {typing}
                </span>
              ) : conversation.kind === 'direct' && conversation.peer ? (
                <PresenceIndicator userId={conversation.peer.id} className="rc:text-[12px]" />
              ) : (
                <span className="rc:text-muted">
                  {conversation.member_count} {strings.members}
                  {online > 0 && ` · ${online} ${strings.online.toLowerCase()}`}
                </span>
              )}
            </span>
          </span>
        </button>
      ) : (
        <span className="rc:flex rc:flex-1 rc:items-center rc:gap-3">
          <Skeleton className="rc:size-8 rc:rounded-full" />
          <Skeleton className="rc:h-3 rc:w-32" />
        </span>
      )}
      <div className="rc:flex rc:items-center rc:gap-1">
        {actions}
        {onToggleInfo && (
          <IconButton
            label={strings.details}
            onClick={onToggleInfo}
            active={infoOpen}
            aria-pressed={infoOpen}
          >
            <Info className="rc:size-[18px]" />
          </IconButton>
        )}
      </div>
    </header>
  );
}
