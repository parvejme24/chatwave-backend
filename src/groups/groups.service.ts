import { BadRequestException, Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';

import { EventEmitter2 } from '@nestjs/event-emitter';

import { BlocksService } from '../blocks/blocks.service';
import { ConversationDocument } from '../conversations/conversation.schema';
import { ConversationsService } from '../conversations/conversations.service';
import { ChatGateway } from '../messages/messages.gateway';
import { MessagesService } from '../messages/messages.service';
import { EVENT_GROUP_MEMBER_ADDED } from '../notifications/notifications.constants';
import type { AuthViewer } from '../users/users.constants';
import { UsersService } from '../users/users.service';
import { ADMIN_ACTION_ERROR, ADMIN_REMOVE_ERROR, LAST_ADMIN_ERROR, LEAVE_INSTEAD } from './groups.constants';

@Injectable()
export class GroupsService {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly users: UsersService,
    private readonly messages: MessagesService,
    private readonly realtime: ChatGateway,
    @Optional() @Inject(forwardRef(() => BlocksService)) private readonly blocks?: BlocksService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async listMembers(viewer: AuthViewer, id: string) {
    const row = await this.conversations.assertActiveMember(id, viewer.id);
    return { members: await this.conversations.groupMembers(viewer, row) };
  }

  async addMembers(viewer: AuthViewer, id: string, userIds: string[]) {
    const row = await this.conversations.assertGroupAdmin(id, viewer.id, ADMIN_ACTION_ERROR);
    const taken = new Set(this.conversations.activeMemberIds(row));
    let candidates = [...new Set(userIds)].filter((uid) => uid !== viewer.id && !taken.has(uid));
    if (this.blocks) {
      const skip = await this.blocks.restrictedIds(viewer.id);
      candidates = candidates.filter((uid) => !skip.has(uid));
    }
    if (!candidates.length) return { created: false, conversation: await this.conversations.toDetail(viewer, row) };
    const people = await this.users.findByIds(candidates);
    if (people.length !== candidates.length || people.some((u) => u.status !== 'active' || u.deletedAt)) {
      throw new BadRequestException({ error: 'Someone in this group is not available' });
    }
    const added = this.conversations.addMembers(row, candidates);
    const live = await this.commit(row, viewer.id, `You added ${and(people.map((u) => u.name))} to the group.`, viewer);
    for (const uid of added) {
      const detail = await this.conversations.toDetail({ id: uid, isOwner: false }, live);
      this.realtime.emitPreview(uid, {
        conversationId: live.id,
        preview: detail.preview,
        previewIcon: detail.previewIcon,
        lastMessageAt: detail.time,
        unread: detail.unread,
      });
    }
    const actor = await this.users.findById(viewer.id);
    this.events?.emit(EVENT_GROUP_MEMBER_ADDED, {
      conversationId: live.id,
      groupName: live.name || 'a group',
      actorId: viewer.id,
      actorName: actor?.name ?? 'Someone',
      userIds: added,
    });
    return { created: true, conversation: await this.conversations.toDetail(viewer, live) };
  }

  async removeMember(viewer: AuthViewer, id: string, userId: string) {
    const row = await this.conversations.assertGroupAdmin(id, viewer.id, ADMIN_REMOVE_ERROR);
    if (userId === viewer.id) throw new BadRequestException({ error: LEAVE_INSTEAD });
    const target = await this.person(userId);
    this.conversations.markMemberLeft(row, userId, viewer.id);
    await this.commit(row, viewer.id, `You removed ${target.name} from the group.`, viewer);
    this.realtime.emitMemberLeft(row.id, userId, 'removed');
    this.realtime.emitConversationRemoved(userId, row.id);
    return { ok: true as const };
  }

  async setAdmin(viewer: AuthViewer, id: string, userId: string, isAdmin: boolean) {
    const row = await this.conversations.assertGroupAdmin(id, viewer.id, ADMIN_ACTION_ERROR);
    const member = this.conversations.getActiveMembers(row).find((m) => String(m.user) === userId);
    if (!member) throw new BadRequestException({ error: 'That person is not in this group' });
    if (!isAdmin && member.role === 'admin' && this.conversations.adminCount(row) <= 1) {
      throw new BadRequestException({ error: LAST_ADMIN_ERROR });
    }
    if (userId === viewer.id) throw new BadRequestException({ error: 'You cannot change your own admin role here' });
    const target = await this.person(userId);
    this.conversations.setMemberRole(row, userId, isAdmin ? 'admin' : 'member');
    await this.commit(
      row,
      viewer.id,
      isAdmin ? `You made ${target.name} a group admin.` : `You removed admin from ${target.name}.`,
      viewer,
    );
    const dto = (await this.conversations.groupMembers(viewer, row)).find((m) => m.id === userId);
    if (!dto) throw new NotFoundException({ error: 'Conversation not found' });
    return { member: dto };
  }

  async leave(viewer: AuthViewer, id: string) {
    const row = await this.conversations.assertActiveMember(id, viewer.id);
    const remaining = this.conversations.getActiveMembers(row).filter((m) => String(m.user) !== viewer.id);
    if (this.conversations.adminCount(row) === 1 && this.conversations.isGroupAdmin(row, viewer.id) && remaining[0]) {
      const next = this.conversations.longestTenuredMember(row, viewer.id);
      if (next) this.conversations.setMemberRole(row, String(next.user), 'admin');
    }
    this.conversations.markMemberLeft(row, viewer.id, null);
    const host = remaining[0];
    if (host) {
      const leaver = await this.users.findById(viewer.id);
      await this.commit(row, null, `${leaver?.name ?? 'A member'} left the group.`, {
        id: String(host.user),
        isOwner: false,
      });
    } else {
      await row.save();
    }
    this.realtime.emitMemberLeft(row.id, viewer.id, 'left');
    this.realtime.emitConversationRemoved(viewer.id, row.id);
    return { ok: true as const };
  }

  private async person(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new BadRequestException({ error: 'That person is not in this group' });
    return user;
  }

  private async commit(row: ConversationDocument, senderId: string | null, text: string, viewer: AuthViewer) {
    await row.save();
    await this.messages.sendSystem(row.id, senderId, text);
    const live = (await this.conversations.getById(row.id)) ?? row;
    const members = (await this.conversations.groupMembers(viewer, live)).map((m) => ({ ...m, isMe: false }));
    const { status, sub } = await this.conversations.groupHeadline(viewer, live);
    this.realtime.emitGroupUpdated(live.id, { members, status, sub });
    return live;
  }
}

function and(names: string[]) {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}
