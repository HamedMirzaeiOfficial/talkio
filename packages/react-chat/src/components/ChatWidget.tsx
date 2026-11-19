import { MessageCircle, MessageSquarePlus, X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { useChatContext, useThemeRoot } from '../context.js';
import { useUnreadTotal } from '../hooks.js';
import { cx } from '../utils.js';
import { ChatWindow } from './ChatWindow.js';
import { ConversationList } from './ConversationList.js';
import { NewConversationDialog } from './dialogs.js';
import { IconButton } from './primitives.js';
import { UnreadBadge } from './UnreadBadge.js';

export interface ChatWidgetProps {
  /** Controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** Open a specific conversation (controlled). */
  conversationId?: string | null;
  onConversationChange?: (id: string | null) => void;
  title?: ReactNode;
  position?: 'bottom-right' | 'bottom-left';
  /** Distance from the viewport edges in px. */
  offset?: number;
  /** z-index for the launcher/panel. */
  zIndex?: number;
  launcherLabel?: string;
  allowNewConversations?: boolean;
  className?: string;
}

/**
 * Floating launcher + panel. On narrow screens the panel becomes full-screen.
 * Everything renders inside its own `.rc-root`, so the host page is not restyled.
 */
export function ChatWidget({
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  conversationId: controlledConversation,
  onConversationChange,
  title,
  position = 'bottom-right',
  offset = 20,
  zIndex = 900,
  launcherLabel,
  allowNewConversations = true,
  className,
}: ChatWidgetProps) {
  const { strings } = useChatContext();
  const root = useThemeRoot(className);
  const unread = useUnreadTotal();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internalConversation, setInternalConversation] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = controlledOpen ?? internalOpen;
  const conversationId = controlledConversation !== undefined ? controlledConversation : internalConversation;

  const setOpen = (value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
    if (!value) requestAnimationFrame(() => launcher.current?.focus());
  };
  const setConversation = (id: string | null) => {
    if (controlledConversation === undefined) setInternalConversation(id);
    onConversationChange?.(id);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        panel.current?.contains(document.activeElement)
      ) {
        if (conversationId) setConversation(null);
        else setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const side = position === 'bottom-left' ? { left: offset } : { right: offset };
  const style: CSSProperties = { ...root.style, zIndex };
  return (
    <div {...root} style={style} className={cx(root.className, 'rc:contents')}>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label={typeof title === 'string' ? title : strings.conversations}
          className={cx(
            root.className,
            'rc-pop rc:fixed rc:flex rc:flex-col rc:overflow-hidden rc:bg-bg rc:shadow-[var(--rc-shadow)]',
            'rc:inset-0 rc:sm:inset-auto rc:sm:h-[min(640px,calc(100dvh-110px))] rc:sm:w-[380px] rc:sm:rounded-2xl rc:sm:border rc:sm:border-border',
          )}
          data-rc-theme={root['data-rc-theme']}
          style={{
            ...style,
            ...(typeof window !== 'undefined' && window.innerWidth >= 640
              ? { ...side, bottom: offset + 72 }
              : {}),
          }}
        >
          {conversationId ? (
            <ChatWindow
              conversationId={conversationId}
              onBack={() => setConversation(null)}
              onForwarded={(c) => setConversation(c.id)}
              headerActions={
                <IconButton label={strings.closeChat} onClick={() => setOpen(false)}>
                  <X className="rc:size-4" />
                </IconButton>
              }
            />
          ) : (
            <ConversationList
              onSelect={(c) => setConversation(c.id)}
              compact
              header={
                <div className="rc:flex rc:w-full rc:items-center rc:justify-between">
                  <h2 className="rc:text-[15px] rc:font-semibold rc:text-fg">
                    {title ?? strings.conversations}
                  </h2>
                  <div className="rc:flex rc:items-center rc:gap-1">
                    {allowNewConversations && (
                      <IconButton label={strings.newConversation} onClick={() => setCreating(true)}>
                        <MessageSquarePlus className="rc:size-[18px]" />
                      </IconButton>
                    )}
                    <IconButton label={strings.closeChat} onClick={() => setOpen(false)}>
                      <X className="rc:size-4" />
                    </IconButton>
                  </div>
                </div>
              }
              onNewConversation={allowNewConversations ? () => setCreating(true) : undefined}
              className="rc:flex-1"
            />
          )}
        </div>
      )}
      <button
        ref={launcher}
        type="button"
        aria-label={`${open ? strings.closeChat : (launcherLabel ?? strings.openChat)}${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(
          root.className,
          'rc:fixed rc:grid rc:size-14 rc:place-items-center rc:rounded-full rc:bg-primary rc:text-primary-fg rc:shadow-[var(--rc-shadow)] rc:transition rc:hover:brightness-110 rc:active:scale-95',
          open && 'rc:max-sm:hidden',
        )}
        data-rc-theme={root['data-rc-theme']}
        style={{ ...style, ...side, bottom: offset }}
      >
        {open ? <X className="rc:size-6" /> : <MessageCircle className="rc:size-6" />}
        {!open && (
          <UnreadBadge
            count={unread}
            className="rc:absolute rc:-end-0.5 rc:-top-0.5 rc:ring-2 rc:ring-[var(--rc-bg)]"
          />
        )}
      </button>
      {allowNewConversations && (
        <NewConversationDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(c) => setConversation(c.id)}
        />
      )}
    </div>
  );
}
