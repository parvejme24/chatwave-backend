import { ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { RedisService } from '../common/redis/redis.service';
import { ConversationsService } from '../conversations/conversations.service';
import { UsersService } from '../users/users.service';
import { Message } from './message.schema';
import { MessagesService } from './messages.service';

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const CONV = '64b000000000000000000001';
const MSG = '64c000000000000000000001';
const viewer = { id: A, isOwner: false };

function q<T>(value: T) {
  const query = { sort: jest.fn(), limit: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function convo() {
  return {
    id: CONV,
    _id: CONV,
    type: 'direct',
    members: [
      { user: A, role: 'member', leftAt: null, unreadCount: 0 },
      { user: B, role: 'member', leftAt: null, unreadCount: 0 },
    ],
    lastMessageAt: new Date('2026-08-25T14:12:00.000Z'),
  };
}

function msg(overrides: Record<string, unknown> = {}) {
  return {
    id: MSG,
    conversation: CONV,
    sender: A,
    type: 'text',
    text: 'hello',
    caption: '',
    media: { url: '', publicId: '', fileName: '', fileSize: '', mimeType: '', duration: 0, seed: 0, width: 0, height: 0 },
    replyTo: null,
    reactions: [] as Array<{ emoji: string; users: string[] }>,
    pinned: false,
    pinnedBy: null,
    pinnedAt: null,
    receipts: [{ user: A, status: 'sent', at: new Date() }],
    deletedAt: null,
    deletedBy: null,
    deletedFor: [] as string[],
    createdAt: new Date('2026-08-25T14:12:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
    ...overrides,
  };
}

describe('MessagesService', () => {
  let service: MessagesService;
  const model = { find: jest.fn(), findById: jest.fn(), create: jest.fn() };
  const conversations = {
    assertMember: jest.fn(),
    bumpFromMessage: jest.fn(),
    resetUnread: jest.fn(),
    getById: jest.fn(),
    activeMemberIds: jest.fn((row: { members: Array<{ user: string; leftAt: Date | null }> }) =>
      row.members.filter((m) => !m.leftAt).map((m) => String(m.user)),
    ),
    unreadOf: jest.fn().mockReturnValue(0),
    isGroupAdmin: jest.fn().mockReturnValue(false),
  };
  const users = { findActiveById: jest.fn(), findByIds: jest.fn(), findById: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    conversations.assertMember.mockResolvedValue(convo());
    conversations.getById.mockResolvedValue(convo());
    users.findByIds.mockResolvedValue([{ id: A, name: 'Rakib Islam', username: 'rakib', initials: 'RI', tone: 'c', photoUrl: null }]);
    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: getModelToken(Message.name), useValue: model },
        { provide: ConversationsService, useValue: conversations },
        { provide: UsersService, useValue: users },
        { provide: CloudinaryService, useValue: { uploadFile: jest.fn(), deleteAsset: jest.fn() } },
        { provide: RedisService, useValue: { tooMany: jest.fn().mockResolvedValue(false) } },
      ],
    }).compile();
    service = module.get(MessagesService);
  });

  it('filters thread search with a text index query', async () => {
    model.find.mockReturnValue(q([]));
    await service.list(viewer, CONV, { q: 'waveform' });
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ $text: { $search: 'waveform' }, deletedAt: null }));
  });

  it('filters pinned messages when view=pinned', async () => {
    model.find.mockReturnValue(q([]));
    await service.list(viewer, CONV, { view: 'pinned' });
    expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ pinned: true }));
  });

  it('toggles a reaction on and off', async () => {
    const row = msg();
    model.findById.mockReturnValue(q(row));
    await service.toggleReaction(viewer, MSG, '🔥');
    expect(row.reactions).toEqual([{ emoji: '🔥', users: [expect.anything()] }]);
    await service.toggleReaction(viewer, MSG, '🔥');
    expect(row.reactions).toEqual([]);
  });

  it('pins and unpins a message', async () => {
    const row = msg();
    model.findById.mockReturnValue(q(row));
    expect((await service.togglePin(viewer, MSG)).pinned).toBe(true);
    expect((await service.togglePin(viewer, MSG)).pinned).toBe(false);
    expect(row.pinnedBy).toBeNull();
  });

  it('hides a message for me without deleting it for everyone', async () => {
    const row = msg();
    model.findById.mockReturnValue(q(row));
    await service.remove(viewer, MSG, 'me');
    expect(row.deletedAt).toBeNull();
    expect(row.deletedFor.map(String)).toContain(A);
  });

  it('lets the sender delete a message for everyone', async () => {
    const row = msg();
    model.findById.mockReturnValue(q(row));
    await service.remove(viewer, MSG, 'everyone');
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  it('forbids delete-for-everyone when the viewer is not the sender or a group admin', async () => {
    const row = msg({ sender: B });
    model.findById.mockReturnValue(q(row));
    await expect(service.remove(viewer, MSG, 'everyone')).rejects.toBeInstanceOf(ForbiddenException);
    expect(row.deletedAt).toBeNull();
  });

  it('returns 403 when the viewer is not an active member', async () => {
    conversations.assertMember.mockRejectedValue(new ForbiddenException({ error: 'You cannot access this chat' }));
    await expect(service.list(viewer, CONV, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(model.find).not.toHaveBeenCalled();
  });
});
