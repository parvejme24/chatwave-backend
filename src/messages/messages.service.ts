import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { BlocksService } from '../blocks/blocks.service';
import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { RedisService } from '../common/redis/redis.service';
import { viewerPreview, type PreviewIcon } from '../conversations/conversations.constants';
import { ConversationDocument } from '../conversations/conversation.schema';
import { ConversationsService } from '../conversations/conversations.service';
import type { AuthViewer } from '../users/users.constants';
import { UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import {
  FILE_MAX,
  MEDIA,
  TEXT_MAX,
  isMongoId,
  stripHtml,
  toViewerDto,
  type CanonicalMessage,
  type DeleteScope,
  type MessageType,
  type RealtimePublisher,
  type ReceiptStatus,
  type UploadedChatFile,
} from './messages.constants';
import { SendMessageDto } from './messages.dto';
import { Message, MessageDocument } from './message.schema';

@Injectable()
export class MessagesService {
  private live: RealtimePublisher | null = null;

  constructor(
    @InjectModel(Message.name) private readonly messages: Model<MessageDocument>,
    private readonly conversations: ConversationsService,
    private readonly users: UsersService,
    private readonly cloudinary: CloudinaryService,
    private readonly redis: RedisService,
    @Optional() @Inject(forwardRef(() => BlocksService)) private readonly blocks?: BlocksService,
  ) {}

  bindPublisher(publisher: RealtimePublisher) {
    this.live = publisher;
  }

  async list(viewer: AuthViewer, conversationId: string, query: { cursor?: string; limit?: number; view?: string; q?: string }) {
    const conversation = await this.conversations.assertMember(viewer.id, conversationId);
    const take = Math.min(Math.max(query.limit || 30, 1), 100);
    const filter: Record<string, unknown> = {
      conversation: oid(conversationId),
      deletedAt: null,
      deletedFor: { $ne: oid(viewer.id) },
    };
    if (query.view === 'pinned') filter.pinned = true;
    if (query.q?.trim()) filter.$text = { $search: query.q.trim() };
    if (query.cursor) {
      const before = isMongoId(query.cursor)
        ? (await this.messages.findById(query.cursor).exec())?.createdAt
        : new Date(query.cursor);
      if (before && !Number.isNaN(+before)) filter.createdAt = { $lt: before };
    }
    const rows = await this.messages.find(filter).sort({ createdAt: -1 }).limit(take + 1).exec();
    const hasMore = rows.length > take;
    const page = [...(hasMore ? rows.slice(0, take) : rows)].reverse();
    const mapped = await this.mapMany(page, conversation, viewer.id);
    return { messages: mapped.map((m) => toViewerDto(m, viewer.id)), nextCursor: hasMore ? page[0]?.id ?? null : null };
  }

  async send(viewer: AuthViewer, conversationId: string, dto: SendMessageDto, file?: UploadedChatFile) {
    if (file || dto.type !== 'text') {
      const media = await this.upload(dto, file);
      return this.persist(viewer, conversationId, { type: dto.type, caption: stripHtml(dto.caption ?? '').slice(0, 1000), replyTo: dto.replyTo, media });
    }
    const text = stripHtml(dto.text ?? '');
    if (!text) throw new BadRequestException({ error: 'Write a message first' });
    if (text.length > TEXT_MAX) throw new BadRequestException({ error: 'That message is too long' });
    return this.persist(viewer, conversationId, { type: 'text', text, replyTo: dto.replyTo });
  }

  async sendSystem(conversationId: string, senderId: string | null, text: string) {
    const value = stripHtml(text);
    if (!value) return null;
    const conversation = await this.conversations.getById(conversationId);
    if (!conversation) return null;
    const row = await this.messages.create({
      conversation: oid(conversationId),
      sender: senderId ? oid(senderId) : null,
      type: 'system',
      text: value,
      receipts: senderId ? [{ user: oid(senderId), status: 'sent', at: new Date() }] : [],
    });
    const bumped = await this.conversations.bumpFromMessage(conversationId, {
      senderId: senderId ?? '',
      preview: value,
      previewIcon: null,
      messageId: row.id,
    });
    const live = bumped ?? conversation;
    const message = await this.mapOne(row, live, await this.people([row], live));
    const conversationKey = String(live.id ?? live._id);
    this.live?.emitNew(
      conversationKey,
      message,
      this.conversations.activeMemberIds(live).map((userId) => ({
        userId,
        conversationId: conversationKey,
        preview: viewerPreview(value, message.senderId, userId),
        previewIcon: null,
        lastMessageAt: (live.lastMessageAt ?? new Date()).toISOString(),
        unread: this.conversations.unreadOf(live, userId),
      })),
    );
    return message;
  }

  async sendCallLog(
    conversationId: string,
    senderId: string,
    input: { callId: string; missed: boolean; label: string; meta: string },
  ) {
    const conversation = await this.conversations.getById(conversationId);
    if (!conversation) return null;
    const row = await this.messages.create({
      conversation: oid(conversationId),
      sender: oid(senderId),
      type: 'call',
      text: input.label,
      callId: oid(input.callId),
      callMeta: { kind: 'call', missed: input.missed, label: input.label, meta: input.meta, callId: input.callId },
      receipts: [{ user: oid(senderId), status: 'sent', at: new Date() }],
    });
    const bumped = await this.conversations.bumpFromMessage(conversationId, {
      senderId,
      preview: input.label,
      previewIcon: null,
      messageId: row.id,
    });
    const live = bumped ?? conversation;
    const message = await this.mapOne(row, live, await this.people([row], live));
    const conversationKey = String(live.id ?? live._id);
    this.live?.emitNew(
      conversationKey,
      message,
      this.conversations.activeMemberIds(live).map((userId) => ({
        userId,
        conversationId: conversationKey,
        preview: viewerPreview(input.label, message.senderId, userId),
        previewIcon: null,
        lastMessageAt: (live.lastMessageAt ?? new Date()).toISOString(),
        unread: this.conversations.unreadOf(live, userId),
      })),
    );
    return message;
  }

  async updateCallLog(callId: string, input: { missed: boolean; label: string; meta: string; preview: string }) {
    if (!isMongoId(callId)) return null;
    const row = await this.messages.findOne({ callId: oid(callId), type: 'call' }).exec();
    if (!row) return null;
    row.text = input.label;
    row.callMeta = { kind: 'call', missed: input.missed, label: input.label, meta: input.meta, callId };
    await row.save();
    await this.conversations.bumpPreview(String(row.conversation), {
      preview: input.preview,
      lastMessageAt: new Date(),
      senderId: row.sender ? String(row.sender) : null,
    });
    return this.touch(row, row.sender ? String(row.sender) : '');
  }

  async toggleReaction(viewer: AuthViewer, messageId: string, emoji: string) {
    const value = emoji.trim();
    if (!value || value.length > 8 || /[<>]/.test(value)) throw new BadRequestException({ error: 'Pick a valid emoji' });
    const row = await this.load(viewer, messageId);
    const existing = row.reactions.find((r) => r.emoji === value);
    if (existing) {
      const i = existing.users.findIndex((u) => String(u) === viewer.id);
      if (i >= 0) existing.users.splice(i, 1);
      else existing.users.push(oid(viewer.id));
      row.reactions = row.reactions.filter((r) => r.users.length > 0);
    } else {
      row.reactions.push({ emoji: value, users: [oid(viewer.id)] });
    }
    row.markModified('reactions');
    await row.save();
    return this.touch(row, viewer.id);
  }

  async togglePin(viewer: AuthViewer, messageId: string) {
    const row = await this.load(viewer, messageId);
    row.pinned = !row.pinned;
    row.pinnedBy = row.pinned ? oid(viewer.id) : null;
    row.pinnedAt = row.pinned ? new Date() : null;
    await row.save();
    return { ...(await this.touch(row, viewer.id)), pinned: row.pinned };
  }

  async remove(viewer: AuthViewer, messageId: string, scope: DeleteScope = 'me') {
    const row = await this.load(viewer, messageId, true);
    const conversation = await this.conversations.assertMember(viewer.id, String(row.conversation));
    if (scope === 'everyone') {
      const mine = row.sender && String(row.sender) === viewer.id;
      if (!mine && !this.conversations.isGroupAdmin(conversation, viewer.id)) {
        throw new ForbiddenException({ error: 'You can only delete this for yourself' });
      }
      row.deletedAt = new Date();
      row.deletedBy = oid(viewer.id);
      await row.save();
      if (row.media?.publicId) {
        await this.cloudinary.deleteAsset(row.media.publicId, row.type === 'image' ? 'image' : row.type === 'file' ? 'raw' : 'video');
      }
      this.live?.emitDeleted(row.id, String(row.conversation), 'everyone');
      return { ok: true as const };
    }
    if (!row.deletedFor.some((id) => String(id) === viewer.id)) {
      row.deletedFor.push(oid(viewer.id));
      await row.save();
    }
    this.live?.emitDeleted(row.id, String(row.conversation), 'me', viewer.id);
    return { ok: true as const };
  }

  async mark(viewer: AuthViewer, conversationId: string, status: 'delivered' | 'seen', messageId?: string) {
    await this.conversations.assertMember(viewer.id, conversationId);
    const filter: Record<string, unknown> = {
      conversation: oid(conversationId),
      sender: { $ne: oid(viewer.id) },
      deletedAt: null,
      deletedFor: { $ne: oid(viewer.id) },
    };
    if (messageId) {
      if (!isMongoId(messageId)) throw new BadRequestException({ error: 'Message not found' });
      filter._id = oid(messageId);
    }
    const target = rank(status);
    let updated = 0;
    for (const row of await this.messages.find(filter).limit(500).exec()) {
      const mine = row.receipts.find((r) => String(r.user) === viewer.id);
      if (mine && rank(mine.status) >= target) continue;
      if (mine) {
        mine.status = status;
        mine.at = new Date();
      } else {
        row.receipts.push({ user: oid(viewer.id), status, at: new Date() });
      }
      row.markModified('receipts');
      await row.save();
      updated += 1;
      this.live?.emitReceipts(
        conversationId,
        row.id,
        row.receipts.map((r) => ({ userId: String(r.user), status: r.status as ReceiptStatus, at: (r.at ?? new Date()).toISOString() })),
      );
    }
    if (status === 'seen') await this.conversations.resetUnread(conversationId, viewer.id);
    return { ok: true as const, updated };
  }

  private async persist(
    viewer: AuthViewer,
    conversationId: string,
    input: { type: MessageType; text?: string; caption?: string; replyTo?: string; media?: MessageDocument['media'] },
  ) {
    const user = await this.users.findActiveById(viewer.id);
    if (!user) throw new ForbiddenException({ error: 'Your account cannot send messages' });
    const conversation = await this.conversations.assertMember(viewer.id, conversationId);
    if (conversation.type === 'direct') {
      const other = this.conversations.activeMemberIds(conversation).find((id) => id !== viewer.id);
      if (other) await this.blocks?.assertNotBlocked(viewer.id, other);
    }
    try {
      if (await this.redis.tooMany(`rl:msg:${viewer.id}:${conversationId}`, 30, 10)) {
        throw new BadRequestException({ error: 'You are sending messages too quickly' });
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
    }
    let replyTo: Types.ObjectId | null = null;
    if (input.replyTo) {
      if (!isMongoId(input.replyTo)) throw new BadRequestException({ error: 'Reply to a valid message' });
      const reply = await this.messages.findById(input.replyTo).exec();
      if (!reply || String(reply.conversation) !== conversationId) {
        throw new BadRequestException({ error: 'That message is not in this chat' });
      }
      replyTo = reply._id;
    }
    const row = await this.messages.create({
      conversation: oid(conversationId),
      sender: oid(viewer.id),
      type: input.type,
      text: input.text ?? '',
      caption: input.caption ?? '',
      media: input.media ?? {},
      replyTo,
      receipts: [{ user: oid(viewer.id), status: 'sent', at: new Date() }],
    });
    const preview = label(input.type, input.caption || input.text || '', row.media?.fileName, row.media?.duration, user.name, conversation.type === 'group');
    const bumped = await this.conversations.bumpFromMessage(conversationId, {
      senderId: viewer.id,
      preview,
      previewIcon: icon(input.type),
      messageId: row.id,
    });
    const live = bumped ?? conversation;
    const message = await this.mapOne(row, live, await this.people([row], live));
    const conversationKey = String(live.id ?? live._id);
    this.live?.emitNew(
      conversationKey,
      message,
      this.conversations.activeMemberIds(live).map((userId) => ({
        userId,
        conversationId: conversationKey,
        preview: viewerPreview(preview, message.senderId, userId),
        previewIcon: icon(message.type),
        lastMessageAt: (live.lastMessageAt ?? new Date()).toISOString(),
        unread: this.conversations.unreadOf(live, userId),
      })),
    );
    return toViewerDto(message, viewer.id);
  }

  private async upload(dto: SendMessageDto, file?: UploadedChatFile) {
    const rule = dto.type in MEDIA ? MEDIA[dto.type as keyof typeof MEDIA] : null;
    if (!rule) throw new BadRequestException({ error: 'Pick a valid attachment type' });
    if (!file?.buffer?.length) throw new BadRequestException({ error: 'Attach a file to send' });
    if (file.size > rule.max || file.size > FILE_MAX) throw new BadRequestException({ error: rule.error });
    if (rule.mime && !rule.mime.includes(file.mimetype)) throw new BadRequestException({ error: rule.error });
    const uploaded = await this.cloudinary.uploadFile(file.buffer, {
      folder: rule.folder,
      resourceType: rule.resource,
      fileName: dto.type === 'file' ? fileName(file.originalname) : undefined,
    });
    return {
      url: uploaded.url,
      publicId: uploaded.publicId,
      fileName: fileName(file.originalname),
      fileSize: fileSize(file.size || uploaded.bytes),
      mimeType: file.mimetype,
      duration: dto.duration && dto.duration > 0 ? dto.duration : uploaded.duration,
      seed: 0,
      width: uploaded.width,
      height: uploaded.height,
    };
  }

  private async touch(row: MessageDocument, viewerId: string) {
    const conversation = await this.conversations.getById(String(row.conversation));
    if (!conversation) throw new NotFoundException({ error: 'Conversation not found' });
    const message = await this.mapOne(row, conversation, await this.people([row], conversation));
    this.live?.emitUpdated(message);
    return { message: toViewerDto(message, viewerId) };
  }

  private async load(viewer: AuthViewer, messageId: string, allowDeletedForMe = false) {
    if (!isMongoId(messageId)) throw new NotFoundException({ error: 'Message not found' });
    const row = await this.messages.findById(messageId).exec();
    if (!row || row.deletedAt) throw new NotFoundException({ error: 'Message not found' });
    if (!allowDeletedForMe && row.deletedFor.some((id) => String(id) === viewer.id)) {
      throw new NotFoundException({ error: 'Message not found' });
    }
    await this.conversations.assertMember(viewer.id, String(row.conversation));
    return row;
  }

  private async mapMany(rows: MessageDocument[], conversation: ConversationDocument, viewerId: string) {
    const replyIds = rows.map((r) => r.replyTo).filter((id): id is Types.ObjectId => Boolean(id));
    const replies = replyIds.length
      ? new Map((await this.messages.find({ _id: { $in: replyIds } }).exec()).map((r) => [r.id, r]))
      : new Map<string, MessageDocument>();
    const extra = [...replies.values()].map((r) => (r.sender ? String(r.sender) : ''));
    const people = await this.people(rows, conversation, extra);
    return Promise.all(rows.map((row) => this.mapOne(row, conversation, people, replies, viewerId)));
  }

  private async people(rows: MessageDocument[], conversation: ConversationDocument, extra: string[] = []) {
    const ids = new Set([...this.conversations.activeMemberIds(conversation), ...extra]);
    for (const row of rows) {
      if (row.sender) ids.add(String(row.sender));
      for (const reaction of row.reactions) for (const user of reaction.users) ids.add(String(user));
    }
    const docs = await this.users.findByIds([...ids].filter((id) => isMongoId(id)));
    return new Map(docs.map((doc) => [doc.id, doc]));
  }

  private async mapOne(
    row: MessageDocument,
    conversation: ConversationDocument,
    people: Map<string, UserDocument>,
    replies?: Map<string, MessageDocument>,
    viewerId?: string,
  ): Promise<CanonicalMessage> {
    const senderId = row.sender ? String(row.sender) : null;
    const sender = senderId ? people.get(senderId) : undefined;
    const reply = row.replyTo
      ? replies?.get(String(row.replyTo)) ?? (await this.messages.findById(row.replyTo).exec())
      : null;
    const who = reply?.sender ? people.get(String(reply.sender)) : undefined;
    return {
      id: row.id,
      conversationId: String(row.conversation),
      kind: row.type === 'call' ? 'call' : 'message',
      senderId,
      type: row.type as MessageType,
      missed: row.callMeta?.missed,
      label: row.callMeta?.label ?? (row.type === 'call' ? row.text : undefined),
      meta: row.callMeta?.meta,
      callId: row.callId ? String(row.callId) : undefined,
      text: row.text ?? '',
      caption: row.caption ?? '',
      fileName: row.media?.fileName ?? '',
      fileSize: row.media?.fileSize ?? '',
      duration: row.media?.duration ?? 0,
      seed: row.media?.seed ?? 0,
      mediaUrl: row.media?.url ?? '',
      time: (row.createdAt ?? new Date()).toISOString(),
      status: ticks(row.receipts, senderId, this.conversations.activeMemberIds(conversation)),
      sender: sender
        ? { id: sender.id, name: sender.name, username: sender.username, initials: sender.initials, tone: sender.tone, photoUrl: sender.photoUrl ?? null }
        : null,
      senderName: sender?.name ?? (row.type === 'system' ? 'ChatWave' : 'ChatWave user'),
      senderTone: sender?.tone ?? 'e',
      senderInitials: sender?.initials ?? 'CW',
      reply: reply
        ? { id: reply.id, who: who?.name ?? 'ChatWave user', text: snippet(reply.type, reply.caption || reply.text, reply.media?.fileName, reply.media?.duration) }
        : null,
      reactions: (row.reactions ?? []).map((r) => {
        const userIds = r.users.map((u) => String(u));
        return { emoji: r.emoji, count: userIds.length, mine: viewerId ? userIds.includes(viewerId) : false, userIds };
      }),
      pinned: Boolean(row.pinned),
    };
  }
}

function oid(id: string) {
  return new Types.ObjectId(id);
}

function rank(status: string) {
  return status === 'seen' ? 2 : status === 'delivered' ? 1 : 0;
}

function ticks(
  receipts: Array<{ user: { toString(): string } | string; status: string }>,
  senderId: string | null,
  members: string[],
): ReceiptStatus | null {
  if (!senderId) return null;
  const others = members.filter((id) => id !== senderId);
  if (!others.length) return 'sent';
  const min = Math.min(...others.map((id) => rank(receipts.find((r) => String(r.user) === id)?.status ?? 'sent')));
  return min >= 2 ? 'seen' : min >= 1 ? 'delivered' : 'sent';
}

function duration(seconds = 0) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function snippet(type: string, text: string, fileName?: string, seconds?: number) {
  if (type === 'call') return text || 'Call';
  if (type === 'voice') return `Voice message · ${duration(seconds)}`;
  if (type === 'video_note') return `Video note · ${duration(seconds)}`;
  if (type === 'image') return 'Photo';
  if (type === 'file') return fileName || 'File';
  const value = (text || 'Message').replace(/\s+/g, ' ').trim();
  return value.length > 80 ? `${value.slice(0, 79)}…` : value;
}

function label(type: string, text: string, fileName: string | undefined, seconds: number | undefined, senderName: string, group: boolean) {
  const value = snippet(type, text, fileName, seconds);
  return type === 'system' || !group ? value : `${senderName}: ${value}`;
}

function icon(type: string): PreviewIcon | null {
  return type === 'voice' ? 'mic' : type === 'video_note' ? 'video' : type === 'image' ? 'image' : null;
}

function fileName(name?: string) {
  const base = (name ?? 'file').split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180) || 'file';
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
