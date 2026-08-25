import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { UsersService } from '../users/users.service';
import { Block } from './block.schema';
import { CANNOT_BLOCK_SELF, CHAT_REALTIME, CONTACTS_ACTIONS, MESSAGE_BLOCKED } from './blocks.constants';
import { BlocksService } from './blocks.service';

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const viewer = { id: A, isOwner: false };

function q<T>(value: T) {
  const query = { sort: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.sort.mockReturnValue(query);
  return query;
}

function person(id: string) {
  return {
    id,
    name: id === B ? 'Nadia Hasan' : 'Ayesha Rahman',
    username: id === B ? 'nadia' : 'ayesha',
    initials: 'NH',
    tone: 'b',
    photoUrl: null,
    status: 'active',
    deletedAt: null,
  };
}

function body(err: unknown) {
  return err instanceof HttpException ? err.getResponse() : err;
}

describe('BlocksService', () => {
  let service: BlocksService;
  const model = { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn() };
  const users = { findById: jest.fn(), findByIds: jest.fn(), findByUsername: jest.fn(), publicUser: jest.fn() };
  const contacts = { remove: jest.fn().mockResolvedValue({ ok: true }) };
  const realtime = { emitBlocked: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    users.findById.mockImplementation(async (id: string) => person(id));
    users.findByUsername.mockImplementation(async (username: string) => (username === 'nadia' ? person(B) : null));
    users.publicUser.mockImplementation(async (_v: unknown, user: { id: string; name: string; username: string }) => ({
      ...user,
      initials: 'NH',
      tone: 'b',
      photoUrl: null,
    }));
    model.deleteOne.mockReturnValue(q({ deletedCount: 1 }));
    const module = await Test.createTestingModule({
      providers: [
        BlocksService,
        { provide: getModelToken(Block.name), useValue: model },
        { provide: UsersService, useValue: users },
        { provide: CONTACTS_ACTIONS, useValue: contacts },
        { provide: CHAT_REALTIME, useValue: realtime },
      ],
    }).compile();
    service = module.get(BlocksService);
  });

  it('cannot block self', async () => {
    const err = await service.add(viewer, { userId: A }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(body(err)).toEqual({ error: CANNOT_BLOCK_SELF });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('returns the existing blocker+blocked row instead of creating a second one', async () => {
    model.findOne.mockReturnValue(q(null));
    model.create.mockResolvedValue({ blocker: A, blocked: B, createdAt: new Date() });
    const created = await service.add(viewer, { userId: B });
    expect(created.created).toBe(true);
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(contacts.remove).toHaveBeenCalled();
    expect(realtime.emitBlocked).toHaveBeenCalledWith(A, B);

    model.findOne.mockReturnValue(q({ blocker: A, blocked: B, createdAt: new Date() }));
    const again = await service.add(viewer, { username: 'nadia' });
    expect(again.created).toBe(false);
    expect(again.block.id).toBe(B);
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('isBlocked is true in both directions', async () => {
    model.findOne.mockReturnValue(q({ blocker: A, blocked: B }));
    expect(await service.isBlocked(A, B)).toBe(true);
    expect(await service.isBlocked(B, A)).toBe(true);
    expect(await service.isBlockedBy(A, B)).toBe(true);
  });

  it('delete is idempotent', async () => {
    model.deleteOne.mockReturnValue(q({ deletedCount: 1 }));
    await expect(service.remove(viewer, B)).resolves.toEqual({ ok: true });
    model.deleteOne.mockReturnValue(q({ deletedCount: 0 }));
    await expect(service.remove(viewer, B)).resolves.toEqual({ ok: true });
    await expect(service.remove(viewer, 'not-an-id')).resolves.toEqual({ ok: true });
  });

  it('assertNotBlocked throws 403', async () => {
    model.findOne.mockReturnValue(q({ blocker: A, blocked: B }));
    const err = await service.assertNotBlocked(A, B).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(body(err)).toEqual({ error: MESSAGE_BLOCKED });
  });
});
