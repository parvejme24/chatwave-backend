import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { BlocksService } from '../blocks/blocks.service';
import { MailService } from '../common/mail/mail.service';
import { RedisService } from '../common/redis/redis.service';
import { ChatGateway } from '../messages/messages.gateway';
import { UsersService } from '../users/users.service';
import { Notification } from './notification.schema';
import { OFFLINE_FOR_EMAIL_MS } from './notifications.constants';
import { NotificationsService } from './notifications.service';

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const CONV = '64b000000000000000000001';
const MSG = '64c000000000000000000001';
const viewer = { id: B, isOwner: false };

function person(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id === A ? 'Ayesha Rahman' : 'Nadia Hasan',
    email: id === A ? 'ayesha@example.com' : 'nadia@example.com',
    username: id === A ? 'ayesha' : 'nadia',
    initials: id === A ? 'AR' : 'NH',
    tone: 'b',
    photoUrl: null,
    status: 'active',
    deletedAt: null,
    lastSeenAt: new Date(Date.now() - OFFLINE_FOR_EMAIL_MS - 1000),
    settings: { messageNotifications: true, unreadDigest: false, missedCallEmails: true },
    ...overrides,
  };
}

function messageEvent(overrides: Record<string, unknown> = {}) {
  return {
    senderId: A,
    conversation: {
      id: CONV,
      type: 'direct',
      name: '',
      members: [
        { user: A, muted: false, leftAt: null },
        { user: B, muted: false, leftAt: null },
      ],
    },
    message: { id: MSG, type: 'text', text: 'hi', caption: '' },
    preview: 'hi',
    actorName: 'Ayesha Rahman',
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  const model = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    updateMany: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const users = { findById: jest.fn(), findActiveById: jest.fn(), publicUser: jest.fn() };
  const redis = {
    tooMany: jest.fn().mockResolvedValue(false),
    socketCount: jest.fn().mockResolvedValue(0),
    getLivePresence: jest.fn().mockResolvedValue(null),
    bumpUnreadDigest: jest.fn().mockResolvedValue(undefined),
    pendingDigestUserIds: jest.fn().mockResolvedValue([]),
    takeUnreadDigest: jest.fn(),
  };
  const mail = { sendMissedCall: jest.fn().mockResolvedValue(undefined), sendUnreadDigest: jest.fn().mockResolvedValue(undefined) };
  const blocks = { isBlocked: jest.fn().mockResolvedValue(false) };
  const chat = {
    isInConversation: jest.fn().mockResolvedValue(false),
    emitNotification: jest.fn(),
    emitBadge: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    users.findById.mockImplementation(async (id: string) => person(id));
    users.findActiveById.mockImplementation(async (id: string) => person(id));
    users.publicUser.mockImplementation(async (_v: unknown, user: { id: string; name: string; username: string }) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      initials: 'NH',
      tone: 'b',
      photoUrl: null,
    }));
    model.create.mockImplementation(async (doc: Record<string, unknown>) => ({
      id: '64e000000000000000000001',
      createdAt: new Date(),
      readAt: null,
      href: '',
      body: '',
      actor: doc.actor ?? null,
      conversation: doc.conversation ?? null,
      message: doc.message ?? null,
      ...doc,
    }));
    model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
    model.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: model },
        { provide: UsersService, useValue: users },
        { provide: RedisService, useValue: redis },
        { provide: MailService, useValue: mail },
        { provide: BlocksService, useValue: blocks },
        { provide: ChatGateway, useValue: chat },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('skips muted members', async () => {
    await service.onMessageCreated(
      messageEvent({
        conversation: {
          id: CONV,
          type: 'direct',
          name: '',
          members: [
            { user: A, muted: false, leftAt: null },
            { user: B, muted: true, leftAt: null },
          ],
        },
      }),
    );
    expect(model.create).not.toHaveBeenCalled();
  });

  it('skips when messageNotifications is false', async () => {
    users.findById.mockImplementation(async (id: string) =>
      person(id, id === B ? { settings: { messageNotifications: false, unreadDigest: false, missedCallEmails: true } } : {}),
    );
    await service.onMessageCreated(messageEvent());
    expect(model.create).not.toHaveBeenCalled();
  });

  it('does not notify the sender', async () => {
    await service.notify({ userId: A, actorId: A, type: 'message', title: 'x' });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('digest cron sends one email', async () => {
    redis.pendingDigestUserIds.mockResolvedValue([B]);
    users.findActiveById.mockResolvedValue(person(B, { settings: { unreadDigest: true, messageNotifications: true, missedCallEmails: true } }));
    redis.takeUnreadDigest.mockResolvedValue({ count: 3, preview: 'Agreed on the timing' });
    await service.sendDigests();
    expect(mail.sendUnreadDigest).toHaveBeenCalledTimes(1);
    expect(mail.sendUnreadDigest).toHaveBeenCalledWith('nadia@example.com', 'Nadia Hasan', 3, 'Agreed on the timing');
  });

  it('sends missed-call email only if offline for 30 minutes', async () => {
    await service.maybeEmailMissedCall(B, 'Missed voice call', '64e000000000000000000001');
    expect(mail.sendMissedCall).toHaveBeenCalledTimes(1);

    mail.sendMissedCall.mockClear();
    redis.socketCount.mockResolvedValue(1);
    await service.maybeEmailMissedCall(B, 'Missed voice call', '64e000000000000000000001');
    expect(mail.sendMissedCall).not.toHaveBeenCalled();

    redis.socketCount.mockResolvedValue(0);
    users.findById.mockResolvedValue(person(B, { lastSeenAt: new Date() }));
    await service.maybeEmailMissedCall(B, 'Missed voice call', '64e000000000000000000001');
    expect(mail.sendMissedCall).not.toHaveBeenCalled();
  });

  it('marks all read', async () => {
    model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
    await expect(service.markRead(viewer)).resolves.toEqual({ unreadCount: 0 });
    expect(model.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ readAt: null }),
      expect.objectContaining({ $set: expect.objectContaining({ readAt: expect.any(Date) }) }),
    );
    expect(chat.emitBadge).toHaveBeenCalledWith(B, 0);
  });
});
