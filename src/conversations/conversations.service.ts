import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';

import { BlocksService } from '../blocks/blocks.service';
import { CHAT_REALTIME } from '../blocks/blocks.constants';
import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { Message, MessageDocument } from '../messages/message.schema';
import {
  initialsFromName,
  PHOTO_MAX,
  PHOTO_MIME,
  type AuthViewer,
  type PublicUser,
  type UploadedPhoto,
} from '../users/users.constants';
import { UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import {
  MIN_GROUP_MEMBERS,
  pairKey,
  toneFromName,
  viewerPreview,
  type ConversationDetail,
  type ConversationListItem,
  type ListFilter,
  type MemberRole,
  type PreviewIcon,
} from './conversations.constants';
import { UpdateConversationDto, UpdateMembershipDto } from './conversations.dto';
import { Conversation, ConversationDocument, ConversationMember } from './conversation.schema';

type ChatRealtime = {
  emitConversationRemoved(userId: string, conversationId: string): void;
};

@Injectable()
export class ConversationsService {
  constructor(
    @InjectModel(Conversation.name) private readonly conversations: Model<ConversationDocument>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDocument>,
    private readonly users: UsersService,
    private readonly moduleRef: ModuleRef,
    private readonly cloudinary: CloudinaryService,
    @Optional() @Inject(forwardRef(() => BlocksService)) private readonly blocks?: BlocksService,
  ) {}

  async list(viewer: AuthViewer, filter: ListFilter = 'all', q?: string, limit = 50) {
    if (filter === 'calls') return { conversations: [] as ConversationListItem[] };
    const take = Math.min(Math.max(limit || 50, 1), 100);
    const rows = await this.conversations
      .find({ 'members.user': new Types.ObjectId(viewer.id) })
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .exec();
    const skip = await this.blocks?.restrictedIds(viewer.id);
    const people = await this.peopleMap(rows, viewer);
    const query = q?.trim().toLowerCase();
    const items: ConversationListItem[] = [];
    for (const row of rows) {
      const mine = activeMember(row, viewer.id);
      if (!mine) continue;
      if (filter === 'archived' ? !mine.archived : mine.archived) continue;
      if (filter === 'unread' && mine.unreadCount <= 0) continue;
      if (filter === 'groups' && row.type !== 'group') continue;
      // Keep blocked people out of the main list, but still show them under Archived.
      if (row.type === 'direct' && skip && filter !== 'archived') {
        const other = row.members.find((m) => !m.leftAt && String(m.user) !== viewer.id);
        if (other && skip.has(String(other.user))) continue;
      }
      const item = await this.toListItem(viewer, row, mine, people);
      if (query && !`${item.name} ${item.preview}`.toLowerCase().includes(query)) continue;
      items.push(item);
    }
    items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.time) - Date.parse(a.time));
    return { conversations: items.slice(0, take) };
  }

  async getOne(viewer: AuthViewer, id: string) {
    return { conversation: await this.toDetail(viewer, await this.requireMember(viewer.id, id)) };
  }

  async getOrCreateDirect(viewer: AuthViewer, otherId: string) {
    return this.createDirect(viewer, otherId);
  }

  async directIdsFor(ownerId: string, peerIds: string[]) {
    const map = new Map<string, string>();
    const keys = [...new Set(peerIds)].filter((id) => id !== ownerId && isMongoId(id)).map((id) => pairKey(ownerId, id));
    if (keys.length === 0) return map;
    const rows = await this.conversations.find({ type: 'direct', pairKey: { $in: keys } }).exec();
    for (const row of rows) {
      const other = row.members.find((member) => String(member.user) !== ownerId);
      if (other) map.set(String(other.user), row.id);
    }
    return map;
  }

  async listDirectPeerIds(userId: string) {
    const rows = await this.conversations
      .find({ type: 'direct', 'members.user': new Types.ObjectId(userId) })
      .exec();
    const ids: string[] = [];
    for (const row of rows) {
      if (!activeMember(row, userId)) continue;
      for (const member of row.members) {
        if (!member.leftAt && String(member.user) !== userId) ids.push(String(member.user));
      }
    }
    return [...new Set(ids)];
  }

  async hideDirectIfEmpty(userId: string, peerId: string) {
    if (!isMongoId(userId) || !isMongoId(peerId)) return false;
    const row = await this.conversations.findOne({ type: 'direct', pairKey: pairKey(userId, peerId) }).exec();
    if (!row || row.lastMessage) return false;
    const mine = activeMember(row, userId);
    if (!mine) return false;
    mine.leftAt = new Date();
    await row.save();
    return true;
  }

  async hideForViewer(viewer: AuthViewer, id: string) {
    const { row, mine } = await this.requireMine(viewer.id, id);
    mine.leftAt = new Date();
    await row.save();
    const peerId =
      row.type === 'direct'
        ? row.members.map((member) => String(member.user)).find((userId) => userId !== viewer.id)
        : undefined;
    return { ok: true as const, peerId };
  }

  /** Move a direct chat to Archived for the blocker after a block. */
  async archiveDirectBetween(blockerId: string, blockedId: string) {
    if (!isMongoId(blockerId) || !isMongoId(blockedId)) return;
    const row = await this.conversations.findOne({ type: 'direct', pairKey: pairKey(blockerId, blockedId) }).exec();
    if (!row) return;
    const mine = activeMember(row, blockerId);
    if (!mine) return;
    mine.archived = true;
    await row.save();
  }

  /**
   * Direct chats: permanently delete the conversation and all messages for everyone.
   * Groups: hide only for the viewer (leave), same as before.
   */
  async deleteConversation(viewer: AuthViewer, id: string) {
    const { row } = await this.requireMine(viewer.id, id);
    if (row.type !== 'direct') {
      return this.hideForViewer(viewer, id);
    }

    const conversationId = String(row._id);
    const memberIds = row.members.map((member) => String(member.user));
    const peerId = memberIds.find((userId) => userId !== viewer.id);

    await this.messages.deleteMany({ conversation: row._id }).exec();
    await this.conversations.deleteOne({ _id: row._id }).exec();

    const realtime = this.pickRealtime();
    for (const userId of memberIds) {
      try {
        realtime?.emitConversationRemoved(userId, conversationId);
      } catch {
        /* best-effort */
      }
    }

    return { ok: true as const, peerId };
  }

  private pickRealtime() {
    try {
      return this.moduleRef.get<ChatRealtime>(CHAT_REALTIME, { strict: false });
    } catch {
      return undefined;
    }
  }

  async createDirect(viewer: AuthViewer, otherId: string) {
    if (otherId === viewer.id) throw new BadRequestException({ error: 'You cannot start a chat with yourself' });
    await this.blocks?.assertNotBlocked(viewer.id, otherId);
    if (!isMongoId(otherId) || !(await this.users.findActiveById(otherId))) {
      throw new BadRequestException({ error: 'That person is not available' });
    }
    const key = pairKey(viewer.id, otherId);
    const existing = await this.conversations.findOne({ type: 'direct', pairKey: key }).exec();
    if (existing) {
      this.ensureDirectMembers(existing, viewer.id, otherId);
      await existing.save();
      return { created: false, conversation: await this.toDetail(viewer, existing) };
    }
    const now = new Date();
    try {
      const row = await this.conversations.create({
        type: 'direct',
        name: '',
        createdBy: new Types.ObjectId(viewer.id),
        pairKey: key,
        members: [memberDoc(viewer.id, 'member', now), memberDoc(otherId, 'member', now)],
        lastMessageAt: now,
      });
      return { created: true, conversation: await this.toDetail(viewer, row) };
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const row = await this.conversations.findOne({ type: 'direct', pairKey: key }).exec();
      if (!row) throw error;
      return { created: false, conversation: await this.toDetail(viewer, row) };
    }
  }

  async createGroup(viewer: AuthViewer, name: string, memberIds: string[]) {
    const others = [...new Set(memberIds)].filter((id) => id !== viewer.id);
    if (others.length < MIN_GROUP_MEMBERS) {
      throw new BadRequestException({ error: 'Add at least 3 other people' });
    }
    if (others.some((id) => !isMongoId(id))) throw new BadRequestException({ error: 'Pick valid people' });
    const people = await this.users.findByIds(others);
    if (people.length !== others.length || people.some((p) => p.status !== 'active' || p.deletedAt)) {
      throw new BadRequestException({ error: 'Someone in this group is not available' });
    }
    const now = new Date();
    const trimmed = name.trim();
    const row = await this.conversations.create({
      type: 'group',
      name: trimmed,
      initials: initialsFromName(trimmed),
      tone: toneFromName(trimmed),
      createdBy: new Types.ObjectId(viewer.id),
      members: [memberDoc(viewer.id, 'admin', now), ...others.map((id) => memberDoc(id, 'member', now))],
      lastMessageAt: now,
      preview: 'You created this group',
    });
    return { conversation: await this.toDetail(viewer, row) };
  }

  async updateGroup(viewer: AuthViewer, id: string, dto: UpdateConversationDto) {
    const row = await this.requireMember(viewer.id, id);
    if (row.type !== 'group') throw new BadRequestException({ error: 'You can only rename a group' });
    // Any active member can update group name / tone / photo.
    if (dto.name) {
      row.name = dto.name;
      row.initials = initialsFromName(dto.name);
    }
    if (dto.tone) row.tone = dto.tone;
    await row.save();
    this.notifyGroupUpdated(row.id);
    return { conversation: await this.toDetail(viewer, row) };
  }

  async updateGroupPhoto(viewer: AuthViewer, id: string, file: UploadedPhoto) {
    const row = await this.requireMember(viewer.id, id);
    if (row.type !== 'group') throw new BadRequestException({ error: 'You can only update a group photo' });
    if (!file.buffer?.length) throw new BadRequestException({ error: 'Choose a photo to upload' });
    if (!PHOTO_MIME.includes(file.mimetype as (typeof PHOTO_MIME)[number])) {
      throw new BadRequestException({ error: 'Use a JPEG, PNG, or WebP image' });
    }
    if (file.size > PHOTO_MAX) throw new BadRequestException({ error: 'Keep the photo under 2 MB' });

    const uploaded = await this.cloudinary.uploadAvatar(file.buffer);
    const previous = row.photoPublicId;
    row.photo = uploaded.url;
    row.photoPublicId = uploaded.publicId;
    await row.save();
    if (previous) {
      try {
        await this.cloudinary.deleteAsset(previous);
      } catch {
        /* best-effort cleanup */
      }
    }
    this.notifyGroupUpdated(row.id);
    return { conversation: await this.toDetail(viewer, row) };
  }

  async deleteGroupPhoto(viewer: AuthViewer, id: string) {
    const row = await this.requireMember(viewer.id, id);
    if (row.type !== 'group') throw new BadRequestException({ error: 'You can only update a group photo' });
    if (row.photoPublicId) {
      try {
        await this.cloudinary.deleteAsset(row.photoPublicId);
      } catch {
        /* best-effort cleanup */
      }
    }
    row.photo = null;
    row.photoPublicId = null;
    await row.save();
    this.notifyGroupUpdated(row.id);
    return { conversation: await this.toDetail(viewer, row) };
  }

  private notifyGroupUpdated(conversationId: string) {
    try {
      const realtime = this.moduleRef.get<{ emitGroupUpdated?(id: string, payload: unknown): void }>(
        CHAT_REALTIME,
        { strict: false },
      );
      realtime?.emitGroupUpdated?.(conversationId, {
        conversationId,
        members: [],
        status: '',
        sub: '',
      });
    } catch {
      /* best-effort */
    }
  }

  async updateMembership(viewer: AuthViewer, id: string, dto: UpdateMembershipDto) {
    const { row, mine } = await this.requireMine(viewer.id, id);
    if (dto.pinned !== undefined) mine.pinned = dto.pinned;
    if (dto.muted !== undefined) mine.muted = dto.muted;
    if (dto.archived !== undefined) mine.archived = dto.archived;
    await row.save();
    return { conversation: await this.toDetail(viewer, row) };
  }

  async markRead(viewer: AuthViewer, id: string) {
    const { row, mine } = await this.requireMine(viewer.id, id);
    mine.unreadCount = 0;
    mine.lastReadAt = new Date();
    await row.save();
    return { conversation: await this.toDetail(viewer, row) };
  }

  async bumpFromMessage(
    conversationId: string,
    input: { senderId: string; preview: string; previewIcon?: PreviewIcon | null; messageId: string },
  ) {
    const row = await this.conversations.findById(conversationId).exec();
    if (!row) return null;
    this.applyPreview(row, {
      preview: input.preview,
      previewIcon: input.previewIcon ?? null,
      lastMessage: input.messageId,
      lastMessageAt: new Date(),
      senderId: input.senderId,
    });
    this.applyUnreadIncrement(row, input.senderId);
    await row.save();
    return row;
  }

  async bumpPreview(
    conversationId: string,
    input: {
      preview: string;
      previewIcon?: PreviewIcon | null;
      lastMessage?: string | null;
      lastMessageAt?: Date;
      senderId?: string | null;
    },
  ) {
    const row = await this.conversations.findById(conversationId).exec();
    if (!row) return null;
    this.applyPreview(row, input);
    await row.save();
    return row;
  }

  async incrementUnread(conversationId: string, exceptUserId: string) {
    const row = await this.conversations.findById(conversationId).exec();
    if (!row) return null;
    this.applyUnreadIncrement(row, exceptUserId);
    await row.save();
    return row;
  }

  async resetUnread(conversationId: string, userId: string) {
    const row = await this.conversations.findById(conversationId).exec();
    if (!row) return null;
    const mine = activeMember(row, userId);
    if (!mine) return null;
    mine.unreadCount = 0;
    mine.lastReadAt = new Date();
    await row.save();
    return row;
  }

  async assertMember(userId: string, conversationId: string) {
    if (!isMongoId(conversationId)) {
      throw new ForbiddenException({ error: 'You cannot access this chat' });
    }
    const row = await this.conversations.findById(conversationId).exec();
    if (!row || !activeMember(row, userId)) {
      throw new ForbiddenException({ error: 'You cannot access this chat' });
    }
    return row;
  }

  memberRole(row: ConversationDocument, userId: string): MemberRole | null {
    const role = activeMember(row, userId)?.role;
    return role === 'admin' || role === 'member' ? role : null;
  }

  activeMemberIds(row: ConversationDocument) {
    return row.members.filter((member) => !member.leftAt).map((member) => String(member.user));
  }

  unreadOf(row: ConversationDocument, userId: string) {
    return activeMember(row, userId)?.unreadCount ?? 0;
  }

  async getById(conversationId: string) {
    if (!isMongoId(conversationId)) return null;
    return this.conversations.findById(conversationId).exec();
  }

  isGroupAdmin(row: ConversationDocument, userId: string) {
    return row.type === 'group' && activeMember(row, userId)?.role === 'admin';
  }

  private applyPreview(
    row: ConversationDocument,
    input: {
      preview: string;
      previewIcon?: PreviewIcon | null;
      lastMessage?: string | null;
      lastMessageAt?: Date;
      senderId?: string | null;
    },
  ) {
    row.preview = input.preview;
    if (input.previewIcon !== undefined) row.previewIcon = input.previewIcon ?? null;
    if (input.lastMessage) row.lastMessage = new Types.ObjectId(input.lastMessage);
    if (input.lastMessageAt) row.lastMessageAt = input.lastMessageAt;
    if (input.senderId !== undefined) {
      row.lastMessageSender = input.senderId ? new Types.ObjectId(input.senderId) : null;
    }
  }

  private applyUnreadIncrement(row: ConversationDocument, exceptUserId: string) {
    for (const member of row.members) {
      if (!member.leftAt && String(member.user) !== exceptUserId) member.unreadCount += 1;
    }
  }

  private async requireMember(userId: string, id: string) {
    if (!isMongoId(id)) throw new NotFoundException({ error: 'Conversation not found' });
    const row = await this.conversations.findById(id).exec();
    if (!row || !activeMember(row, userId)) throw new NotFoundException({ error: 'Conversation not found' });
    return row;
  }

  private async requireMine(userId: string, id: string) {
    const row = await this.requireMember(userId, id);
    const mine = activeMember(row, userId);
    if (!mine) throw new NotFoundException({ error: 'Conversation not found' });
    return { row, mine };
  }

  private ensureDirectMembers(row: ConversationDocument, a: string, b: string) {
    for (const id of [a, b]) {
      const member = row.members.find((m) => String(m.user) === id);
      if (member) {
        member.leftAt = null;
        member.removedBy = null;
      } else {
        row.members.push(memberDoc(id, 'member', new Date()));
      }
    }
  }

  private async peopleMap(rows: ConversationDocument[], viewer: AuthViewer) {
    const ids = new Set<string>([viewer.id]);
    for (const row of rows) {
      for (const member of row.members) {
        if (!member.leftAt) ids.add(String(member.user));
      }
    }
    const docs = await this.users.findByIds([...ids]);
    return new Map(docs.map((doc) => [doc.id, doc]));
  }

  async assertGroup(conversationId: string) {
    if (!isMongoId(conversationId)) throw new NotFoundException({ error: 'Conversation not found' });
    const row = await this.conversations.findById(conversationId).exec();
    if (!row) throw new NotFoundException({ error: 'Conversation not found' });
    if (row.type !== 'group') throw new BadRequestException({ error: 'This is not a group' });
    return row;
  }

  async assertActiveMember(conversationId: string, userId: string) {
    const row = await this.assertGroup(conversationId);
    if (!activeMember(row, userId)) throw new NotFoundException({ error: 'Conversation not found' });
    return row;
  }

  async assertGroupAdmin(conversationId: string, userId: string, error: string) {
    const row = await this.assertActiveMember(conversationId, userId);
    if (activeMember(row, userId)?.role !== 'admin') throw new ForbiddenException({ error });
    return row;
  }

  getActiveMembers(row: ConversationDocument) {
    return row.members.filter((member) => !member.leftAt);
  }

  adminCount(row: ConversationDocument) {
    return this.getActiveMembers(row).filter((member) => member.role === 'admin').length;
  }

  setMemberRole(row: ConversationDocument, userId: string, role: MemberRole) {
    const member = activeMember(row, userId);
    if (!member) throw new BadRequestException({ error: 'That person is not in this group' });
    member.role = role;
  }

  markMemberLeft(row: ConversationDocument, userId: string, removedBy: string | null) {
    const member = activeMember(row, userId);
    if (!member) throw new BadRequestException({ error: 'That person is not in this group' });
    member.leftAt = new Date();
    member.removedBy = removedBy ? new Types.ObjectId(removedBy) : null;
  }

  addMembers(row: ConversationDocument, userIds: string[]) {
    const now = new Date();
    const added: string[] = [];
    for (const id of userIds) {
      if (activeMember(row, id)) continue;
      const existing = row.members.find((member) => String(member.user) === id);
      if (existing) {
        existing.leftAt = null;
        existing.removedBy = null;
        existing.role = 'member';
        existing.joinedAt = now;
        existing.unreadCount = 0;
      } else {
        row.members.push(memberDoc(id, 'member', now));
      }
      added.push(id);
    }
    return added;
  }

  longestTenuredMember(row: ConversationDocument, exceptUserId?: string) {
    const remaining = this.getActiveMembers(row).filter((member) => String(member.user) !== exceptUserId);
    if (remaining.length === 0) return null;
    return [...remaining].sort((a, b) => +new Date(a.joinedAt) - +new Date(b.joinedAt))[0] ?? null;
  }

  async groupMembers(viewer: AuthViewer, row: ConversationDocument) {
    const people = await this.peopleMap([row], viewer);
    const members: ConversationDetail['members'] = [];
    for (const member of this.getActiveMembers(row)) {
      const peer = await this.peerView(viewer, String(member.user), people);
      members.push({
        id: peer.id,
        name: peer.name,
        username: peer.username,
        initials: peer.initials,
        tone: peer.tone,
        photoUrl: peer.photoUrl,
        presence: peer.presence,
        role: member.role === 'admin' ? 'admin' : 'member',
        isMe: peer.id === viewer.id,
      });
    }
    members.sort(
      (a, b) => Number(b.isMe) - Number(a.isMe) || Number(b.role === 'admin') - Number(a.role === 'admin') || a.name.localeCompare(b.name),
    );
    return members;
  }

  async groupHeadline(viewer: AuthViewer, row: ConversationDocument) {
    const mine = activeMember(row, viewer.id);
    const people = await this.peopleMap([row], viewer);
    if (!mine) {
      const active = this.getActiveMembers(row);
      return { status: `${active.length} members`, sub: `${active.length} members` };
    }
    const item = await this.toListItem(viewer, row, mine, people);
    return { status: item.status, sub: item.sub };
  }

  async toDetail(viewer: AuthViewer, row: ConversationDocument): Promise<ConversationDetail> {
    const people = await this.peopleMap([row], viewer);
    const mine = activeMember(row, viewer.id);
    if (!mine) throw new NotFoundException({ error: 'Conversation not found' });
    const members: ConversationDetail['members'] = [];
    for (const member of row.members) {
      if (member.leftAt) continue;
      const peer = await this.peerView(viewer, String(member.user), people);
      members.push({
        id: peer.id,
        name: peer.name,
        username: peer.username,
        initials: peer.initials,
        tone: peer.tone,
        photoUrl: peer.photoUrl,
        presence: peer.presence,
        role: member.role === 'admin' ? ('admin' as const) : ('member' as const),
        isMe: peer.id === viewer.id,
      });
    }
    return {
      ...(await this.toListItem(viewer, row, mine, people)),
      createdBy: String(row.createdBy),
      members,
      messages: [],
    };
  }

  private async toListItem(
    viewer: AuthViewer,
    row: ConversationDocument,
    mine: ConversationMember,
    people: Map<string, UserDocument>,
  ): Promise<ConversationListItem> {
    const active = row.members.filter((m) => !m.leftAt);
    const base = {
      id: row.id,
      unread: mine.unreadCount ?? 0,
      pinned: Boolean(mine.pinned),
      muted: Boolean(mine.muted),
      archived: Boolean(mine.archived),
      preview: viewerPreview(
        row.preview ?? '',
        row.lastMessageSender ? String(row.lastMessageSender) : null,
        viewer.id,
      ),
      previewIcon: (row.previewIcon as PreviewIcon | null) ?? null,
      live: false,
      time: (row.lastMessageAt ?? row.createdAt ?? new Date()).toISOString(),
    };

    if (row.type === 'direct') {
      const otherId = active.map((m) => String(m.user)).find((id) => id !== viewer.id) ?? viewer.id;
      const peer = await this.peerView(viewer, otherId, people);
      const status = peer.presence === 'online' ? 'Online' : peer.presence === 'away' ? 'Away' : 'Offline';
      return {
        ...base,
        type: 'direct',
        group: false,
        name: peer.name,
        username: peer.username,
        initials: peer.initials,
        tone: peer.tone,
        photoUrl: peer.photoUrl,
        presence: peer.presence,
        status,
        sub: peer.sub ? `@${peer.username} · ${peer.sub}` : `@${peer.username}`,
      };
    }

    const online = (
      await Promise.all(active.map((m) => this.peerView(viewer, String(m.user), people)))
    ).filter((p) => p.presence === 'online' || p.presence === 'away').length;
    return {
      ...base,
      type: 'group',
      group: true,
      name: row.name,
      username: null,
      initials: row.initials || initialsFromName(row.name),
      tone: row.tone || 'e',
      photoUrl: row.photo ?? null,
      presence: 'offline',
      status: `${active.length} members · ${online} online`,
      sub: `${active.length} members`,
    };
  }

  private async peerView(viewer: AuthViewer, userId: string, people: Map<string, UserDocument>) {
    const doc = people.get(userId);
    if (doc) return this.users.publicUser(viewer, doc);
    return {
      id: userId,
      name: 'ChatWave user',
      username: 'user',
      initials: 'CW',
      tone: 'a',
      photoUrl: null,
      role: '',
      location: '',
      presence: 'offline',
      lastSeenAt: null,
      sub: '',
    } satisfies PublicUser;
  }
}

function activeMember(row: ConversationDocument, userId: string) {
  return row.members.find((m) => String(m.user) === userId && !m.leftAt);
}

function memberDoc(userId: string, role: 'admin' | 'member', now: Date): ConversationMember {
  return {
    user: new Types.ObjectId(userId),
    role,
    pinned: false,
    muted: false,
    archived: false,
    unreadCount: 0,
    lastReadAt: null,
    lastReadMessage: null,
    joinedAt: now,
    leftAt: null,
    removedBy: null,
  };
}

function isMongoId(id: string) {
  return isValidObjectId(id) && String(new Types.ObjectId(id)) === id;
}

function isDuplicate(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
