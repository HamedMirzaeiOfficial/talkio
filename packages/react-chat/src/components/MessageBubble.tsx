import type { ChatMessage, MessageRef } from '@realtime-chat/client';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  CornerUpLeft,
  Forward,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { memo, useRef, useState } from 'react';

import { useChatContext } from '../context.js';
import { useChatClient, useChatConfig, useConversation, useMe } from '../hooks.js';
import { cx, formatTime, kindLabel, tokenize } from '../utils.js';
import { AttachmentPreview } from './AttachmentPreview.js';
import { emojiOnlyCount } from './media/emojiData.js';
import { Emoji, EmojiText, splitEmoji } from './media/Emoji.js';
import { EmojiPicker } from './media/EmojiPicker.js';
import { StickerImage } from './media/StickerPicker.js';
import {
  Button,
  Dialog,
  Menu,
  MenuContent,
  MenuItem,
  MenuPrimitive,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from './primitives.js';
import { UserAvatar } from './UserAvatar.js';

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Hide avatar and name because the previous message has the same sender. */
  groupedWithPrevious?: boolean;
  /** Draw the bubble tail only on the last message of a run. */
  groupedWithNext?: boolean;
  /** Number of other members whose read marker reached this message. */
  readCount?: number;
  highlighted?: boolean;
  compact?: boolean;
  onReply?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onJumpTo?: (messageId: string) => void;
}

/** Plain-text renderer: React text nodes only, http(s) links made clickable. */
export function MessageText({ text, className }: { text: string; className?: string }) {
  return (
    <p
      dir="auto"
      className={cx('rc:whitespace-pre-wrap rc:break-words rc:[overflow-wrap:anywhere]', className)}
    >
      {tokenize(text).map((token, i) =>
        token.type === 'link' ? (
          <a
            key={i}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="rc:underline rc:underline-offset-2 rc:opacity-95 rc:hover:opacity-100"
          >
            {token.value}
          </a>
        ) : (
          <EmojiText key={i} text={token.value} />
        ),
      )}
    </p>
  );
}

