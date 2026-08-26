import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { RedisService } from '../common/redis/redis.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';
import { Call } from './call.schema';
import { callDirection } from './calls.constants';
import { CallsRealtime } from './calls.realtime';
import { CallsService } from './calls.service';

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const CONV = '64b000000000000000000001';
const CALL = '64d000000000000000000001';
const caller = { id: A, isOwner: false };
const callee = { id: B, isOwner: false };

function q<T>(value: T) {
  const query = { sort: jest.fn(), limit: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function convo() {
  return { id: CONV, type: 'direct', name: '', initials: '', tone: 'e', photo: null, members: [{ user: A, leftAt: null }, { user: B, leftAt: null }] };
}

function callDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: CALL,
    conversation: CONV,
    type: 'video',
    status: 'ringing',
    initiatedBy: A,
    ice: 'unknown',
    durationSec: 0,
    startedAt: new Date('2026-08-25T10:00:00.000Z'),
    answeredAt: null,
    endedAt: null,
    endedBy: null,
    participants: [
      { user: A, direction: 'out', joinedAt: new Date('2026-08-25T10:00:00.000Z'), leftAt: null },
      { user: B, direction: 'in', joinedAt: null, leftAt: null },
    ],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('CallsService', () => {
  let service: CallsService;
  const model = { find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), create: jest.fn() };
  const conversations = {
    assertMember: jest.fn(),
    getById: jest.fn(),
    activeMemberIds: jest.fn((row: { members: Array<{ user: string; leftAt: Date | null }> }) =>
      row.members.filter((m) => !m.leftAt).map((m) => String(m.user)),
    ),
  };
  const users = { findByIds: jest.fn(), findById: jest.fn(), publicUser: jest.fn() };
  const messages = { sendCallLog: jest.fn(), updateCallLog: jest.fn() };
  const redis = {
    setCallRing: jest.fn(),
    clearCallRing: jest.fn(),
    setCallBusy: jest.fn(),
    getCallBusy: jest.fn(),
    clearCallBusy: jest.fn(),
    socketCount: jest.fn(),
  };
  const realtime = {
    emitIncoming: jest.fn(),
    emitStarted: jest.fn(),
    emitAccepted: jest.fn(),
    emitDeclined: jest.fn(),
    emitEnded: jest.fn(),
    emitMissed: jest.fn(),
    emitParticipant: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    conversations.assertMember.mockResolvedValue(convo());
    conversations.getById.mockResolvedValue(convo());
    users.findByIds.mockResolvedValue([{ id: B, status: 'active', deletedAt: null, name: 'Nadia Hasan' }]);
    users.findById.mockResolvedValue({ id: B, name: 'Nadia Hasan', username: 'nadia' });
    users.publicUser.mockResolvedValue({ id: B, name: 'Nadia Hasan', username: 'nadia', initials: 'NH', tone: 'b', photoUrl: null, presence: 'online' });
    messages.sendCallLog.mockResolvedValue(null);
    messages.updateCallLog.mockResolvedValue(null);
    redis.getCallBusy.mockResolvedValue(null);
    redis.socketCount.mockResolvedValue(0);
    model.find.mockReturnValue(q([]));
    model.findOne.mockReturnValue(q(null));
    const module = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: getModelToken(Call.name), useValue: model },
        { provide: ConversationsService, useValue: conversations },
        { provide: UsersService, useValue: users },
        { provide: MessagesService, useValue: messages },
        { provide: RedisService, useValue: redis },
        { provide: CallsRealtime, useValue: realtime },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'CALL_RING_TIMEOUT_MS' ? 35000 : key === 'STUN_URL' ? 'stun:stun.l.google.com:19302' : '') },
        },
      ],
    }).compile();
    service = module.get(CallsService);
  });

  it('maps direction for the viewer', () => {
    expect(callDirection('missed', A, B)).toBe('missed');
    expect(callDirection('declined', A, B)).toBe('missed');
    expect(callDirection('declined', A, A)).toBe('out');
    expect(callDirection('ended', A, A)).toBe('out');
    expect(callDirection('ended', A, B)).toBe('in');
  });

  it('cannot start a second call', async () => {
    model.findOne.mockReturnValue(q(callDoc()));
    await expect(service.start(caller, CONV, 'video')).rejects.toBeInstanceOf(ConflictException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('returns 403 when the viewer is not a member', async () => {
    conversations.assertMember.mockRejectedValue(new ForbiddenException({ error: 'You cannot access this chat' }));
    await expect(service.start(caller, CONV, 'audio')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('declines a 1:1 ringing call', async () => {
    const row = callDoc();
    model.findById.mockReturnValue(q(row));
    await service.decline(callee, CALL);
    expect(row.status).toBe('declined');
    expect(row.participants[1]?.leftAt).toBeInstanceOf(Date);
    expect(realtime.emitDeclined).toHaveBeenCalled();
  });

  it('marks a ringing call missed after timeout', async () => {
    const row = callDoc({ startedAt: new Date(Date.now() - 40_000) });
    model.find.mockReturnValue(q([row]));
    await service.expireRings();
    expect(row.status).toBe('missed');
    expect(realtime.emitMissed).toHaveBeenCalled();
    expect(messages.updateCallLog).toHaveBeenCalledWith(CALL, expect.objectContaining({ missed: true }));
  });

  it('hangup ends the call for everyone and lets a new call start', async () => {
    const row = callDoc({ status: 'active', answeredAt: new Date('2026-08-25T10:00:05.000Z') });
    model.findById.mockReturnValue(q(row));
    await service.end(caller, CALL);
    expect(row.status).toBe('ended');
    expect(row.endedBy).toEqual(expect.anything());
    expect(row.participants.every((p) => p.leftAt)).toBe(true);
    expect(redis.clearCallBusy).toHaveBeenCalledWith(A);
    expect(redis.clearCallBusy).toHaveBeenCalledWith(B);
    expect(realtime.emitEnded).toHaveBeenCalledWith(
      CONV,
      [A, B],
      expect.objectContaining({ callId: CALL, conversationId: CONV, status: 'ended', endedBy: A }),
    );

    model.find.mockReturnValue(q([]));
    model.findOne.mockReturnValue(q(null));
    model.create.mockResolvedValue(callDoc());
    await expect(service.start(caller, CONV, 'video')).resolves.toEqual(expect.objectContaining({ call: expect.any(Object) }));
    expect(model.create).toHaveBeenCalled();
  });

  it('re-emits call:ended when hangup arrives after the call already finished', async () => {
    const row = callDoc({ status: 'ended', endedBy: A, durationSec: 12 });
    model.findById.mockReturnValue(q(row));
    await service.end(callee, CALL);
    expect(row.save).not.toHaveBeenCalled();
    expect(realtime.emitEnded).toHaveBeenCalledWith(
      CONV,
      [A, B],
      expect.objectContaining({ callId: CALL, endedBy: A, durationSec: 12 }),
    );
  });

  it('hangupAllForUser closes leftover ringing calls', async () => {
    const row = callDoc();
    model.find.mockReturnValue(q([row]));
    await service.hangupAllForUser(A);
    expect(row.status).toBe('missed');
    expect(realtime.emitEnded).toHaveBeenCalledWith(
      CONV,
      [A, B],
      expect.objectContaining({ callId: CALL, endedBy: A, status: 'missed' }),
    );
    expect(redis.clearCallBusy).toHaveBeenCalledWith(A);
    expect(redis.clearCallBusy).toHaveBeenCalledWith(B);
  });

  it('clears a stale Redis busy lock so the next call is not blocked', async () => {
    redis.getCallBusy.mockResolvedValue(CALL);
    model.findOne.mockReturnValue(q(null));
    model.findById.mockReturnValue(q(callDoc({ status: 'ended' })));
    model.create.mockResolvedValue(callDoc());
    await expect(service.start(caller, CONV, 'audio')).resolves.toEqual(expect.objectContaining({ call: expect.any(Object) }));
    expect(redis.clearCallBusy).toHaveBeenCalled();
    expect(model.create).toHaveBeenCalled();
  });

  it('filters history by missed, voice, and video', async () => {
    await service.list(caller, 'missed');
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ $or: expect.any(Array) }));
    await service.list(caller, 'voice');
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ type: 'audio' }));
    await service.list(caller, 'video');
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ type: 'video' }));
  });
});
