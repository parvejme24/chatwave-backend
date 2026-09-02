import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { BlocksService } from '../blocks/blocks.service';
import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { Message } from '../messages/message.schema';
import { UsersService } from '../users/users.service';
import { Conversation } from './conversation.schema';
import { ConversationsService } from './conversations.service';

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const C = '64a000000000000000000003';
const viewer = { id: A, isOwner: false };

function q<T>(value: T) {
  const query = { sort: jest.fn(), limit: jest.fn(), select: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

function member(user: string, extra: Record<string, unknown> = {}) {
  return {
    user,
    role: 'member',
    pinned: false,
    muted: false,
    archived: false,
    unreadCount: 0,
    leftAt: null,
    ...extra,
  };
}

function convo(overrides: Record<string, unknown> = {}) {
  return {
    id: '64b000000000000000000001',
    _id: '64b000000000000000000001',
    type: 'direct',
    name: '',
    initials: '',
    tone: 'e',
    photo: null,
    createdBy: A,
    members: [member(A), member(B)],
    lastMessageAt: new Date('2026-08-25T13:48:00.000Z'),
    preview: '',
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ConversationsService', () => {
  let service: ConversationsService;
  const model = {
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
  };
  const messages = { deleteMany: jest.fn() };
  const users = { findActiveById: jest.fn(), findByIds: jest.fn(), publicUser: jest.fn(), publicUsers: jest.fn() };
  const blocks = { assertNotBlocked: jest.fn(), restrictedIds: jest.fn() };
  const moduleRef = { get: jest.fn() };
  const cloudinary = { uploadAvatar: jest.fn(), deleteAsset: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    users.findActiveById.mockResolvedValue({ id: B, status: 'active', deletedAt: null });
    users.findByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, name: id === B ? 'Nadia Hasan' : 'Ayesha Rahman', username: id === B ? 'nadia' : 'ayesha' })),
    );
    users.publicUser.mockImplementation(async (_v: unknown, user: { id: string; name: string; username: string }) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      initials: 'NH',
      tone: 'b',
      photoUrl: null,
      presence: 'online',
      sub: 'Designer · Dhaka',
    }));
    users.publicUsers.mockImplementation(async (viewer: unknown, docs: Array<{ id: string; name: string; username: string }>) =>
      Promise.all(docs.map((doc) => users.publicUser(viewer, doc))),
    );
    blocks.assertNotBlocked.mockResolvedValue(undefined);
    blocks.restrictedIds.mockResolvedValue(new Set());
    messages.deleteMany.mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) });
    model.deleteOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 1 }) });
    moduleRef.get.mockImplementation(() => {
      throw new Error('not found');
    });
    const module = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: getModelToken(Conversation.name), useValue: model },
        { provide: getModelToken(Message.name), useValue: messages },
        { provide: UsersService, useValue: users },
        { provide: BlocksService, useValue: blocks },
        { provide: ModuleRef, useValue: moduleRef },
        { provide: CloudinaryService, useValue: cloudinary },
      ],
    }).compile();
    service = module.get(ConversationsService);
  });

  it('rejects a group with fewer than 3 other people', async () => {
    await expect(service.createGroup(viewer, 'Frontend Guild', [B])).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('returns the existing direct chat instead of creating a second one', async () => {
    const existing = convo();
    model.findOne.mockReturnValue(q(existing));
    const result = await service.createDirect(viewer, B);
    expect(result.created).toBe(false);
    expect(result.conversation.id).toBe(existing.id);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('forbids creating a direct chat when blocked', async () => {
    blocks.assertNotBlocked.mockRejectedValue(
      new ForbiddenException({ error: "You can't message this person. One of you has blocked the other." }),
    );
    await expect(service.createDirect(viewer, B)).rejects.toBeInstanceOf(ForbiddenException);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('pins only the current member', async () => {
    const row = convo({ members: [member(A), member(B)] });
    model.findById.mockReturnValue(q(row));
    await service.updateMembership(viewer, row.id, { pinned: true });
    expect(row.members[0].pinned).toBe(true);
    expect(row.members[1].pinned).toBe(false);
  });

  it('hides an empty direct chat after unfollow', async () => {
    const row = convo({ lastMessage: null, save: jest.fn().mockResolvedValue(undefined) });
    model.findOne.mockReturnValue(q(row));
    await expect(service.hideDirectIfEmpty(A, B)).resolves.toBe(true);
    expect(row.members[0].leftAt).toBeInstanceOf(Date);
  });

  it('does not hide a chat that already has messages', async () => {
    const row = convo({ lastMessage: '64c000000000000000000001' });
    model.findOne.mockReturnValue(q(row));
    await expect(service.hideDirectIfEmpty(A, B)).resolves.toBe(false);
    expect(row.members[0].leftAt).toBeNull();
  });

  it('deletes a direct conversation and its messages for everyone', async () => {
    const row = convo();
    model.findById.mockReturnValue(q(row));
    const result = await service.deleteConversation(viewer, row.id);
    expect(result.ok).toBe(true);
    expect(result.peerId).toBe(B);
    expect(messages.deleteMany).toHaveBeenCalled();
    expect(model.deleteOne).toHaveBeenCalled();
  });
});
