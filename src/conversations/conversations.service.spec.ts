import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { BlocksService } from '../blocks/blocks.service';
import { UsersService } from '../users/users.service';
import { Conversation } from './conversation.schema';
import { ConversationsService } from './conversations.service';

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const C = '64a000000000000000000003';
const viewer = { id: A, isOwner: false };

function q<T>(value: T) {
  const query = { sort: jest.fn(), limit: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
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
  const model = { find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), create: jest.fn() };
  const users = { findActiveById: jest.fn(), findByIds: jest.fn(), publicUser: jest.fn() };
  const blocks = { assertNotBlocked: jest.fn(), restrictedIds: jest.fn() };

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
    blocks.assertNotBlocked.mockResolvedValue(undefined);
    blocks.restrictedIds.mockResolvedValue(new Set());
    const module = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: getModelToken(Conversation.name), useValue: model },
        { provide: UsersService, useValue: users },
        { provide: BlocksService, useValue: blocks },
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
    blocks.assertNotBlocked.mockRejectedValue(new ForbiddenException({ error: 'You cannot message this person' }));
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

  it('returns 404 when the viewer is not a member', async () => {
    model.findById.mockReturnValue(q(convo({ members: [member(B), member(C)] })));
    await expect(service.getOne(viewer, '64b000000000000000000001')).rejects.toBeInstanceOf(NotFoundException);
  });
});