function Quote({
  reference,
  mine,
  onJumpTo,
  label,
  fallback,
}: {
  reference: MessageRef;
  mine: boolean;
  onJumpTo?: (id: string) => void;
  label: string;
  /** Shown when the quoted message has no text (e.g. "🎤 Voice message"). */
  fallback: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onJumpTo?.(reference.id)}
      className={cx(
        'rc:mb-1.5 rc:flex rc:w-full rc:min-w-0 rc:flex-col rc:rounded-lg rc:border-s-2 rc:px-2.5 rc:py-1 rc:text-start rc:text-[12.5px]',
        mine ? 'rc:border-white/70 rc:bg-white/12' : 'rc:border-primary rc:bg-primary-soft',
      )}
    >
      <span className={cx('rc:font-semibold', mine ? 'rc:text-out-fg' : 'rc:text-primary')}>
        {reference.sender?.display_name ?? label}
      </span>
      <span dir="auto" className="rc:truncate rc:opacity-85">
        {reference.is_deleted ? '—' : <EmojiText text={reference.body || fallback} />}
      </span>
    </button>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  groupedWithPrevious = false,
  groupedWithNext = false,
  readCount = 0,
  highlighted = false,
  compact = false,
  onReply,
  onEdit,
  onForward,
  onJumpTo,
}: MessageBubbleProps) {
  const client = useChatClient();
  const { strings, locale } = useChatContext();
  const me = useMe();
  const config = useChatConfig();
  const conversation = useConversation(message.conversation_id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // Reply/Edit move focus to the composer; keep Radix from returning it to the trigger.
  const focusElsewhere = useRef(false);

  const mine = message.sender !== null && String(message.sender.id) === String(me?.id);
  const isGroup = conversation?.kind === 'group';
  const isAdmin = conversation?.my_role === 'owner' || conversation?.my_role === 'admin';
  const sent = message.status === 'sent';
  const deleted = message.is_deleted;
  const editWindow = config?.limits.edit_window;
  const canEdit =
    mine &&
    sent &&
    !deleted &&
    (!editWindow || Date.now() - Date.parse(message.created_at) < editWindow * 1000);
  const canDelete = sent && !deleted && (mine || (isGroup && isAdmin));
  const reactionsEnabled = config?.features.reactions !== false;
  // A configured allow-list restricts the choice; otherwise any emoji, quick ones first.
  const reactions = reactionsEnabled
    ? (config?.allowed_reactions ?? config?.quick_reactions ?? ['👍', '❤️', '😂', '😮', '😢', '🔥'])
    : [];
  const anyEmoji = reactionsEnabled && config?.allowed_reactions === null;
  const [pickerOpen, setPickerOpen] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* surfaced through client 'error' events → host toasts */
    } finally {
      setBusy(false);
    }
  };

  if (deleted) {
    return (
      <div
        className={cx(
          'rc:flex rc:px-4',
          mine ? 'rc:justify-end' : 'rc:justify-start rc:ps-14',
          groupedWithPrevious ? 'rc:mt-0.5' : 'rc:mt-3',
        )}
      >
        <p className="rc:rounded-bubble rc:border rc:border-dashed rc:border-border rc:px-3 rc:py-1.5 rc:text-[13px] rc:italic rc:text-subtle">
          {strings.deleted}
        </p>
      </div>
    );
  }

  const status =
    message.status === 'pending' ? (
      <Clock className="rc:size-3.5" aria-label={strings.sending} />
    ) : message.status === 'failed' ? (
      <AlertCircle className="rc:size-3.5 rc:text-danger" aria-label={strings.failedToSend} />
    ) : readCount > 0 ? (
      <CheckCheck className="rc:size-3.5" aria-label={strings.read} />
    ) : (
      <Check className="rc:size-3.5" aria-label={strings.sent} />
    );

  const hasText = Boolean(message.body);
  const sticker = message.sticker;
  const attachments = message.attachments.length ? message.attachments : null;
  const local = !attachments && message.localAttachments.length ? message.localAttachments : null;
  // Photos, videos and stickers without text get edge-to-edge media with the time overlaid;
  // everything else (text, voice, files, quotes) keeps padding and an inline timestamp.
  const mediaTypes = [...(attachments ?? []).map((a) => a.content_type), ...(local ?? []).map((a) => a.type)];
  // 1–3 emoji on their own are shown large without a bubble.
  const bigEmoji =
    hasText && !attachments && !local && !message.reply_to && !message.forwarded_from
      ? emojiOnlyCount(message.body)
      : 0;
  const visualOnly =
    !hasText &&
    !message.reply_to &&
    !message.forwarded_from &&
    (Boolean(sticker) || (mediaTypes.length > 0 && mediaTypes.every((t) => /^(image|video)\//.test(t))));

  return (
    <div
      data-message-id={message.id}
      className={cx(
        'rc:group rc:relative rc:flex rc:gap-2.5 rc:px-3 rc:sm:px-4',
        mine ? 'rc:flex-row-reverse' : 'rc:flex-row',
        groupedWithPrevious ? (compact ? 'rc:mt-px' : 'rc:mt-0.5') : compact ? 'rc:mt-2' : 'rc:mt-3.5',
        message.status === 'pending' && 'rc:opacity-80',
      )}
      onContextMenu={(event) => {
        if (!sent) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {!mine && (
        <div className="rc:w-8 rc:shrink-0">
          {!groupedWithPrevious && isGroup && <UserAvatar user={message.sender} size="sm" />}
        </div>
      )}
      <div
        className={cx(
          'rc:flex rc:min-w-0 rc:max-w-[min(78%,560px)] rc:flex-col',
          mine ? 'rc:items-end' : 'rc:items-start',
        )}
      >
        {!mine && isGroup && !groupedWithPrevious && (
          <span dir="auto" className="rc:mb-1 rc:ms-1 rc:text-[12px] rc:font-medium rc:text-muted">
            {message.sender?.display_name}
          </span>
        )}
        <div
          className={cx(
            'rc:relative rc:max-w-full rc:rounded-bubble rc:text-[14px] rc:leading-[1.45] rc:transition-shadow',
            sticker || bigEmoji ? 'rc:bg-transparent' : visualOnly ? 'rc:p-1' : 'rc:px-3 rc:py-2',
            !sticker &&
              !bigEmoji &&
              (mine ? 'rc:bg-out rc:text-out-fg' : 'rc:bg-in rc:text-in-fg rc:border rc:border-border'),
            !groupedWithNext && (mine ? 'rc:rounded-ee-md' : 'rc:rounded-es-md'),
            highlighted && 'rc-highlight',
          )}
        >
          {message.forwarded_from && (
            <p
              className={cx(
                'rc:mb-1 rc:flex rc:items-center rc:gap-1 rc:text-[12px] rc:italic',
                mine ? 'rc:opacity-85' : 'rc:text-muted',
              )}
            >
              <Forward className="rc:size-3" aria-hidden />
              {strings.forwardedFrom} {message.forwarded_from.sender?.display_name ?? '—'}
            </p>
          )}
          {message.reply_to && (
            <Quote
              reference={message.reply_to}
              mine={mine}
              onJumpTo={onJumpTo}
              label={strings.deleted}
              fallback={kindLabel(message.reply_to.kind, strings) ?? '📎'}
            />
          )}
          {(attachments || local) && (
            <div className={cx('rc:flex rc:flex-wrap rc:gap-1.5', hasText && 'rc:mb-1.5')}>
              {attachments?.map((a) => (
                <AttachmentPreview key={a.id} attachment={a} onAccent={mine} />
              ))}
              {local?.map((a, i) => (
                <AttachmentPreview key={i} local={a} onAccent={mine} />
              ))}
            </div>
          )}
          {sticker && <StickerImage sticker={sticker} size={compact ? 120 : 148} />}
          {bigEmoji ? (
            <p className="rc:flex rc:gap-1 rc:leading-none" aria-label={message.body.trim()}>
              {splitEmoji(message.body.trim())
                .filter((part) => part.emoji)
                .map((part, i) => (
                  <Emoji key={i} emoji={part.text} size={[0, 56, 44, 36][bigEmoji]} />
                ))}
            </p>
          ) : (
            hasText && <MessageText text={message.body} />
          )}
          <span
            className={cx(
              'rc:float-end rc:ms-2 rc:mt-1 rc:flex rc:select-none rc:items-center rc:gap-1 rc:text-[11px] rc:leading-none',
              mine && !bigEmoji ? 'rc:text-out-fg/75' : 'rc:text-subtle',
              visualOnly &&
                'rc:absolute rc:end-2 rc:bottom-2 rc:rounded-full rc:bg-black/45 rc:px-1.5 rc:py-0.5 rc:text-white',
            )}
          >
            {message.pinned_at && <Pin className="rc:size-3" aria-label={strings.pin} />}
            {message.edited_at && <span>{strings.edited}</span>}
            <time dateTime={message.created_at}>{formatTime(message.created_at, locale)}</time>
            {mine && status}
          </span>
        </div>
        {message.reactions.length > 0 && (
          <div className="rc:mt-1 rc:flex rc:flex-wrap rc:gap-1">
            {message.reactions.map((r) => {
              const active = r.user_ids.some((id) => String(id) === String(me?.id));
              return (
                <button
                  key={r.emoji}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${r.emoji} ${r.count}`}
                  onClick={() => void act(() => client.toggleReaction(message.id, r.emoji))}
                  className={cx(
                    'rc:inline-flex rc:h-6 rc:items-center rc:gap-1 rc:rounded-full rc:border rc:px-2 rc:text-[12px] rc:transition',
                    active
                      ? 'rc:border-primary rc:bg-primary-soft rc:text-primary'
                      : 'rc:border-border rc:bg-surface rc:text-muted rc:hover:bg-surface-2',
                  )}
                >
                  <Emoji emoji={r.emoji} size={16} />
                  <span className="rc:tabular-nums">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}
        {message.status === 'failed' && (
          <div
            className="rc:mt-1 rc:flex rc:items-center rc:gap-2 rc:text-[12px] rc:text-danger"
            role="alert"
          >
            <span>{message.error?.message ?? strings.failedToSend}</span>
            <button
              type="button"
              className="rc:inline-flex rc:items-center rc:gap-1 rc:font-medium rc:underline"
              onClick={() =>
                void client.retryMessage(message.conversation_id, message.client_id).catch(() => undefined)
              }
            >
              <RotateCcw className="rc:size-3" aria-hidden />
              {strings.retry}
            </button>
            <button
              type="button"
              className="rc:text-muted rc:underline"
              onClick={() => client.discardMessage(message.conversation_id, message.client_id)}
            >
              {strings.discard}
            </button>
          </div>
        )}
      </div>
      {sent && (
        <div
          className={cx(
            'rc:flex rc:items-start rc:pt-1 rc:opacity-0 rc:transition rc:group-hover:opacity-100 rc:focus-within:opacity-100',
            menuOpen && 'rc:opacity-100',
          )}
        >
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverAnchor />
            <PopoverContent label={strings.moreReactions} side="top" align={mine ? 'end' : 'start'}>
              <div className="rc:h-[380px] rc:w-[min(352px,calc(100vw-16px))]">
                <EmojiPicker
                  onSelect={(emoji) => {
                    setPickerOpen(false);
                    void act(() => client.toggleReaction(message.id, emoji));
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label={strings.messageActions}
                disabled={busy}
                className="rc:grid rc:size-7 rc:place-items-center rc:rounded-full rc:text-subtle rc:hover:bg-surface-2 rc:hover:text-fg"
              >
                <MoreHorizontal className="rc:size-4" />
              </button>
            </MenuTrigger>
            <MenuContent
              align={mine ? 'end' : 'start'}
              onCloseAutoFocus={(event) => {
                if (focusElsewhere.current) event.preventDefault();
                focusElsewhere.current = false;
              }}
            >
              {reactions.length > 0 && (
                <>
                  <div className="rc:flex rc:gap-0.5 rc:px-1 rc:py-1" role="group" aria-label={strings.react}>
                    {reactions.slice(0, 8).map((emoji) => (
                      <MenuPrimitive.Item
                        key={emoji}
                        onSelect={() => void act(() => client.toggleReaction(message.id, emoji))}
                        aria-label={`React ${emoji}`}
                        className="rc:grid rc:size-8 rc:cursor-pointer rc:place-items-center rc:rounded-lg rc:text-[17px] rc:outline-none rc:data-[highlighted]:bg-surface-2"
                      >
                        <Emoji emoji={emoji} size={22} />
                      </MenuPrimitive.Item>
                    ))}
                    {anyEmoji && (
                      <MenuPrimitive.Item
                        onSelect={() => {
                          focusElsewhere.current = true;
                          // Open after the menu has closed so the two layers do not fight over focus.
                          setTimeout(() => setPickerOpen(true), 0);
                        }}
                        aria-label={strings.moreReactions}
                        className="rc:grid rc:size-8 rc:cursor-pointer rc:place-items-center rc:rounded-lg rc:text-muted rc:outline-none rc:data-[highlighted]:bg-surface-2"
                      >
                        <Plus className="rc:size-4" />
                      </MenuPrimitive.Item>
                    )}
                  </div>
                  <MenuSeparator />
                </>
              )}
              {onReply && (
                <MenuItem
                  icon={<CornerUpLeft className="rc:size-4" />}
                  onSelect={() => {
                    focusElsewhere.current = true;
                    onReply(message);
                  }}
                >
                  {strings.reply}
                </MenuItem>
              )}
              {hasText && (
                <MenuItem
                  icon={<Copy className="rc:size-4" />}
                  onSelect={() => void navigator.clipboard?.writeText(message.body).catch(() => undefined)}
                >
                  {strings.copy}
                </MenuItem>
              )}
              {canEdit && onEdit && (
                <MenuItem
                  icon={<Pencil className="rc:size-4" />}
                  onSelect={() => {
                    focusElsewhere.current = true;
                    onEdit(message);
                  }}
                >
                  {strings.edit}
                </MenuItem>
              )}
              <MenuItem
                icon={message.pinned_at ? <PinOff className="rc:size-4" /> : <Pin className="rc:size-4" />}
                onSelect={() => void act(() => client.togglePin(message.id))}
              >
                {message.pinned_at ? strings.unpin : strings.pin}
              </MenuItem>
              {onForward && (
                <MenuItem icon={<Forward className="rc:size-4" />} onSelect={() => onForward(message)}>
                  {strings.forward}
                </MenuItem>
              )}
              {canDelete && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    icon={<Trash2 className="rc:size-4 rc:text-danger" />}
                    onSelect={() => setConfirmDelete(true)}
                  >
                    {strings.delete}
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
          {reactions.length > 0 && (
            <button
              type="button"
              aria-label={strings.react}
              onClick={() => setMenuOpen(true)}
              className="rc:hidden rc:size-7 rc:place-items-center rc:rounded-full rc:text-subtle rc:hover:bg-surface-2 rc:hover:text-fg rc:sm:grid"
            >
              <SmilePlus className="rc:size-4" />
            </button>
          )}
        </div>
      )}
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        width="sm"
        title={`${strings.delete}?`}
        description={mine ? strings.deleteOwnHint : strings.deleteOtherHint}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>{strings.cancel}</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void act(() => client.deleteMessage(message.id)).then(() => setConfirmDelete(false))
              }
            >
              {strings.delete}
            </Button>
          </>
        }
      >
        <p
          dir="auto"
          className="rc:line-clamp-3 rc:rounded-lg rc:bg-surface-2 rc:px-3 rc:py-2 rc:text-[13px] rc:text-muted"
        >
          {message.body || message.attachments[0]?.name}
        </p>
      </Dialog>
    </div>
  );
});
