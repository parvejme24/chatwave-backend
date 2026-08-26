import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { MailService } from '../common/mail/mail.service';
import { RedisService } from '../common/redis/redis.service';
import { Call, CallDocument } from '../calls/call.schema';
import { callLabel, mmss } from '../calls/calls.constants';
import { Conversation, ConversationDocument } from '../conversations/conversation.schema';
import { ChatGateway } from '../messages/messages.gateway';
import { Message, MessageDocument } from '../messages/message.schema';
import { User, UserDocument } from '../users/user.schema';
import type { AuthViewer } from '../users/users.constants';
import { UsersService } from '../users/users.service';
import {
  ACCOUNT_DELETED,
  CALL_HISTORY_CAP,
  CANNOT_MODERATE_OWNER,
  GROUP_HISTORY_CAP,
  HISTORY_CAP,
  MESSAGE_HISTORY_CAP,
  USER_NOT_FOUND,
  escapeRegex,
  formatClock,
  formatJoined,
  isMongoId,
  toHistoryEvent,
  type ManagedUserListDto,
  type RawHistoryEvent,
} from './admin.constants';
import type { ListAdminUsersDto } from './admin.dto';
import { AuditService } from './audit.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDocument>,
    @InjectModel(Call.name) private readonly calls: Model<CallDocument>,
    @InjectModel(Conversation.name) private readonly conversations: Model<ConversationDocument>,
    private readonly accounts: UsersService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Optional() private readonly chat?: ChatGateway,
  ) {}

  async list(query: ListAdminUsersDto) {
    const take = Math.min(Math.max(query.limit || 50, 1), 100);
    const filter = this.listFilter(query);
    const [rows, total, bannedCount] = await Promise.all([
      this.users.find(filter).sort({ createdAt: -1 }).limit(take).exec(),
      this.users.countDocuments(filter).exec(),
      this.users.countDocuments({ status: 'banned', deletedAt: null }).exec(),
    ]);
    const users = await Promise.all(rows.map((row) => this.toListDto(row)));
    return { total, bannedCount, users };
  }

  async get(id: string) {
    const user = await this.requireUser(id);
    const history = await this.historyFor(user);
    return {
      user: await this.toListDto(user, history.length),
      history: history.map((row) => toHistoryEvent(row)),
    };
  }

  async ban(actor: AuthViewer, id: string) {
    const user = this.assertModeratable(await this.requireUser(id));
    const already = user.status === 'banned';
    const saved = (await this.accounts.banAccount(user.id)) ?? user;
    await this.redis.deleteAllSessions(saved.id);
    await this.kick(saved.id);
    if (!already) {
      await this.safeAudit({
        user: saved.id,
        actor: actor.id,
        kind: 'ban',
        title: 'Account banned',
      });
      try {
        await this.mail.sendAccountBanned(saved.email, saved.name);
      } catch {
        /* ban still succeeds */
      }
    }
    return { user: await this.toListDto(saved) };
  }

  async unban(actor: AuthViewer, id: string) {
    const user = this.assertModeratable(await this.requireUser(id));
    if (user.deletedAt) throw new BadRequestException({ error: ACCOUNT_DELETED });
    const already = user.status === 'active';
    const saved = already ? user : ((await this.accounts.unbanAccount(user.id)) ?? user);
    if (!already) {
      await this.safeAudit({
        user: saved.id,
        actor: actor.id,
        kind: 'unban',
        title: 'Account unbanned',
      });
    }
    return { user: await this.toListDto(saved) };
  }

  async remove(actor: AuthViewer, id: string) {
    const user = this.assertModeratable(await this.requireUser(id));
    if (user.deletedAt) return { ok: true as const };
    await this.accounts.adminDelete(user.id);
    await this.redis.deleteAllSessions(user.id);
    await this.kick(user.id);
    await this.safeAudit({
      user: user.id,
      actor: actor.id,
      kind: 'delete',
      title: 'Account deleted',
    });
    return { ok: true as const };
  }

  private listFilter(query: ListAdminUsersDto) {
    const filter: Record<string, unknown> = {};
    if (!query.includeDeleted) filter.deletedAt = null;
    if (query.status === 'active') filter.status = 'active';
    if (query.status === 'banned') filter.status = 'banned';
    const q = query.q?.trim();
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: rx }, { username: rx }, { email: rx }];
    }
    return filter;
  }

  private async toListDto(user: UserDocument, eventCount?: number): Promise<ManagedUserListDto> {
    const joinedAt = user.createdAt ?? new Date();
    return {
      id: user.id,
      name: user.name,
      user: user.username,
      username: user.username,
      email: user.email,
      initials: user.initials,
      tone: user.tone,
      photoUrl: user.photoUrl ?? null,
      presence: await this.accounts.livePresence(user.id),
      note: '',
      joined: formatJoined(joinedAt),
      lastSeen: user.lastSeenAt ? formatClock(user.lastSeenAt) : '',
      status: user.status === 'banned' || user.deletedAt ? 'banned' : 'active',
      eventCount: eventCount ?? (await this.historyFor(user)).length,
      isOwner: Boolean(user.isOwner),
    };
  }

  private async historyFor(user: UserDocument) {
    const oid = new Types.ObjectId(user.id);
    const [audits, messages, calls, groups] = await Promise.all([
      this.audit.listForUser(user.id, HISTORY_CAP),
      this.messages
        .find({ sender: oid, deletedAt: null, type: { $nin: ['system', 'call'] } })
        .sort({ createdAt: -1 })
        .limit(MESSAGE_HISTORY_CAP)
        .exec(),
      this.calls.find({ 'participants.user': oid }).sort({ startedAt: -1 }).limit(CALL_HISTORY_CAP).exec(),
      this.conversations
        .find({ type: 'group', 'members.user': oid })
        .sort({ createdAt: -1 })
        .limit(GROUP_HISTORY_CAP)
        .exec(),
    ]);

    const events: RawHistoryEvent[] = audits.map((row) => ({
      id: row.id,
      at: row.createdAt,
      kind: row.kind as RawHistoryEvent['kind'],
      title: row.title,
      detail: row.detail ?? '',
    }));

    if (!audits.some((row) => row.kind === 'signup') && user.createdAt) {
      events.push({
        id: `signup:${user.id}`,
        at: user.createdAt,
        kind: 'signup',
        title: 'Joined ChatWave',
        detail: '',
      });
    }

    for (const row of messages) {
      const media = row.type !== 'text';
      events.push({
        id: row.id,
        at: row.createdAt,
        kind: media ? 'media' : 'message',
        title: media ? mediaTitle(row.type) : messageTitle(row.text),
        detail: media ? (row.caption || row.media?.fileName || '') : '',
      });
    }

    for (const row of calls) {
      const missed = row.status === 'missed';
      events.push({
        id: row.id,
        at: row.startedAt ?? row.createdAt,
        kind: 'call',
        title: callLabel(row.type, missed),
        detail: row.durationSec ? mmss(row.durationSec) : '',
      });
    }

    for (const row of groups) {
      const member = row.members.find((item) => String(item.user) === user.id);
      const created = String(row.createdBy) === user.id;
      events.push({
        id: row.id,
        at: member?.joinedAt ?? row.createdAt,
        kind: 'group',
        title: created ? `Created ${row.name || 'a group'}` : `Joined ${row.name || 'a group'}`,
        detail: '',
      });
    }

    return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, HISTORY_CAP);
  }

  private async requireUser(id: string) {
    if (!isMongoId(id)) throw new NotFoundException({ error: USER_NOT_FOUND });
    const user = await this.users.findById(id).exec();
    if (!user) throw new NotFoundException({ error: USER_NOT_FOUND });
    return user;
  }

  private assertModeratable(user: UserDocument) {
    if (user.isOwner) throw new BadRequestException({ error: CANNOT_MODERATE_OWNER });
    return user;
  }

  private async kick(userId: string) {
    try {
      await this.chat?.kickBanned(userId);
    } catch {
      /* sockets are best-effort */
    }
  }

  private async safeAudit(input: Parameters<AuditService['log']>[0]) {
    try {
      await this.audit.log(input);
    } catch {
      /* moderation still succeeds */
    }
  }
}

function messageTitle(text: string) {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'Sent a message';
  return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}

function mediaTitle(type: string) {
  if (type === 'image') return 'Sent a photo';
  if (type === 'voice') return 'Sent a voice note';
  if (type === 'video' || type === 'video_note') return 'Sent a video';
  return 'Sent a file';
}
