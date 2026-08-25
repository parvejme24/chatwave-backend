import { isValidObjectId, Types } from 'mongoose';

import type { PreviewIcon } from '../conversations/conversations.constants';

export const MESSAGE_TYPES = ['text', 'image', 'file', 'voice', 'video_note', 'system', 'call'] as const;
export const SENDABLE_TYPES = ['text', 'image', 'file', 'voice', 'video_note'] as const;
export const RECEIPT_STATUSES = ['sent', 'delivered', 'seen'] as const;
export const TEXT_MAX = 4000;
export const FILE_MAX = 20 * 1024 * 1024;

export const MEDIA = {
  image: {
    folder: 'chatwave/messages/images',
    max: 8 * 1024 * 1024,
    mime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    resource: 'image' as const,
    error: 'Use a JPEG, PNG, WebP, or GIF under 8 MB',
  },
  file: {
    folder: 'chatwave/messages/files',
    max: 20 * 1024 * 1024,
    mime: null as string[] | null,
    resource: 'raw' as const,
    error: 'Keep the file under 20 MB',
  },
  voice: {
    folder: 'chatwave/messages/voice',
    max: 10 * 1024 * 1024,
    mime: ['audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/mp4'],
    resource: 'video' as const,
    error: 'Use a WebM, MP3, OGG, or M4A clip under 10 MB',
  },
  video_note: {
    folder: 'chatwave/messages/video',
    max: 20 * 1024 * 1024,
    mime: ['video/webm', 'video/mp4'],
    resource: 'video' as const,
    error: 'Use a WebM or MP4 video under 20 MB',
  },
};

export type MessageType = (typeof MESSAGE_TYPES)[number];
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export type DeleteScope = 'me' | 'everyone';
export type UploadedChatFile = { buffer: Buffer; mimetype: string; size: number; originalname?: string };

export type CanonicalMessage = {
  id: string;
  conversationId: string;
  kind: 'message' | 'call';
  senderId: string | null;
  type: MessageType;
  missed?: boolean;
  label?: string;
  meta?: string;
  callId?: string;
  text: string;
  caption: string;
  fileName: string;
  fileSize: string;
  duration: number;
  seed: number;
  mediaUrl: string;
  time: string;
  status: ReceiptStatus | null;
  sender: {
    id: string;
    name: string;
    username: string;
    initials: string;
    tone: string;
    photoUrl: string | null;
  } | null;
  senderName: string;
  senderTone: string;
  senderInitials: string;
  reply: { id: string; who: string; text: string } | null;
  reactions: { emoji: string; count: number; mine: boolean; userIds?: string[] }[];
  pinned: boolean;
};

export type MessageDto = Omit<CanonicalMessage, 'senderId'> & { dir: 'in' | 'out' };

export type Preview = {
  userId: string;
  conversationId: string;
  preview: string;
  previewIcon: PreviewIcon | null;
  lastMessageAt: string;
  unread: number;
};

export type GroupSocketMember = {
  id: string;
  name: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  presence: string;
  role: 'admin' | 'member';
  isMe: boolean;
};

export type RealtimePublisher = {
  emitNew(conversationId: string, message: CanonicalMessage, members: Preview[]): void;
  emitUpdated(message: CanonicalMessage): void;
  emitDeleted(id: string, conversationId: string, scope: DeleteScope, userId?: string): void;
  emitReceipts(conversationId: string, messageId: string, receipts: { userId: string; status: ReceiptStatus; at: string }[]): void;
  emitGroupUpdated(conversationId: string, payload: { members: GroupSocketMember[]; status: string; sub: string }): void;
  emitMemberLeft(conversationId: string, userId: string, reason: 'left' | 'removed'): void;
  emitConversationRemoved(userId: string, conversationId: string): void;
  emitPreview(userId: string, preview: Omit<Preview, 'userId'>): void;
};

export const room = (kind: 'conversation' | 'user', id: string) => `${kind}:${id}`;

export function isMongoId(id: string) {
  return isValidObjectId(id) && String(new Types.ObjectId(id)) === id;
}

export function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export function toViewerDto(message: CanonicalMessage, viewerId: string): MessageDto {
  const { senderId, ...rest } = message;
  return {
    ...rest,
    dir: senderId === viewerId ? 'out' : 'in',
    status: senderId === viewerId ? message.status : null,
    reactions: message.reactions.map((r) => ({
      emoji: r.emoji,
      count: r.count,
      mine: r.userIds?.includes(viewerId) ?? r.mine,
    })),
  };
}

export function chatId(body: unknown) {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'conversationId' in body) {
    const value = (body as { conversationId: unknown }).conversationId;
    if (typeof value === 'string') return value;
  }
  return '';
}
