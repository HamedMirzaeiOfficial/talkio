import type { ChatMessage, Conversation, UserProfile } from '@realtime-chat/client';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useChatContext } from '../context.js';
import { useChatClient, useChatConfig, useConversations } from '../hooks.js';
import { ConversationItem } from './ConversationItem.js';
import { Button, Dialog } from './primitives.js';
import { UserPicker } from './UserPicker.js';

export interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (conversation: Conversation) => void;
  /** Start in group mode. */
  initialMode?: 'direct' | 'group';
}

/** Start a direct message, or switch to creating a group. */
export function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
  initialMode = 'direct',
}: NewConversationDialogProps) {
  const client = useChatClient();
  const config = useChatConfig();
  const { strings } = useChatContext();
  const [mode, setMode] = useState(initialMode);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupsEnabled = config?.features.groups !== false;

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setMembers([]);
      setTitle('');
      setDescription('');
      setError(null);
    }
  }, [open, initialMode]);

  const run = async (fn: () => Promise<Conversation>) => {
    setBusy(true);
    setError(null);
    try {
      const conversation = await fn();
      onOpenChange(false);
      onCreated(conversation);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (user: UserProfile) =>
    setMembers((current) =>
      current.some((u) => String(u.id) === String(user.id))
        ? current.filter((u) => String(u.id) !== String(user.id))
        : [...current, user],
    );

  const max = config?.limits.max_group_members ?? 256;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'group' ? strings.newGroup : strings.newConversation}
      description={mode === 'group' ? undefined : strings.directMessage}
      footer={
        mode === 'group' ? (
          <>
            <Button onClick={() => setMode('direct')}>{strings.back}</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!title.trim() || members.length === 0 || members.length + 1 > max}
              onClick={() =>
                void run(() =>
                  client.createGroup({
                    title: title.trim(),
                    description: description.trim(),
                    memberIds: members.map((m) => m.id),
                  }),
                )
              }
            >
              {strings.createGroup}
            </Button>
          </>
        ) : undefined
      }
    >
      {mode === 'direct' ? (
        <div className="rc:flex rc:flex-col rc:gap-3">
          {groupsEnabled && (
            <button
              type="button"
              onClick={() => setMode('group')}
              className="rc:flex rc:items-center rc:gap-3 rc:rounded-ui rc:border rc:border-border rc:px-3 rc:py-2.5 rc:text-start rc:text-sm rc:font-medium rc:text-fg rc:hover:bg-surface-2"
            >
              <span className="rc:grid rc:size-8 rc:place-items-center rc:rounded-full rc:bg-primary-soft rc:text-primary">
                <Users className="rc:size-4" />
              </span>
              {strings.newGroup}
            </button>
          )}
          <UserPicker mode="single" onPick={(user) => void run(() => client.startDirect(user.id))} />
        </div>
      ) : (
        <div className="rc:flex rc:flex-col rc:gap-3">
          <label className="rc:flex rc:flex-col rc:gap-1.5">
            <span className="rc:text-[13px] rc:font-medium rc:text-fg">{strings.groupName}</span>
            <input
              autoFocus
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              dir="auto"
              className="rc:h-10 rc:rounded-ui rc:border rc:border-border rc:bg-surface rc:px-3 rc:text-sm rc:text-fg rc:focus:border-primary"
            />
          </label>
          <label className="rc:flex rc:flex-col rc:gap-1.5">
            <span className="rc:text-[13px] rc:font-medium rc:text-fg">{strings.description}</span>
            <textarea
              value={description}
              maxLength={500}
              rows={2}
              onChange={(e) => setDescription(e.target.value)}
              dir="auto"
              className="rc:rounded-ui rc:border rc:border-border rc:bg-surface rc:px-3 rc:py-2 rc:text-sm rc:text-fg rc:focus:border-primary"
            />
          </label>
          <span className="rc:text-[13px] rc:font-medium rc:text-fg">{strings.addMembers}</span>
          <UserPicker mode="multi" selected={members} onPick={toggle} autoFocus={false} />
        </div>
      )}
      {error && (
        <p role="alert" className="rc:mt-3 rc:text-[13px] rc:text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export interface AddMembersDialogProps {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMembersDialog({ conversation, open, onOpenChange }: AddMembersDialogProps) {
  const client = useChatClient();
  const { strings } = useChatContext();
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setMembers([]);
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={strings.addMembers}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={members.length === 0}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await client.addMembers(
                conversation.id,
                members.map((m) => m.id),
              );
              onOpenChange(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {strings.addMembers}
        </Button>
      }
    >
      <UserPicker
        mode="multi"
        selected={members}
        exclude={conversation.members.map((m) => m.id)}
        onPick={(user) =>
          setMembers((c) =>
            c.some((u) => u.id === user.id) ? c.filter((u) => u.id !== user.id) : [...c, user],
          )
        }
      />
      {error && (
        <p role="alert" className="rc:mt-3 rc:text-[13px] rc:text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export interface ForwardDialogProps {
  message: ChatMessage | null;
  onOpenChange: (open: boolean) => void;
  onForwarded?: (conversation: Conversation) => void;
}

export function ForwardDialog({ message, onOpenChange, onForwarded }: ForwardDialogProps) {
  const client = useChatClient();
  const { strings } = useChatContext();
  const conversations = useConversations();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange} title={strings.forwardTo} width="sm">
      <ul className="rc:flex rc:flex-col rc:gap-0.5">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <ConversationItem
              compact
              conversation={conversation}
              onSelect={async () => {
                if (!message) return;
                try {
                  await client.forwardMessage(message.id, conversation.id);
                  onOpenChange(false);
                  onForwarded?.(conversation);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="rc:mt-3 rc:text-[13px] rc:text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
