import { isValidObjectId, Types } from 'mongoose';

import type { PreviewIcon } from '../conversations/conversations.constants';

export const MESSAGE_TYPES = ['text', 'image', 'file', 'voice', 'video', 'video_note', 'system', 'call'] as const;
export const SENDABLE_TYPES = ['text', 'image', 'file', 'voice', 'video', 'video_note'] as const;
export const RECEIPT_STATUSES = ['sent', 'delivered', 'seen'] as const;
export const TEXT_MAX = 4000;
export const FILE_MAX = 50 * 1024 * 1024;
export const FILES_MAX = 10;

export const MEDIA = {
  image: {
    folder: 'chatwave/messages/images',
    max: 10 * 1024 * 1024,
    mime: null as string[] | null,
    prefix: 'image/',
    resource: 'image' as const,
    error: 'Keep each image under 10 MB',
  },
  file: {
    folder: 'chatwave/messages/files',
    max: FILE_MAX,
    mime: null as string[] | null,
    prefix: null as string | null,
    resource: 'raw' as const,
    error: 'Keep each file under 50 MB',
  },
  voice: {
    folder: 'chatwave/messages/voice',
    max: 10 * 1024 * 1024,
    mime: ['audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac'],
    prefix: 'audio/',
    resource: 'video' as const,
    error: 'Use an audio clip under 10 MB',
  },
  video: {
    folder: 'chatwave/messages/video',
    max: FILE_MAX,
    mime: null as string[] | null,
    prefix: 'video/',
    resource: 'video' as const,
    error: 'Keep each video under 50 MB',
  },
  video_note: {
    folder: 'chatwave/messages/video',
    max: FILE_MAX,
    mime: null as string[] | null,
    prefix: 'video/',
    resource: 'video' as const,
    error: 'Keep each video under 50 MB',
  },
};

export type MessageType = (typeof MESSAGE_TYPES)[number];
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export type DeleteScope = 'me' | 'everyone';
export type AttachmentKind = 'image' | 'video' | 'file' | 'link';
export type UploadedChatFile = { buffer: Buffer; mimetype: string; size: number; originalname?: string; fieldname?: string };

export type MessageAttachment = {
  url: string;
  fileName: string;
  fileSize: string;
  mimeType: string;
  duration: number;
  width: number;
  height: number;
  kind: AttachmentKind;
};

export type ReceiptViewer = {
  id: string;
  name: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  at: string;
};

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
  attachments: MessageAttachment[];
  time: string;
  status: ReceiptStatus | null;
  seenBy: ReceiptViewer[];
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

export function seenByFromReceipts(
  receipts: Array<{ user: { toString(): string } | string; status: string; at?: Date }>,
  senderId: string | null,
  people: Map<
    string,
    {
      id: string;
      name: string;
      username: string;
      initials: string;
      tone: string;
      photoUrl?: string | null;
    }
  >,
): ReceiptViewer[] {
  const seen: ReceiptViewer[] = [];
  for (const receipt of receipts) {
    if (receipt.status !== 'seen') continue;
    const id = String(receipt.user);
    if (senderId && id === senderId) continue;
    const person = people.get(id);
    if (!person) continue;
    seen.push({
      id,
      name: person.name,
      username: person.username,
      initials: person.initials,
      tone: person.tone,
      photoUrl: person.photoUrl ?? null,
      at: (receipt.at ?? new Date()).toISOString(),
    });
  }
  seen.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return seen;
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

export function coerceLinks(value: unknown): string[] {
  if (value == null || value === '') return [];
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? parseLinkString(value)
      : [];
  const links: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const href = item.trim();
    if (!/^https?:\/\//i.test(href) || href.length > 2000) continue;
    links.push(href);
    if (links.length >= FILES_MAX) break;
  }
  return links;
}

function parseLinkString(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [trimmed];
    } catch {
      return [trimmed];
    }
  }
  return [trimmed];
}

export function collectUploads(uploaded?: { file?: UploadedChatFile[]; files?: UploadedChatFile[] } | UploadedChatFile[]) {
  const list = Array.isArray(uploaded)
    ? uploaded
    : [...(uploaded?.file ?? []), ...(uploaded?.files ?? [])];
  return list.filter((file) => file?.buffer?.length).slice(0, FILES_MAX);
}

export function attachmentKind(mime: string, href?: string): AttachmentKind {
  if (href && !mime) return 'link';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'text/uri-list') return 'link';
  return 'file';
}

export function cloudinaryResource(kind: AttachmentKind | 'voice' | 'video_note'): 'image' | 'video' | 'raw' {
  if (kind === 'image') return 'image';
  if (kind === 'video' || kind === 'voice' || kind === 'video_note') return 'video';
  return 'raw';
}

export function toMessageAttachment(row: {
  url?: string;
  fileName?: string;
  fileSize?: string;
  mimeType?: string;
  duration?: number;
  width?: number;
  height?: number;
  kind?: string;
}): MessageAttachment {
  const mime = row.mimeType ?? '';
  const kind = (['image', 'video', 'file', 'link'] as const).includes(row.kind as AttachmentKind)
    ? (row.kind as AttachmentKind)
    : attachmentKind(mime, row.url);
  return {
    url: row.url ?? '',
    fileName: row.fileName ?? '',
    fileSize: row.fileSize ?? '',
    mimeType: mime,
    duration: row.duration ?? 0,
    width: row.width ?? 0,
    height: row.height ?? 0,
    kind,
  };
}
