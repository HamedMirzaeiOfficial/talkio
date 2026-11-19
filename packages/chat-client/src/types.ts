/**
 * Wire types for django-realtime-chat protocol version 1.
 * These mirror the payloads documented in docs/api/rest-api.md and docs/api/websocket.md.
 */

export type UserId = number | string;
export type ConversationKind = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';

export interface ChatUser {
  id: UserId;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
}

export interface PresenceInfo {
  online: boolean;
  last_seen_at: string | null;
}

export interface UserProfile extends ChatUser, PresenceInfo {}

export interface Member extends ChatUser, PresenceInfo {
  role: MemberRole;
  last_read_seq: number;
  joined_at: string | null;
}

export interface Attachment {
  id: string;
  conversation_id: string;
  message_id: string | null;
  name: string;
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  /** WebP preview for large still images; null for small/animated images and non-images. */
  thumbnail_url: string | null;
  is_voice: boolean;
  /** Seconds (voice notes). */
  duration: number | null;
  /** Up to 128 amplitude bars, 0–100 (voice notes). */
  waveform: number[] | null;
  created_at: string | null;
}

export interface Sticker {
  id: string;
  pack_id: string;
  emoji: string;
  content_type: string;
  width: number | null;
  height: number | null;
  url: string;
}

export interface StickerPack {
  id: string;
  name: string;
  stickers: Sticker[];
}

/** What a message mainly contains (previews, reply quotes). */
export type MessageKind =
  'text' | 'image' | 'gif' | 'video' | 'audio' | 'voice' | 'file' | 'sticker' | 'deleted';

export interface ReactionSummary {
  emoji: string;
  count: number;
  user_ids: UserId[];
}

export interface MessageRef {
  id: string;
  seq: number;
  conversation_id: string;
  sender: ChatUser | null;
  body: string;
  is_deleted: boolean;
  kind: MessageKind;
}

export interface Message {
  id: string;
  conversation_id: string;
  seq: number;
  client_id: string;
  sender: ChatUser | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  is_deleted: boolean;
  reply_to: MessageRef | null;
  forwarded_from: MessageRef | null;
  pinned_at: string | null;
  attachments: Attachment[];
  sticker: Sticker | null;
  reactions: ReactionSummary[];
  kind: MessageKind;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  title: string;
  description: string;
  created_at: string | null;
  last_seq: number;
  last_message: Message | null;
  last_activity_at: string | null;
  unread_count: number;
  my_role: MemberRole | null;
  my_last_read_seq: number;
  member_count: number;
  peer: (ChatUser & PresenceInfo) | null;
  members: Member[];
}

export interface Page<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface ChatConfig {
  version: string;
  protocol_version: number;
  user: UserProfile;
  features: {
    groups: boolean;
    attachments: boolean;
    reactions: boolean;
    user_search: boolean;
    stickers: boolean;
    voice: boolean;
  };
  limits: {
    max_message_length: number;
    max_attachment_size: number;
    max_attachments_per_message: number;
    max_group_members: number;
    edit_window: number | null;
    max_voice_duration: number;
  };
  allowed_attachment_types: string[];
  /** null = any emoji. */
  allowed_reactions: string[] | null;
  quick_reactions: string[];
  presence_ttl: number;
  typing_timeout: number;
}

/* ---------------------------------------------------------------------------------- */
/* WebSocket events (server → client)                                                  */
/* ---------------------------------------------------------------------------------- */

export interface ConnectionReadyEvent {
  type: 'connection.ready';
  protocol_version: number;
  connection_id: string;
  user: ChatUser;
  conversation_ids: string[];
  heartbeat_interval: number;
  server_time: string;
}
export interface MessageCreatedEvent {
  type: 'message.created';
  conversation_id: string;
  message: Message;
}
export interface MessageUpdatedEvent {
  type: 'message.updated';
  conversation_id: string;
  message: Message;
}
export interface MessageDeletedEvent {
  type: 'message.deleted';
  conversation_id: string;
  message: Message;
}
export interface ReactionUpdatedEvent {
  type: 'reaction.updated';
  conversation_id: string;
  message_id: string;
  seq: number;
  reactions: ReactionSummary[];
}
export interface TypingUpdatedEvent {
  type: 'typing.updated';
  conversation_id: string;
  user_id: UserId;
  is_typing: boolean;
  expires_in: number;
}
export interface PresenceUpdatedEvent {
  type: 'presence.updated';
  conversation_id: string;
  user_id: UserId;
  online: boolean;
  last_seen_at: string | null;
}
export interface ReadUpdatedEvent {
  type: 'read.updated';
  conversation_id: string;
  user_id: UserId;
  last_read_seq: number;
}
export interface ConversationUpdatedEvent {
  type: 'conversation.updated';
  conversation: Conversation;
}
export interface ConversationRemovedEvent {
  type: 'conversation.removed';
  conversation_id: string;
}
export interface AckEvent {
  type: 'ack';
  request_id: string | null;
  data: unknown;
}
export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  request_id?: string;
  details?: unknown;
}
export interface PongEvent {
  type: 'pong';
  request_id: string | null;
  server_time: string;
}

export type ServerEvent =
  | ConnectionReadyEvent
  | MessageCreatedEvent
  | MessageUpdatedEvent
  | MessageDeletedEvent
  | ReactionUpdatedEvent
  | TypingUpdatedEvent
  | PresenceUpdatedEvent
  | ReadUpdatedEvent
  | ConversationUpdatedEvent
  | ConversationRemovedEvent
  | AckEvent
  | ErrorEvent
  | PongEvent;

export type ServerEventType = ServerEvent['type'];

/* Client → server */
export type ClientEvent =
  | { type: 'ping'; request_id?: string }
  | {
      type: 'message.send';
      request_id: string;
      conversation_id: string;
      client_id: string;
      body: string;
      reply_to_id?: string | null;
      attachment_ids?: string[];
      sticker_id?: string | null;
    }
  | { type: 'typing.start' | 'typing.stop'; conversation_id: string }
  | { type: 'read.mark'; request_id?: string; conversation_id: string; seq: number };
