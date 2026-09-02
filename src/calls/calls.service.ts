import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { BlocksService } from '../blocks/blocks.service';
import { RedisService } from '../common/redis/redis.service';
import { AppEnv } from '../config/env.validation';
import { ConversationDocument } from '../conversations/conversation.schema';
import { ConversationsService } from '../conversations/conversations.service';
import { isMongoId } from '../messages/messages.constants';
import { MessagesService } from '../messages/messages.service';
import { EVENT_CALL_INCOMING, EVENT_CALL_MISSED } from '../notifications/notifications.constants';
import type { AuthViewer } from '../users/users.constants';
import { UsersService } from '../users/users.service';
import { Call, CallDocument } from './call.schema';
import {
  asStatus,
  asType,
  callDirection,
  callHref,
  callLabel,
  callSection,
  clock,
  kindWord,
  mmss,
  type CallDto,
  type CallFilter,
  type CallPeer,
  type CallRecordDto,
  type CallSection,
  type IceServer,
} from './calls.constants';
import { CallsRealtime } from './calls.realtime';

@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private hangupTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    @InjectModel(Call.name) private readonly calls: Model<CallDocument>,
    private readonly conversations: ConversationsService,
    private readonly users: UsersService,
    private readonly messages: MessagesService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly realtime: CallsRealtime,
    @Optional() @Inject(forwardRef(() => BlocksService)) private readonly blocks?: BlocksService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.expireRings(), 5000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    for (const timer of this.hangupTimers) clearTimeout(timer);
    this.hangupTimers.clear();
  }

  iceServers(): IceServer[] {
    const servers: IceServer[] = [{ urls: this.config.get('STUN_URL', { infer: true }) }];
    const turn = this.config.get('TURN_URL', { infer: true });
    const username = this.config.get('TURN_USERNAME', { infer: true });
    const credential = this.config.get('TURN_CREDENTIAL', { infer: true });
    if (turn) servers.push({ urls: turn, username: username || undefined, credential: credential || undefined });
    return servers;
  }

  async start(viewer: AuthViewer, conversationId: string, type: 'audio' | 'video') {
    const conversation = await this.conversations.assertMember(viewer.id, conversationId);
    const memberIds = this.conversations.activeMemberIds(conversation);
    const callees = memberIds.filter((id) => id !== viewer.id);
    if (!callees.length) throw new BadRequestException({ error: 'No one to call' });
    if (conversation.type === 'direct' && callees[0]) await this.blocks?.assertNotBlocked(viewer.id, callees[0]);
    const people = await this.users.findByIds(callees);
    if (people.length !== callees.length || people.some((u) => u.status !== 'active' || u.deletedAt)) {
      throw new BadRequestException({ error: 'Someone in this chat is not available' });
    }
    await this.expireRings();
    await this.clearStaleBusy(memberIds);
    // Stuck ringing/active rows (e.g. failed hang-up) still mark members busy.
    // Close this viewer's leftovers before rejecting the new call.
    if (await this.busy(memberIds)) {
      await this.hangupAllForUser(viewer.id);
      await this.clearStaleBusy(memberIds);
    }
    if (await this.busy(memberIds)) throw new ConflictException({ error: 'Already in a call' });
    const now = new Date();
    const row = await this.calls.create({
      conversation: oid(conversationId),
      type,
      status: 'ringing',
      initiatedBy: oid(viewer.id),
      startedAt: now,
      participants: [
        { user: oid(viewer.id), direction: 'out', joinedAt: now, leftAt: null },
        ...callees.map((id) => ({ user: oid(id), direction: 'in', joinedAt: null, leftAt: null })),
      ],
    });
    const ttl = Math.ceil(this.config.get('CALL_RING_TIMEOUT_MS', { infer: true }) / 1000);
    await this.redis.setCallRing(row.id, ttl);
    await Promise.all(memberIds.map((id) => this.redis.setCallBusy(id, row.id, Math.max(ttl, 14400))));
    await this.messages.sendCallLog(conversation.id, viewer.id, {
      callId: row.id,
      missed: false,
      label: callLabel(type),
      meta: clock(now),
    });
    for (const id of callees) this.realtime.emitIncoming(id, await this.toDto({ id, isOwner: false }, row, conversation));
    this.realtime.emitStarted(conversation.id, row.id);
    const me = await this.users.findById(viewer.id);
    this.events?.emit(EVENT_CALL_INCOMING, {
      callId: row.id,
      conversationId: conversation.id,
      actorId: viewer.id,
      actorName: me?.name ?? 'ChatWave user',
      type,
      recipientIds: callees,
      href: callHref(type, me?.name ?? 'ChatWave', { callId: row.id, conversationId: conversation.id }),
      label: callLabel(type),
    });
    return { call: await this.toDto(viewer, row, conversation) };
  }

  async accept(viewer: AuthViewer, id: string) {
    const row = await this.requireCallee(id, viewer.id);
    if (row.status !== 'ringing') throw new BadRequestException({ error: 'That call is no longer ringing' });
    const now = new Date();
    row.status = 'active';
    row.answeredAt = now;
    const mine = seat(row, viewer.id);
    if (mine) mine.joinedAt = now;
    await row.save();
    await this.redis.clearCallRing(row.id);
    this.realtime.emitAccepted(String(row.conversation), ids(row), { callId: row.id, userId: viewer.id });
    this.realtime.emitParticipant(row.id, viewer.id, 'joined', ids(row));
    return { call: await this.toDto(viewer, row), iceServers: this.iceServers() };
  }

  async decline(viewer: AuthViewer, id: string) {
    const row = await this.requireCallee(id, viewer.id);
    if (row.status !== 'ringing') throw new BadRequestException({ error: 'That call is no longer ringing' });
    const mine = seat(row, viewer.id);
    if (mine) mine.leftAt = new Date();
    await this.redis.clearCallBusy(viewer.id);
    const conversation = await this.conversations.getById(String(row.conversation));
    if (conversation?.type !== 'group') await this.conclude(row, { status: 'declined', endedBy: viewer.id });
    else {
      await row.save();
      this.realtime.emitDeclined(String(row.conversation), ids(row), { callId: row.id, userId: viewer.id });
    }
    return { ok: true as const };
  }

  async end(viewer: AuthViewer, id: string, ice?: 'p2p' | 'turn') {
    const row = await this.requireParticipant(id, viewer.id);
    if (row.status !== 'ringing' && row.status !== 'active') {
      this.notifyEnded(row);
      return { call: await this.toDto(viewer, row) };
    }
    await this.conclude(row, {
      status: this.finishStatus(row, viewer.id),
      endedBy: viewer.id,
      ice,
    });
    return { call: await this.toDto(viewer, row) };
  }

  async hangupAllForUser(userId: string) {
    if (!isMongoId(userId)) return;
    const rows = await this.calls
      .find({
        status: { $in: ['ringing', 'active'] },
        'participants.user': oid(userId),
      })
      .exec();
    for (const row of rows) {
      await this.conclude(row, { status: this.finishStatus(row, userId), endedBy: userId });
    }
  }

  hangupIfDisconnected(userId: string) {
    const timer = setTimeout(() => {
      this.hangupTimers.delete(timer);
      void this.redis.socketCount(userId).then((count) => {
        if (count > 0) return;
        return this.hangupAllForUser(userId);
      });
    }, 2500);
    this.hangupTimers.add(timer);
  }

  async getOne(viewer: AuthViewer, id: string) {
    return { call: await this.toDto(viewer, await this.requireParticipant(id, viewer.id)), iceServers: this.iceServers() };
  }

  async list(viewer: AuthViewer, filter: CallFilter = 'all', limit = 50, tz?: string) {
    const query: Record<string, unknown> = { 'participants.user': oid(viewer.id) };
    if (filter === 'voice') query.type = 'audio';
    if (filter === 'video') query.type = 'video';
    if (filter === 'missed') query.$or = [{ status: 'missed' }, { status: 'declined', initiatedBy: { $ne: oid(viewer.id) } }];
    const rows = await this.calls.find(query).sort({ startedAt: -1 }).limit(Math.min(Math.max(limit || 50, 1), 100)).exec();
    const calls = (await Promise.all(rows.map((row) => this.toRecord(viewer, row, tz)))).filter((item) => item !== null);
    const buckets: Record<CallSection, CallRecordDto[]> = { today: [], yesterday: [], older: [] };
    for (const item of calls) buckets[item.section].push(item);
    const titles = { today: 'Today', yesterday: 'Yesterday', older: 'Older' } as const;
    const sections = (['today', 'yesterday', 'older'] as const)
      .filter((id) => buckets[id].length)
      .map((id) => ({ id, title: titles[id], meta: sectionMeta(buckets[id]) }));
    return { calls, sections };
  }

  async quality(viewer: AuthViewer) {
    const rows = await this.calls
      .find({ 'participants.user': oid(viewer.id), status: { $in: ['ended', 'missed', 'declined'] } })
      .sort({ endedAt: -1, startedAt: -1 })
      .limit(10)
      .exec();
    const tally = { p2p: 0, turn: 0, unknown: 0 };
    for (const row of rows) tally[row.ice === 'p2p' || row.ice === 'turn' ? row.ice : 'unknown'] += 1;
    return tally;
  }

  async expireRings() {
    const cutoff = new Date(Date.now() - this.config.get('CALL_RING_TIMEOUT_MS', { infer: true }));
    const rows = await this.calls.find({ status: 'ringing', startedAt: { $lte: cutoff } }).exec();
    for (const row of rows) await this.conclude(row, { status: 'missed', endedBy: null });
    return rows.length;
  }

  async requireParticipant(id: string, userId: string) {
    if (!isMongoId(id)) throw new NotFoundException({ error: 'Call not found' });
    const row = await this.calls.findById(id).exec();
    if (!row) throw new NotFoundException({ error: 'Call not found' });
    if (!seat(row, userId)) throw new ForbiddenException({ error: 'You cannot access this call' });
    return row;
  }

  async markJoined(id: string, userId: string) {
    const row = await this.requireParticipant(id, userId);
    const mine = seat(row, userId);
    if (mine && !mine.joinedAt) {
      mine.joinedAt = new Date();
      await row.save();
    }
    return { row, participantIds: ids(row) };
  }

  private async busy(userIds: string[]) {
    const live = await this.calls
      .findOne({
        status: { $in: ['ringing', 'active'] },
        participants: { $elemMatch: { user: { $in: userIds.map(oid) }, leftAt: null } },
      })
      .exec();
    if (live) return true;
    for (const id of userIds) {
      const callId = await this.redis.getCallBusy(id);
      if (!callId) continue;
      const row = isMongoId(callId) ? await this.calls.findById(callId).exec() : null;
      if (row && (row.status === 'ringing' || row.status === 'active')) return true;
      await this.redis.clearCallBusy(id);
    }
    return false;
  }

  private async clearStaleBusy(userIds: string[]) {
    for (const id of userIds) {
      const callId = await this.redis.getCallBusy(id);
      if (!callId) continue;
      const row = isMongoId(callId) ? await this.calls.findById(callId).exec() : null;
      if (!row || (row.status !== 'ringing' && row.status !== 'active')) await this.redis.clearCallBusy(id);
    }
  }

  private finishStatus(row: CallDocument, endedBy: string): 'ended' | 'missed' | 'declined' {
    if (row.status === 'active') return 'ended';
    return String(row.initiatedBy) === endedBy ? 'missed' : 'declined';
  }

  private notifyEnded(row: CallDocument) {
    this.realtime.emitEnded(String(row.conversation), ids(row), {
      callId: row.id,
      conversationId: String(row.conversation),
      status: row.status,
      durationSec: row.durationSec ?? 0,
      endedBy: row.endedBy ? String(row.endedBy) : null,
    });
  }

  private async requireCallee(id: string, userId: string) {
    const row = await this.requireParticipant(id, userId);
    if (String(row.initiatedBy) === userId || seat(row, userId)?.direction !== 'in') {
      throw new ForbiddenException({ error: 'Only the person being called can do that' });
    }
    return row;
  }

  private async conclude(
    row: CallDocument,
    input: { status: 'ended' | 'missed' | 'declined'; endedBy: string | null; ice?: 'p2p' | 'turn' },
  ) {
    if (row.status !== 'ringing' && row.status !== 'active') return;
    const now = new Date();
    if (row.status === 'active' || input.status === 'ended') {
      row.status = 'ended';
      row.durationSec = row.answeredAt ? Math.max(0, Math.round((+now - +row.answeredAt) / 1000)) : 0;
    } else {
      row.status = input.status;
      row.durationSec = 0;
    }
    row.endedAt = now;
    row.endedBy = input.endedBy ? oid(input.endedBy) : null;
    if (input.ice) row.ice = input.ice;
    for (const participant of row.participants) {
      if (!participant.leftAt) participant.leftAt = now;
    }
    await row.save();
    await this.redis.clearCallRing(row.id);
    await Promise.all(ids(row).map((id) => this.redis.clearCallBusy(id)));
    const missed = row.status === 'missed';
    const label =
      missed ? callLabel(row.type, true) : row.status === 'declined' ? `Declined ${kindWord(row.type)} call` : callLabel(row.type);
    const preview = missed || row.status === 'declined' ? label : row.durationSec > 0 ? `${label} · ${mmss(row.durationSec)}` : label;
    await this.messages.updateCallLog(row.id, {
      missed,
      label,
      meta: row.durationSec > 0 ? mmss(row.durationSec) : clock(row.startedAt),
      preview,
    });
    this.notifyEnded(row);
    if (missed) this.realtime.emitMissed(ids(row), { callId: row.id });
    if (missed) {
      const actorId = String(row.initiatedBy);
      const actor = await this.users.findById(actorId);
      const recipients = ids(row).filter((id) => id !== actorId);
      this.events?.emit(EVENT_CALL_MISSED, {
        callId: row.id,
        conversationId: String(row.conversation),
        actorId,
        actorName: actor?.name ?? 'ChatWave user',
        type: row.type,
        recipientIds: recipients,
        href: callHref(asType(row.type), actor?.name ?? 'ChatWave', { callId: row.id, conversationId: String(row.conversation) }),
        label,
      });
    }
    if (row.status === 'declined' && input.endedBy) {
      this.realtime.emitDeclined(String(row.conversation), ids(row), { callId: row.id, userId: input.endedBy });
    }
  }

  private async toDto(viewer: AuthViewer, row: CallDocument, conversation?: ConversationDocument | null): Promise<CallDto> {
    const chat = conversation ?? (await this.conversations.getById(String(row.conversation)));
    const peer = await this.peer(viewer, row, chat);
    const type = asType(row.type);
    return {
      id: row.id,
      conversationId: String(row.conversation),
      type,
      status: asStatus(row.status),
      initiatedBy: String(row.initiatedBy),
      peer,
      href: callHref(type, peer.name, { callId: row.id }),
      startedAt: (row.startedAt ?? new Date()).toISOString(),
      answeredAt: row.answeredAt ? row.answeredAt.toISOString() : null,
      durationSec: row.durationSec ?? 0,
      iceServers: this.iceServers(),
    };
  }

  private async toRecord(viewer: AuthViewer, row: CallDocument, tz?: string): Promise<CallRecordDto | null> {
    if (row.status === 'ringing' || row.status === 'active') return null;
    const peer = await this.peer(viewer, row, await this.conversations.getById(String(row.conversation)));
    const type = asType(row.type);
    const direction = callDirection(row.status, String(row.initiatedBy), viewer.id);
    const when = clock(row.startedAt ?? new Date(), tz);
    const kind = kindWord(type);
    const joined = row.participants.filter((p) => p.joinedAt).length;
    const subtitle =
      direction === 'missed'
        ? `Missed ${kind} call · ${when}`
        : peer.group
          ? `Group ${kind} · ${joined} joined · ${when}`
          : `${direction === 'out' ? 'Outgoing' : 'Incoming'} ${kind} · ${when}`;
    return {
      id: row.id,
      section: callSection(row.startedAt ?? new Date(), tz),
      name: peer.name,
      initials: peer.initials,
      tone: peer.tone,
      photoUrl: peer.photoUrl,
      presence: peer.presence,
      group: peer.group,
      type,
      status: row.status === 'declined' || row.status === 'missed' ? row.status : 'ended',
      direction,
      subtitle,
      ...(row.durationSec > 0 ? { duration: mmss(row.durationSec) } : {}),
      endTag: null,
      actions: [{ type, href: callHref(type, peer.name, { callId: '', conversationId: String(row.conversation) }), label: `Call ${peer.name} again` }],
    };
  }

  private async peer(viewer: AuthViewer, row: CallDocument, conversation?: ConversationDocument | null): Promise<CallPeer> {
    if (conversation?.type === 'group') {
      return {
        id: conversation.id,
        name: conversation.name || 'Group',
        username: '',
        initials: conversation.initials || 'GR',
        tone: conversation.tone || 'e',
        photoUrl: conversation.photo ?? null,
        presence: 'offline',
        group: true,
      };
    }
    const otherId = ids(row).find((id) => id !== viewer.id) ?? viewer.id;
    const pub = await this.users.findById(otherId).then((doc) => (doc ? this.users.publicUser(viewer, doc) : null));
    return {
      id: otherId,
      name: pub?.name ?? 'ChatWave user',
      username: pub?.username ?? 'user',
      initials: pub?.initials ?? 'CW',
      tone: pub?.tone ?? 'a',
      photoUrl: pub?.photoUrl ?? null,
      presence: pub?.presence ?? 'offline',
      group: false,
    };
  }
}

function oid(id: string) {
  return new Types.ObjectId(id);
}

function ids(row: CallDocument) {
  return row.participants.map((p) => String(p.user));
}

function seat(row: CallDocument, userId: string) {
  return row.participants.find((p) => String(p.user) === userId);
}

function sectionMeta(items: CallRecordDto[]) {
  const minutes = Math.round(items.reduce((sum, item) => sum + parseMmss(item.duration), 0) / 60);
  const n = items.length;
  const calls = `${n} call${n === 1 ? '' : 's'}`;
  return minutes > 0 ? `${calls} · ${minutes} minute${minutes === 1 ? '' : 's'} total` : calls;
}

function parseMmss(value?: string) {
  if (!value) return 0;
  const [m, s] = value.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
}
