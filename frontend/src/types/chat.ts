export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';

export interface User {
  id: number;
  username: string;
  display_name: string;
  email?: string | null;
}

export interface Message {
  id: string;
  client_id?: string | null;
  conversation: string;
  body: string;
  sender: User;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  attachments?: Attachment[];
  reactions?: Reaction[];
}

export interface Attachment { id: number; name: string; content_type: string; size: number; url: string; }
export interface Reaction { emoji: string; count: number; }

export interface Conversation {
  slug: string;
  name: string;
  kind: 'direct' | 'group';
  members: User[];
  last_message: Message | null;
}

export interface UserPage { results: User[]; }

export interface Page<T> {
  results: T[];
  next_cursor: string | null;
}

export type ServerEvent =
  | { type: 'message.created'; message: Message; request_id: string; deduplicated: boolean }
  | { type: 'presence.changed'; user_id: number; status: 'online' | 'offline' }
  | { type: 'typing.changed'; user_id: number; is_typing: boolean }
  | { type: 'message.read'; user_id: number; message_id: string }
  | { type: 'error'; code: string; message: string };
