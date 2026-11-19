import type { Member, Message } from '@realtime-chat/client';
import { LogOut, Pencil, Pin, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useChatContext, useThemeRoot } from '../context.js';
import { useChatClient, useConversation } from '../hooks.js';
import { cx, formatTime } from '../utils.js';
import { GroupMemberList } from './GroupMemberList.js';
import { MessageText } from './MessageBubble.js';
import { PresenceIndicator } from './PresenceIndicator.js';
import { Button, Dialog, IconButton, Spinner } from './primitives.js';
import { UserAvatar } from './UserAvatar.js';

export interface ConversationInfoPanelProps {
  conversationId: string;
  onClose?: () => void;
  /** Called after leaving a group. */
  onLeft?: () => void;
  onSelectMember?: (member: Member) => void;
  className?: string;
}

export function ConversationInfoPanel({
  conversationId,
  onClose,
  onLeft,
  onSelectMember,
  className,
}: ConversationInfoPanelProps) {
  const client = useChatClient();
  const conversation = useConversation(conversationId);
  const { strings, locale } = useChatContext();
  const root = useThemeRoot(className);
  const [pinned, setPinned] = useState<Message[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinSignature = conversation?.last_message?.pinned_at ?? '';

  useEffect(() => {
    const controller = new AbortController();
    setPinned(null);
    client.api
      .listMessages(conversationId, { pinned: true, signal: controller.signal })
      .then((page) => setPinned(page.results))
      .catch(() => setPinned([]));
    return () => controller.abort();
  }, [client, conversationId, pinSignature]);

  if (!conversation) return null;
  const isGroup = conversation.kind === 'group';
  const canEdit = isGroup && (conversation.my_role === 'owner' || conversation.my_role === 'admin');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.updateConversation(conversationId, {
        title: title.trim(),
        description: description.trim(),
      });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      {...root}
      aria-label={strings.details}
      className={cx(
        root.className,
        'rc:flex rc:h-full rc:min-h-0 rc:flex-col rc:border-s rc:border-border rc:bg-surface',
      )}
    >
      <header className="rc:flex rc:h-14 rc:shrink-0 rc:items-center rc:justify-between rc:border-b rc:border-border rc:px-4">
        <h2 className="rc:text-[15px] rc:font-semibold rc:text-fg">{strings.details}</h2>
        {onClose && (
          <IconButton label={strings.close} onClick={onClose}>
            <X className="rc:size-4" />
          </IconButton>
        )}
      </header>
      <div className="rc-scroll rc:min-h-0 rc:flex-1 rc:overflow-y-auto rc:p-4">
        <div className="rc:flex rc:flex-col rc:items-center rc:gap-2 rc:pb-5 rc:text-center">
          <UserAvatar
            user={
              isGroup
                ? { id: conversation.id, display_name: conversation.title, avatar_url: null }
                : conversation.peer
            }
            group={isGroup}
            size="xl"
          />
          <h3 dir="auto" className="rc:mt-1 rc:text-lg rc:font-semibold rc:text-fg">
            {conversation.title}
          </h3>
          {isGroup ? (
            <p className="rc:text-[13px] rc:text-muted">
              {conversation.member_count} {strings.members}
            </p>
          ) : (
            conversation.peer && (
              <>
                {conversation.peer.username && (
                  <p className="rc:text-[13px] rc:text-muted">@{conversation.peer.username}</p>
                )}
                <PresenceIndicator userId={conversation.peer.id} />
              </>
            )
          )}
          {conversation.description && (
            <p dir="auto" className="rc:max-w-xs rc:text-[13px] rc:text-muted">
              {conversation.description}
            </p>
          )}
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTitle(conversation.title);
                setDescription(conversation.description);
                setEditing(true);
              }}
            >
              <Pencil className="rc:size-3.5" />
              {strings.edit}
            </Button>
          )}
        </div>

        <section className="rc:mb-5">
          <h3 className="rc:mb-2 rc:flex rc:items-center rc:gap-1.5 rc:px-1 rc:text-[12px] rc:font-semibold rc:tracking-wide rc:text-muted rc:uppercase">
            <Pin className="rc:size-3.5" />
            {strings.pinned}
          </h3>
          {pinned === null ? (
            <Spinner />
          ) : pinned.length === 0 ? (
            <p className="rc:px-1 rc:text-[13px] rc:text-subtle">{strings.noPinned}</p>
          ) : (
            <ul className="rc:flex rc:flex-col rc:gap-1.5">
              {pinned.map((m) => (
                <li key={m.id} className="rc:rounded-lg rc:bg-surface-2 rc:px-3 rc:py-2">
                  <p className="rc:mb-0.5 rc:text-[12px] rc:text-muted">
                    {m.sender?.display_name} · {formatTime(m.created_at, locale)}
                  </p>
                  <MessageText
                    text={m.body || (m.attachments[0] ? `📎 ${m.attachments[0].name}` : '')}
                    className="rc:line-clamp-3 rc:text-[13px] rc:text-fg"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {isGroup && <GroupMemberList conversationId={conversationId} onSelectMember={onSelectMember} />}

        {isGroup && (
          <Button
            variant="ghost"
            className="rc:mt-5 rc:w-full rc:text-danger rc:hover:text-danger"
            onClick={() => setConfirmLeave(true)}
          >
            <LogOut className="rc:size-4" />
            {strings.leaveGroup}
          </Button>
        )}
      </div>

      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={strings.edit}
        footer={
          <>
            <Button onClick={() => setEditing(false)}>{strings.cancel}</Button>
            <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={() => void save()}>
              {strings.save}
            </Button>
          </>
        }
      >
        <div className="rc:flex rc:flex-col rc:gap-3">
          <label className="rc:flex rc:flex-col rc:gap-1.5">
            <span className="rc:text-[13px] rc:font-medium">{strings.groupName}</span>
            <input
              dir="auto"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              className="rc:h-10 rc:rounded-ui rc:border rc:border-border rc:bg-surface rc:px-3 rc:text-sm rc:focus:border-primary"
            />
          </label>
          <label className="rc:flex rc:flex-col rc:gap-1.5">
            <span className="rc:text-[13px] rc:font-medium">{strings.description}</span>
            <textarea
              dir="auto"
              rows={3}
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
              className="rc:rounded-ui rc:border rc:border-border rc:bg-surface rc:px-3 rc:py-2 rc:text-sm rc:focus:border-primary"
            />
          </label>
          {error && (
            <p role="alert" className="rc:text-[13px] rc:text-danger">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <Dialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        width="sm"
        title={`${strings.leaveGroup}?`}
        description={conversation.title}
        footer={
          <>
            <Button onClick={() => setConfirmLeave(false)}>{strings.cancel}</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await client.leaveConversation(conversationId);
                  setConfirmLeave(false);
                  onLeft?.();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {strings.leaveGroup}
            </Button>
          </>
        }
      >
        {error && (
          <p role="alert" className="rc:text-[13px] rc:text-danger">
            {error}
          </p>
        )}
      </Dialog>
    </aside>
  );
}
