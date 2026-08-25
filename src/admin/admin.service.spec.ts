import { BadRequestException, HttpException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { MailService } from '../common/mail/mail.service';
import { RedisService } from '../common/redis/redis.service';
import { Call } from '../calls/call.schema';
import { Conversation } from '../conversations/conversation.schema';
import { ChatGateway } from '../messages/messages.gateway';
import { Message } from '../messages/message.schema';
import { User } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { CANNOT_MODERATE_OWNER } from './admin.constants';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';

const OWNER = '64a000000000000000000001';
const NADIA = '64a000000000000000000002';
const actor = { id: OWNER, isOwner: true };

function q<T>(value: T) {
  const query = { sort: jest.fn(), limit: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function person(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id === NADIA ? 'Nadia Hasan' : 'Ayesha Rahman',
    username: id === NADIA ? 'nadia' : 'ayesha',
    email: id === NADIA ? 'nadia@chatwave.app' : 'ayesha@chatwave.app',
    initials: id === NADIA ? 'NH' : 'AR',
    tone: 'b',
    photoUrl: null,
    presence: 'online',
    lastSeenAt: new Date('2026-03-12T14:14:00.000Z'),
    status: 'active',
    deletedAt: null,
    isOwner: id === OWNER,
    createdAt: new Date('2026-03-12T08:00:00.000Z'),
    ...overrides,
  };
}

function body(err: unknown) {
  return err instanceof HttpException ? err.getResponse() : err;
}

describe('AdminService', () => {
  let service: AdminService;
  const users = {
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
  };
  const messages = { find: jest.fn() };
  const calls = { find: jest.fn() };
  const conversations = { find: jest.fn() };
  const accounts = {
    livePresence: jest.fn().mockResolvedValue('online'),
    banAccount: jest.fn(),
    unbanAccount: jest.fn(),
    adminDelete: jest.fn(),
  };
  const redis = { deleteAllSessions: jest.fn().mockResolvedValue(undefined) };
  const audit = {
    log: jest.fn().mockResolvedValue(undefined),
    listForUser: jest.fn().mockResolvedValue([]),
  };
  const mail = { sendAccountBanned: jest.fn().mockResolvedValue(undefined) };
  const chat = { kickBanned: jest.fn().mockResolvedValue(undefined) };

  function emptyHistory() {
    messages.find.mockReturnValue(q([]));
    calls.find.mockReturnValue(q([]));
    conversations.find.mockReturnValue(q([]));
    audit.listForUser.mockResolvedValue([]);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    emptyHistory();
    users.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: users },
        { provide: getModelToken(Message.name), useValue: messages },
        { provide: getModelToken(Call.name), useValue: calls },
        { provide: getModelToken(Conversation.name), useValue: conversations },
        { provide: UsersService, useValue: accounts },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
        { provide: MailService, useValue: mail },
        { provide: ChatGateway, useValue: chat },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  it('cannot ban the owner', async () => {
    users.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(person(OWNER)) });
    const err = await service.ban(actor, OWNER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(body(err)).toEqual({ error: CANNOT_MODERATE_OWNER });
    expect(accounts.banAccount).not.toHaveBeenCalled();
    expect(redis.deleteAllSessions).not.toHaveBeenCalled();
  });

  it('ban revokes sessions', async () => {
    const nadia = person(NADIA);
    const banned = person(NADIA, { status: 'banned' });
    users.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(nadia) });
    accounts.banAccount.mockResolvedValue(banned);
    const result = await service.ban(actor, NADIA);
    expect(accounts.banAccount).toHaveBeenCalledWith(NADIA);
    expect(redis.deleteAllSessions).toHaveBeenCalledWith(NADIA);
    expect(chat.kickBanned).toHaveBeenCalledWith(NADIA);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ban', user: NADIA, actor: OWNER }));
    expect(mail.sendAccountBanned).toHaveBeenCalledWith(banned.email, banned.name);
    expect(result.user.status).toBe('banned');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('unban restores a banned user', async () => {
    const banned = person(NADIA, { status: 'banned' });
    const active = person(NADIA, { status: 'active' });
    users.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(banned) });
    accounts.unbanAccount.mockResolvedValue(active);
    const result = await service.unban(actor, NADIA);
    expect(accounts.unbanAccount).toHaveBeenCalledWith(NADIA);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unban', title: 'Account unbanned' }));
    expect(result.user.status).toBe('active');
  });

  it('delete hides the user from the default list', async () => {
    const nadia = person(NADIA);
    users.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(nadia) });
    accounts.adminDelete.mockResolvedValue(person(NADIA, { deletedAt: new Date(), status: 'banned' }));
    await expect(service.remove(actor, NADIA)).resolves.toEqual({ ok: true });
    expect(accounts.adminDelete).toHaveBeenCalledWith(NADIA);
    expect(redis.deleteAllSessions).toHaveBeenCalledWith(NADIA);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ kind: 'delete' }));

    users.find.mockReturnValue(q([]));
    users.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
    await service.list({ status: 'all', limit: 50, includeDeleted: false });
    expect(users.find).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: null }));
  });

  it('searches by email', async () => {
    users.find.mockReturnValue(q([person(NADIA)]));
    users.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(1) });
    const result = await service.list({ q: 'nadia@chatwave.app', status: 'all', limit: 50, includeDeleted: false });
    const filter = users.find.mock.calls[0][0] as { $or: Array<Record<string, unknown>>; deletedAt: null };
    expect(filter.deletedAt).toBeNull();
    expect(filter.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: expect.any(RegExp) }),
        expect.objectContaining({ name: expect.any(RegExp) }),
        expect.objectContaining({ username: expect.any(RegExp) }),
      ]),
    );
    expect((filter.$or.find((item) => 'email' in item)?.email as RegExp).test('nadia@chatwave.app')).toBe(true);
    expect(result.users[0]?.email).toBe('nadia@chatwave.app');
    expect(result.users[0]?.user).toBe('nadia');
  });
});
