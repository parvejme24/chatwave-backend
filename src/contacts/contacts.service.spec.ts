import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { BlocksService } from '../blocks/blocks.service';
import { ConversationsService } from '../conversations/conversations.service';
import { UsersService } from '../users/users.service';
import { CANNOT_ADD_SELF } from './contacts.constants';
import { ContactsService } from './contacts.service';
import { Contact } from './contact.schema';

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const C = '64a000000000000000000003';
const D = '64a000000000000000000004';
const CONV = '64b000000000000000000001';
const viewer = { id: A, isOwner: false };

function q<T>(value: T) {
  const query = {
    sort: jest.fn(),
    limit: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function person(id: string, overrides: Record<string, unknown> = {}) {
  const names: Record<string, { name: string; username: string }> = {
    [A]: { name: 'Ayesha Rahman', username: 'ayesha' },
    [B]: { name: 'Nadia Hasan', username: 'nadia' },
    [C]: { name: 'Farhan Ahmed', username: 'farhan' },
    [D]: { name: 'Rakib Islam', username: 'rakib' },
  };
  const base = names[id] ?? { name: 'ChatWave user', username: 'user' };
  return {
    id,
    name: base.name,
    username: base.username,
    initials: 'NH',
    tone: 'b',
    photoUrl: null,
    role: 'Product designer',
    location: 'Dhaka',
    status: 'active',
    deletedAt: null,
    settings: { showLastSeen: true, readReceipts: true },
    lastSeenAt: new Date('2026-08-25T08:14:00.000Z'),
    ...overrides,
  };
}

function row(personId: string, note = '') {
  return { owner: A, person: personId, note };
}

function body(err: unknown) {
  return err instanceof HttpException ? err.getResponse() : err;
}

describe('ContactsService', () => {
  let service: ContactsService;
  const model = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
  };
  const users = {
    findById: jest.fn(),
    findByIds: jest.fn(),
    findByUsername: jest.fn(),
    publicUser: jest.fn(),
    livePresence: jest.fn(),
  };
  const conversations = {
    getOrCreateDirect: jest.fn(),
    directIdsFor: jest.fn(),
    listDirectPeerIds: jest.fn(),
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') };

  beforeEach(async () => {
    jest.clearAllMocks();
    users.findById.mockImplementation(async (id: string) => person(id));
    users.findByIds.mockImplementation(async (ids: string[]) => ids.map((id) => person(id)));
    users.findByUsername.mockImplementation(async (username: string) =>
      username === 'nadia' ? person(B) : null,
    );
    users.publicUser.mockImplementation(async (_v: unknown, user: { id: string; name: string; username: string; role: string; location: string }) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      initials: 'NH',
      tone: 'b',
      photoUrl: null,
      role: user.role,
      location: user.location,
      presence: 'online',
      lastSeenAt: '2026-08-25T08:14:00.000Z',
      sub: `${user.role} · ${user.location}`,
    }));
    users.livePresence.mockResolvedValue('online');
    conversations.directIdsFor.mockResolvedValue(new Map());
    conversations.listDirectPeerIds.mockResolvedValue([]);
    conversations.getOrCreateDirect.mockResolvedValue({ created: true, conversation: { id: CONV } });
    model.deleteOne.mockReturnValue(q({ deletedCount: 1 }));
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: getModelToken(Contact.name), useValue: model },
        { provide: UsersService, useValue: users },
        { provide: ConversationsService, useValue: conversations },
        { provide: ConfigService, useValue: config },
        { provide: BlocksService, useValue: { assertNotBlocked: jest.fn(), restrictedIds: jest.fn() } },
      ],
    }).compile();
    service = module.get(ContactsService);
  });

  it('cannot add self', async () => {
    const err = await service.add(viewer, { userId: A }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(body(err)).toEqual({ error: CANNOT_ADD_SELF });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('returns the existing owner+person row instead of creating a second one', async () => {
    model.findOne.mockReturnValue(q(null));
    model.create.mockResolvedValue(row(B));
    const created = await service.add(viewer, { userId: B });
    expect(created.created).toBe(true);
    expect(created.contact.id).toBe(B);
    expect(model.create).toHaveBeenCalledTimes(1);

    model.findOne.mockReturnValue(q(row(B)));
    const again = await service.add(viewer, { username: 'nadia' });
    expect(again.created).toBe(false);
    expect(again.contact.id).toBe(B);
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('searches by name and username', async () => {
    model.find.mockReturnValue(q([row(B), row(C)]));
    const byName = await service.list(viewer, 'Hasan');
    expect(byName.contacts.map((item) => item.id)).toEqual([B]);
    const byUser = await service.list(viewer, 'farhan');
    expect(byUser.contacts.map((item) => item.id)).toEqual([C]);
    expect(byUser.total).toBe(2);
  });

  it('excludes banned users from GET list', async () => {
    model.find.mockReturnValue(q([row(B), row(C), row(D)]));
    users.findByIds.mockResolvedValue([
      person(B),
      person(C, { status: 'banned' }),
      person(D, { deletedAt: new Date() }),
    ]);
    const result = await service.list(viewer);
    expect(result.contacts.map((item) => item.id)).toEqual([B]);
    expect(result.total).toBe(1);
  });

  it('delete is idempotent', async () => {
    model.deleteOne.mockReturnValue(q({ deletedCount: 1 }));
    await expect(service.remove(viewer, B)).resolves.toEqual({ ok: true });
    model.deleteOne.mockReturnValue(q({ deletedCount: 0 }));
    await expect(service.remove(viewer, B)).resolves.toEqual({ ok: true });
    await expect(service.remove(viewer, 'not-an-id')).resolves.toEqual({ ok: true });
  });

  it('POST chat returns a direct conversation id', async () => {
    const result = await service.openChat(viewer, B);
    expect(conversations.getOrCreateDirect).toHaveBeenCalledWith(viewer, B);
    expect(result).toEqual({ conversationId: CONV, href: `/chats/${CONV}` });
  });
});
