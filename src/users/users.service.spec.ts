import { ConflictException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { RedisService } from '../common/redis/redis.service';
import { User, UserDocument } from './user.schema';
import { initialsFromName, isManagedUserHidden } from './users.constants';
import { UsersService } from './users.service';

function q<T>(value: T) {
  const query = { select: jest.fn(), limit: jest.fn(), sort: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.select.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  return query;
}

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-2',
    name: 'Nadia Hasan',
    email: 'nadia@example.com',
    username: 'nadia',
    initials: 'NH',
    tone: 'b',
    photoUrl: null,
    role: 'Product designer',
    location: 'Dhaka',
    isOwner: false,
    presence: 'online',
    lastSeenAt: new Date('2026-08-25T08:14:00.000Z'),
    status: 'active',
    deletedAt: null,
    settings: { showLastSeen: true, readReceipts: true },
    providers: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('UsersService', () => {
  let service: UsersService;
  const userModel = { find: jest.fn(), findOne: jest.fn(), findById: jest.fn() };
  const redis = { getLivePresence: jest.fn().mockResolvedValue('online') };

  beforeEach(async () => {
    jest.clearAllMocks();
    redis.getLivePresence.mockResolvedValue('online');
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: RedisService, useValue: redis },
        { provide: CloudinaryService, useValue: {} },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('builds initials from one or two words', () => {
    expect(initialsFromName('Parvej')).toBe('PA');
    expect(initialsFromName('Md Parvej')).toBe('MP');
  });

  it('hides banned and deleted users', () => {
    expect(isManagedUserHidden({ status: 'banned', deletedAt: null })).toBe(true);
    expect(isManagedUserHidden({ status: 'active', deletedAt: new Date() })).toBe(true);
    expect(isManagedUserHidden({ status: 'active', deletedAt: null })).toBe(false);
  });

  it('rejects a taken username', async () => {
    const me = doc({ id: 'user-1', username: 'parvej' });
    userModel.findById.mockReturnValue(q(me));
    userModel.findOne.mockReturnValue(q(doc({ username: 'nadia' })));
    await expect(service.updateMe('user-1', { username: 'nadia' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(me.save).not.toHaveBeenCalled();
  });

  it('hides banned users from search', async () => {
    userModel.find.mockReturnValue(
      q([
        doc({ id: 'user-2', status: 'active', deletedAt: null }),
        doc({ id: 'user-3', status: 'banned' }),
        doc({ id: 'user-4', deletedAt: new Date() }),
      ]),
    );
    const result = await service.search({ id: 'user-1', isOwner: false }, 'user');
    expect(userModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', deletedAt: null, _id: { $ne: 'user-1' } }),
    );
    expect(result.users.map((u) => u.id)).toEqual(['user-2']);
  });

  it('hides lastSeen when showLastSeen is false', async () => {
    const user = doc({
      settings: { showLastSeen: false, readReceipts: true },
    }) as unknown as UserDocument;
    const hidden = await service.publicUser({ id: 'user-1', isOwner: false }, user);
    expect(hidden.lastSeenAt).toBeNull();
    expect(hidden.presence).toBe('offline');
    const self = await service.publicUser({ id: 'user-2', isOwner: false }, user);
    expect(self.lastSeenAt).toBe('2026-08-25T08:14:00.000Z');
  });
});
