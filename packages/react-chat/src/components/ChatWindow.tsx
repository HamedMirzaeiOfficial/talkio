import type { ChatMessage, Conversation } from '@realtime-chat/client';
import { MessagesSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useChatContext, useThemeRoot } from '../context.js';
import { useChatClient, useConversation, useConversationList, useMe } from '../hooks.js';
import { cx } from '../utils.js';
import { ConnectionBanner } from './ConnectionBanner.js';
import { ConversationHeader } from './ConversationHeader.js';
import { ForwardDialog } from './dialogs.js';
import type { MessageComposerHandle } from './MessageComposer.js';
import { MessageComposer } from './MessageComposer.js';
import { MessageList } from './MessageList.js';
import { EmptyState, Spinner } from './primitives.js';
import { TypingIndicator } from './TypingIndicator.js';

export interface ChatWindowProps {
  conversationId: string | null | undefined;
  /** Back navigation (mobile / widget). */
  onBack?: () => void;
  /** Toggle a details panel rendered by the host (e.g. <ConversationInfoPanel/>). */
  onToggleInfo?: () => void;
  infoOpen?: boolean;
  headerActions?: ReactNode;
  /** Called after forwarding, e.g. to navigate to the destination conversation. */
  onForwarded?: (conversation: Conversation) => void;
  /** Shown when no conversation is selected. */
  placeholder?: ReactNode;
  className?: string;
}

/** Header + live message list + typing line + composer for one conversation. */
export function ChatWindow({
  conversationId,
  onBack,
  onToggleInfo,
  infoOpen,
  headerActions,
  onForwarded,
  placeholder,
  className,
}: ChatWindowProps) {
  const root = useThemeRoot(className);
  const client = useChatClient();
  const { strings } = useChatContext();
  const me = useMe();
  const list = useConversationList();
  const conversation = useConversation(conversationId);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const composer = useRef<MessageComposerHandle>(null);

  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
  }, [conversationId]);

  // Deep links to conversations that are not in the first page of the list.
  useEffect(() => {
    if (conversationId && list.loaded && !conversation) void client.refreshConversation(conversationId);
  }, [client, conversationId, list.loaded, conversation]);

  const editLast = useCallback(() => {
    if (!conversationId) return;
    const items = client.getState().messages[conversationId]?.items ?? [];
    const last = [...items]
      .reverse()
      .find((m) => m.status === 'sent' && !m.is_deleted && String(m.sender?.id) === String(me?.id));
    if (last) setEditing(last);
  }, [client, conversationId, me?.id]);

  const shell = (children: ReactNode) => (
    <section
      {...root}
      className={cx(root.className, 'rc:flex rc:h-full rc:min-h-0 rc:min-w-0 rc:flex-col rc:bg-bg')}
    >
      {children}
    </section>
  );

  if (!conversationId) {
    return shell(
      placeholder ?? (
        <EmptyState icon={<MessagesSquare className="rc:size-5" />} title={strings.chooseConversation} />
      ),
    );
  }
  if (!conversation) {
    return shell(
      list.loaded ? (
        <EmptyState
          title="Conversation not found"
          hint="It may have been removed, or you are no longer a member."
        />
      ) : (
        <div className="rc:grid rc:flex-1 rc:place-items-center">
          <Spinner />
        </div>
      ),
    );
  }
  return shell(
    <>
      <ConversationHeader
        conversationId={conversationId}
        onBack={onBack}
        onToggleInfo={onToggleInfo}
        infoOpen={infoOpen}
        actions={headerActions}
        className="rc:bg-surface"
      />
      <ConnectionBanner />
      <MessageList
        conversationId={conversationId}
        onReply={(m) => {
          setEditing(null);
          setReplyTo(m);
        }}
        onEdit={(m) => {
          setReplyTo(null);
          setEditing(m);
        }}
        onForward={setForwarding}
      />
      <TypingIndicator conversationId={conversationId} />
      <MessageComposer
        ref={composer}
        conversationId={conversationId}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={() => {
          setEditing(null);
          composer.current?.focus();
        }}
        onEditLast={editLast}
      />
      <ForwardDialog
        message={forwarding}
        onOpenChange={(open) => !open && setForwarding(null)}
        onForwarded={onForwarded}
      />
    </>,
  );
}
