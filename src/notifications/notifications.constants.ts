import { isValidObjectId, Types } from 'mongoose';

export const NOTIFICATION_TYPES = ['message', 'reaction', 'group', 'call', 'missed_call', 'system'] as const;
export const OFFLINE_FOR_EMAIL_MS = 30 * 60 * 1000;
export const NOTIFY_RATE_MAX = 60;
export const NOTIFY_RATE_WINDOW = 60;

export const EVENT_MESSAGE_CREATED = 'message.created';
export const EVENT_CALL_INCOMING = 'call.incoming';
export const EVENT_CALL_MISSED = 'call.missed';
export const EVENT_GROUP_MEMBER_ADDED = 'group.member-added';

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationActorDto = {
  id: string;
  name: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
};

export type NotificationDto = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
  actor: NotificationActorDto | null;
  conversationId: string | null;
  messageId: string | null;
};

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  conversationId?: string | null;
  messageId?: string | null;
  callId?: string | null;
  actorId?: string | null;
  meta?: Record<string, unknown>;
  skipIfInThread?: boolean;
  preview?: string;
};

export type MessageCreatedEvent = {
  senderId: string;
  conversation: {
    id: string;
    type: string;
    name: string;
    members: Array<{ user: unknown; muted?: boolean; leftAt?: Date | null }>;
  };
  message: { id: string; type: string; text?: string; caption?: string };
  preview: string;
  actorName: string;
};

export type CallNotifyEvent = {
  callId: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  type: string;
  recipientIds: string[];
  href: string;
  label: string;
};

export type GroupMemberAddedEvent = {
  conversationId: string;
  groupName: string;
  actorId: string;
  actorName: string;
  userIds: string[];
};

export function isMongoId(id: string) {
  return isValidObjectId(id) && String(new Types.ObjectId(id)) === id;
}

export function chatHref(conversationId: string) {
  return `/chats/${conversationId}`;
}
