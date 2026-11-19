import type { Member } from '@realtime-chat/client';
import { Crown, MoreVertical, Shield, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { useChatContext } from '../context.js';
import { useChatClient, useChatConfig, useConversation, useMe } from '../hooks.js';
import { AddMembersDialog } from './dialogs.js';
import { PresenceIndicator } from './PresenceIndicator.js';
import { Button, Menu, MenuContent, MenuItem, MenuTrigger } from './primitives.js';
import { UserAvatar } from './UserAvatar.js';

export interface GroupMemberListProps {
  conversationId: string;
  onSelectMember?: (member: Member) => void;
}

const rank = { owner: 0, admin: 1, member: 2 } as const;

export function GroupMemberList({ conversationId, onSelectMember }: GroupMemberListProps) {
  const client = useChatClient();
  const conversation = useConversation(conversationId);
  const config = useChatConfig();
  const me = useMe();
  const { strings } = useChatContext();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!conversation) return null;
  const myRole = conversation.my_role;
  const isGroup = conversation.kind === 'group';
  const canAdd = isGroup && (myRole === 'owner' || myRole === 'admin');
  const members = [...conversation.members].sort(
    (a, b) =>
      rank[a.role] - rank[b.role] ||
      Number(!a.online) - Number(!b.online) ||
      a.display_name.localeCompare(b.display_name),
  );
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e: Error) => setError(e.message));
  };

  return (
    <section aria-label={strings.members} className="rc:flex rc:flex-col rc:gap-1">
      <div className="rc:flex rc:items-center rc:justify-between rc:px-1 rc:pb-1">
        <h3 className="rc:text-[12px] rc:font-semibold rc:tracking-wide rc:text-muted rc:uppercase">
          {conversation.member_count} {strings.members}
        </h3>
        {canAdd && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAdding(true)}
            disabled={conversation.member_count >= (config?.limits.max_group_members ?? Infinity)}
          >
            <UserPlus className="rc:size-4" />
            {strings.addMembers}
          </Button>
        )}
      </div>
      <ul className="rc:flex rc:flex-col rc:gap-0.5">
        {members.map((member) => {
          const self = String(member.id) === String(me?.id);
          const canManage =
            isGroup &&
            !self &&
            member.role !== 'owner' &&
            (myRole === 'owner' || (myRole === 'admin' && member.role === 'member'));
          return (
            <li
              key={String(member.id)}
              className="rc:flex rc:items-center rc:gap-3 rc:rounded-ui rc:px-1 rc:py-1.5"
            >
              <button
                type="button"
                disabled={!onSelectMember}
                onClick={() => onSelectMember?.(member)}
                className="rc:flex rc:min-w-0 rc:flex-1 rc:items-center rc:gap-3 rc:text-start rc:disabled:cursor-default"
              >
                <UserAvatar user={member} size="sm" showPresence />
                <span className="rc:flex rc:min-w-0 rc:flex-col">
                  <span dir="auto" className="rc:truncate rc:text-sm rc:font-medium rc:text-fg">
                    {member.display_name} {self && <span className="rc:text-muted">({strings.you})</span>}
                  </span>
                  <PresenceIndicator userId={member.id} className="rc:text-[12px]" />
                </span>
              </button>
              {member.role !== 'member' && (
                <span className="rc:inline-flex rc:items-center rc:gap-1 rc:rounded-full rc:bg-primary-soft rc:px-2 rc:py-0.5 rc:text-[11px] rc:font-medium rc:text-primary">
                  {member.role === 'owner' ? (
                    <Crown className="rc:size-3" />
                  ) : (
                    <Shield className="rc:size-3" />
                  )}
                  {member.role === 'owner' ? strings.owner : strings.admin}
                </span>
              )}
              {canManage && (
                <Menu>
                  <MenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Manage ${member.display_name}`}
                      className="rc:grid rc:size-7 rc:place-items-center rc:rounded-md rc:text-subtle rc:hover:bg-surface-2 rc:hover:text-fg"
                    >
                      <MoreVertical className="rc:size-4" />
                    </button>
                  </MenuTrigger>
                  <MenuContent>
                    {myRole === 'owner' && (
                      <MenuItem
                        onSelect={() =>
                          run(() =>
                            client.changeRole(
                              conversationId,
                              member.id,
                              member.role === 'admin' ? 'member' : 'admin',
                            ),
                          )
                        }
                      >
                        {member.role === 'admin' ? strings.removeAdmin : strings.makeAdmin}
                      </MenuItem>
                    )}
                    {myRole === 'owner' && (
                      <MenuItem
                        onSelect={() => run(() => client.changeRole(conversationId, member.id, 'owner'))}
                      >
                        {strings.transferOwnership}
                      </MenuItem>
                    )}
                    <MenuItem
                      danger
                      onSelect={() => run(() => client.removeMember(conversationId, member.id))}
                    >
                      {strings.removeMember}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="rc:px-1 rc:text-[13px] rc:text-danger">
          {error}
        </p>
      )}
      {canAdd && <AddMembersDialog conversation={conversation} open={adding} onOpenChange={setAdding} />}
    </section>
  );
}
