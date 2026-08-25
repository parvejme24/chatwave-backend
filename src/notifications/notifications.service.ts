import { Inject, Injectable, NotFoundException, Optional, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { BlocksService } from '../blocks/blocks.service';
import { MailService } from '../common/mail/mail.service';
import { RedisService } from '../common/redis/redis.service';
import { ChatGateway } from '../messages/messages.gateway';
import { isMongoId as isMessageMongoId } from '../messages/messages.constants';
import type { AuthViewer } from '../users/users.constants';
import { UsersService } from '../users/users.service';
import { Notification, NotificationDocument } from './notification.schema';
import {
  NOTIFY_RATE_MAX,
  NOTIFY_RATE_WINDOW,
  OFFLINE_FOR_EMAIL_MS,
  chatHref,
  isMongoId,
  type CallNotifyEvent,
  type GroupMemberAddedEvent,
  type MessageCreatedEvent,
  type NotificationActorDto,
  type NotificationDto,
  type NotifyInput,
} from './notifications.constants';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private readonly rows: Model<NotificationDocument>,
    private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    @Optional() @Inject(forwardRef(() => BlocksService)) private readonly blocks?: BlocksService,
    @Optional() private readonly chat?: ChatGateway,
  ) {}

  async notify(input: NotifyInput) {
    if (!input.userId || input.userId === input.actorId) return null;
    if (!isMongoId(input.userId)) return null;
    try {
      if (await this.redis.tooMany(`rl:notify:${input.userId}`, NOTIFY_RATE_MAX, NOTIFY_RATE_WINDOW)) return null;
    } catch {
      /* Redis down: still persist */
    }
    if (input.skipIfInThread && input.conversationId && (await this.chat?.isInConversation(input.userId, input.conversationId))) {
      return null;
    }
    const recipient = await this.users.findById(input.userId);
    if (!recipient || recipient.status === 'banned' || recipient.deletedAt) return null;
    const row = await this.rows.create({
      user: new Types.ObjectId(input.userId),
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      conversation: oidOrNull(input.conversationId),
      message: oidOrNull(input.messageId),
      call: oidOrNull(input.callId),
      actor: oidOrNull(input.actorId),
      href: input.href ?? '',
      meta: input.meta ?? {},
    });
    if (input.type === 'message' && recipient.settings?.unreadDigest === true) {
      try {
        await this.redis.bumpUnreadDigest(input.userId, input.preview || input.body || input.title);
      } catch {
        /* digest is best-effort */
      }
    }
    const dto = await this.toDto(row);
    const unreadCount = await this.unreadCount(input.userId);
    try {
      this.chat?.emitNotification(input.userId, dto);
      this.chat?.emitBadge(input.userId, unreadCount);
    } catch {
      /* sockets are best-effort */
    }
    return dto;
  }

  async onMessageCreated(event: MessageCreatedEvent) {
    if (event.message.type === 'system' || event.message.type === 'call') return;
    const conversationId = event.conversation.id;
    const title = event.conversation.type === 'group' ? event.conversation.name || 'Group' : event.actorName;
    for (const member of event.conversation.members) {
      const userId = String(member.user);
      if (!userId || userId === event.senderId || member.leftAt) continue;
      if (member.muted) continue;
      if (await this.blocks?.isBlocked(userId, event.senderId)) continue;
      const user = await this.users.findById(userId);
      if (user?.settings?.messageNotifications === false) continue;
      await this.notify({
        userId,
        type: 'message',
        title,
        body: event.preview,
        href: chatHref(conversationId),
        conversationId,
        messageId: event.message.id,
        actorId: event.senderId,
        skipIfInThread: true,
        preview: event.preview,
      });
    }
  }

  async onCallIncoming(event: CallNotifyEvent) {
    for (const userId of event.recipientIds) {
      await this.notify({
        userId,
        type: 'call',
        title: event.actorName,
        body: event.label,
        href: event.href,
        conversationId: event.conversationId,
        callId: event.callId,
        actorId: event.actorId,
      });
    }
  }

  async onCallMissed(event: CallNotifyEvent) {
    for (const userId of event.recipientIds) {
      const dto = await this.notify({
        userId,
        type: 'missed_call',
        title: event.label,
        body: event.actorName ? `${event.actorName}` : '',
        href: event.href,
        conversationId: event.conversationId,
        callId: event.callId,
        actorId: event.actorId,
      });
      if (!dto) continue;
      await this.maybeEmailMissedCall(userId, event.label, dto.id);
    }
  }

  async onGroupMemberAdded(event: GroupMemberAddedEvent) {
    for (const userId of event.userIds) {
      await this.notify({
        userId,
        type: 'group',
        title: `${event.actorName} added you to ${event.groupName}`,
        body: '',
        href: chatHref(event.conversationId),
        conversationId: event.conversationId,
        actorId: event.actorId,
      });
    }
  }

  async list(viewer: AuthViewer, query: { cursor?: string; limit?: number; unreadOnly?: boolean }) {
    const take = Math.min(Math.max(query.limit || 30, 1), 100);
    const filter: Record<string, unknown> = { user: new Types.ObjectId(viewer.id) };
    if (query.unreadOnly) filter.readAt = null;
    if (query.cursor) {
      const before = isMongoId(query.cursor)
        ? (await this.rows.findById(query.cursor).exec())?.createdAt
        : new Date(query.cursor);
      if (before && !Number.isNaN(+before)) filter.createdAt = { $lt: before };
    }
    const found = await this.rows.find(filter).sort({ createdAt: -1 }).limit(take + 1).exec();
    const hasMore = found.length > take;
    const page = hasMore ? found.slice(0, take) : found;
    const notifications = await Promise.all(page.map((row) => this.toDto(row)));
    return {
      notifications,
      unreadCount: await this.unreadCount(viewer.id),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  unreadCount(userId: string) {
    return this.rows.countDocuments({ user: new Types.ObjectId(userId), readAt: null }).exec();
  }

  async markRead(viewer: AuthViewer, ids?: string[]) {
    const filter: Record<string, unknown> = { user: new Types.ObjectId(viewer.id), readAt: null };
    if (ids?.length) filter._id = { $in: ids.filter(isMongoId).map((id) => new Types.ObjectId(id)) };
    await this.rows.updateMany(filter, { $set: { readAt: new Date() } }).exec();
    const unreadCount = await this.unreadCount(viewer.id);
    try {
      this.chat?.emitBadge(viewer.id, unreadCount);
    } catch {
      /* ignore */
    }
    return { unreadCount };
  }

  async markOne(viewer: AuthViewer, id: string) {
    if (!isMongoId(id) && !isMessageMongoId(id)) throw new NotFoundException({ error: 'Notification not found' });
    const row = await this.rows.findOne({ _id: id, user: new Types.ObjectId(viewer.id) }).exec();
    if (!row) throw new NotFoundException({ error: 'Notification not found' });
    if (!row.readAt) {
      row.readAt = new Date();
      await row.save();
      try {
        this.chat?.emitBadge(viewer.id, await this.unreadCount(viewer.id));
      } catch {
        /* ignore */
      }
    }
    return { ok: true as const };
  }

  async sendDigests() {
    let ids: string[] = [];
    try {
      ids = await this.redis.pendingDigestUserIds();
    } catch {
      return;
    }
    for (const userId of ids) {
      const user = await this.users.findActiveById(userId);
      if (!user || user.settings?.unreadDigest !== true) {
        try {
          await this.redis.takeUnreadDigest(userId);
        } catch {
          /* ignore */
        }
        continue;
      }
      const digest = await this.redis.takeUnreadDigest(userId);
      if (!digest) continue;
      try {
        await this.mail.sendUnreadDigest(user.email, user.name, digest.count, digest.preview);
      } catch {
        /* skip email if mail is down */
      }
    }
  }

  async maybeEmailMissedCall(userId: string, label: string, notificationId: string) {
    const user = await this.users.findById(userId);
    if (!user || user.settings?.missedCallEmails === false) return;
    if (!(await this.offlineLongEnough(userId, user.lastSeenAt))) return;
    try {
      await this.mail.sendMissedCall(user.email, user.name, label);
      await this.rows.findByIdAndUpdate(notificationId, { emailSentAt: new Date() }).exec();
    } catch {
      /* miss still recorded in-app */
    }
  }

  async offlineLongEnough(userId: string, lastSeenAt?: Date) {
    if ((await this.redis.socketCount(userId)) > 0) return false;
    if (await this.redis.getLivePresence(userId)) return false;
    if (!lastSeenAt) return true;
    return Date.now() - lastSeenAt.getTime() >= OFFLINE_FOR_EMAIL_MS;
  }

  private async toDto(row: NotificationDocument): Promise<NotificationDto> {
    const actorId = row.actor ? String(row.actor) : '';
    const actorDoc = actorId ? await this.users.findById(actorId) : null;
    let actor: NotificationActorDto | null = null;
    if (actorDoc) {
      const profile = await this.users.publicUser({ id: String(row.user), isOwner: false }, actorDoc);
      actor = {
        id: profile.id,
        name: profile.name,
        username: profile.username,
        initials: profile.initials,
        tone: profile.tone,
        photoUrl: profile.photoUrl,
      };
    }
    return {
      id: row.id,
      type: row.type as NotificationDto['type'],
      title: row.title,
      body: row.body ?? '',
      href: row.href ?? '',
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
      actor,
      conversationId: row.conversation ? String(row.conversation) : null,
      messageId: row.message ? String(row.message) : null,
    };
  }
}

function oidOrNull(id?: string | null) {
  return id && isMongoId(id) ? new Types.ObjectId(id) : null;
}
