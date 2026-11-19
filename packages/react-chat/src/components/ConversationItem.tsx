import type { Conversation } from '@realtime-chat/client';
import { Pin } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { useChatContext } from '../context.js';
import { useMe } from '../hooks.js';
import type { ChatStrings } from '../strings.js';
import { cx, formatListTime, formatNumber, kindLabel } from '../utils.js';
import { EmojiText } from './media/Emoji.js';
import { useTypingLabel } from './TypingIndicator.js';
import { TypingDots } from './TypingIndicator.js';
import { UnreadBadge } from './UnreadBadge.js';
import { UserAvatar } from './UserAvatar.js';

export interface ConversationItemProps {
  conversation: Conversation;
  active?: boolean;
  onSelect?: (conversation: Conversation) => void;
  /** Render as a link (e.g. host router href) instead of a button. */
  href?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  compact?: boolean;
}

/** Author label and body of the last-message preview, kept apart so each keeps its own text direction. */
export function previewParts(
  conversation: Conversation,
  meId: unknown,
  strings: ChatStrings,
  locale?: string,
): { author: string | null; body: string } {
  const message = conversation.last_message;
  if (!message) {
    const members = `${formatNumber(conversation.member_count, locale)} ${strings.members}`;
    return { author: null, body: conversation.kind === 'group' ? members : '' };
  }
  const author =
    String(message.sender?.id) === String(meId)
      ? strings.you
      : conversation.kind === 'group'
        ? message.sender?.display_name.split(' ')[0]
        : null;
  const media = kindLabel(message.kind, strings);
  const sticker = message.sticker?.emoji ? ` ${message.sticker.emoji}` : '';
  const body = message.is_deleted
    ? strings.deleted
    : message.body
      ? `${media && message.kind !== 'text' ? `${media.split(' ')[0]} ` : ''}${message.body}`
      : `${media ?? ''}${sticker}`;
  return { author: author ?? null, body };
}

export function conversationPreview(conversation: Conversation, meId: unknown, strings: ChatStrings): string {
  const { author, body } = previewParts(conversation, meId, strings);
  return author ? `${author}: ${body}` : body;
}

export function ConversationItem({
  conversation,
  active = false,
  onSelect,
  href,
  onKeyDown,
  compact = false,
}: ConversationItemProps) {
  const { strings, locale } = useChatContext();
  const me = useMe();
  const typing = useTypingLabel(conversation.id);
  const unread = conversation.unread_count;
  const preview = previewParts(conversation, me?.id, strings, locale);
  const avatarUser =
    conversation.kind === 'direct'
      ? conversation.peer
      : { id: conversation.id, display_name: conversation.title, avatar_url: null };
  const Tag = href ? 'a' : 'button';
  return (
    <Tag
      {...(href ? { href } : { type: 'button' as const })}
      data-conversation-id={conversation.id}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        if (href && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
        if (href && onSelect) event.preventDefault();
        onSelect?.(conversation);
      }}
      onKeyDown={onKeyDown}
      className={cx(
        'rc:group rc:flex rc:w-full rc:items-center rc:gap-3 rc:rounded-ui rc:px-2.5 rc:text-start rc:transition',
        compact ? 'rc:py-1.5' : 'rc:py-2',
        active ? 'rc:bg-primary-soft' : 'rc:hover:bg-surface-2',
      )}
    >
      <UserAvatar
        user={avatarUser}
        group={conversation.kind === 'group'}
        showPresence={conversation.kind === 'direct'}
        size={compact ? 'sm' : 'md'}
      />
      <span className="rc:flex rc:min-w-0 rc:flex-1 rc:flex-col">
        <span className="rc:flex rc:items-baseline rc:gap-2">
          <span
            dir="auto"
            className={cx(
              'rc:truncate rc:text-sm',
              unread ? 'rc:font-semibold rc:text-fg' : 'rc:font-medium rc:text-fg',
            )}
          >
            {conversation.title}
          </span>
          <span
            className={cx(
              'rc:ms-auto rc:shrink-0 rc:text-[11px] rc:tabular-nums',
              unread ? 'rc:text-primary' : 'rc:text-subtle',
            )}
          >
            {formatListTime(conversation.last_activity_at, locale)}
          </span>
        </span>
        <span className="rc:flex rc:items-center rc:gap-2">
          {typing ? (
            <span className="rc:flex rc:min-w-0 rc:items-center rc:gap-1.5 rc:text-[13px] rc:text-primary">
              <TypingDots />
              <span className="rc:truncate">{typing}</span>
            </span>
          ) : (
            <span className={cx('rc:truncate rc:text-[13px]', unread ? 'rc:text-fg' : 'rc:text-muted')}>
              {conversation.last_message?.pinned_at && (
                <Pin className="rc:me-1 rc:inline rc:size-3" aria-hidden />
              )}
              {preview.author && `${preview.author}: `}
              {preview.body ? (
                <bdi>
                  <EmojiText text={preview.body} />
                </bdi>
              ) : (
                !preview.author && ' '
              )}
            </span>
          )}
          <UnreadBadge count={unread} className="rc:ms-auto" />
        </span>
      </span>
    </Tag>
  );
}
