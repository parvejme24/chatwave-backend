import { Test } from '@nestjs/testing';
import type { Response } from 'express';

import { AuthService } from '../auth/auth.service';
import { RedisService } from '../common/redis/redis.service';
import { SessionsService } from './sessions.service';

const A = '64a000000000000000000001';
const CURRENT = 'sess-current';
const OTHER = 'sess-other';
const viewer = { id: A, isOwner: false };

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId: A,
    createdAt: '2026-08-25T10:00:00.000Z',
    lastActiveAt: extra.lastActiveAt ?? '2026-08-25T11:00:00.000Z',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
    ip: '203.0.113.10',
    platform: 'web',
    device: 'Chrome on Linux',
    browser: 'Chrome',
    city: 'Dhaka',
    country: 'Bangladesh',
    ...extra,
  };
}

describe('SessionsService', () => {
  let service: SessionsService;
  const redis = {
    listUserSessions: jest.fn(),
    getSession: jest.fn(),
    deleteSession: jest.fn(),
    deleteAllSessions: jest.fn(),
  };
  const auth = { logout: jest.fn().mockResolvedValue({ ok: true }) };
  const res = { clearCookie: jest.fn(), cookie: jest.fn() } as unknown as Response;

  beforeEach(async () => {
    jest.clearAllMocks();
    redis.listUserSessions.mockResolvedValue([
      row(OTHER, { lastActiveAt: '2026-08-25T09:00:00.000Z' }),
      row(CURRENT, { lastActiveAt: '2026-08-25T12:00:00.000Z' }),
    ]);
    const module = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: RedisService, useValue: redis },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();
    service = module.get(SessionsService);
  });

  it('lists sessions with the current session first', async () => {
    const result = await service.list(viewer, CURRENT);
    expect(result.sessions[0]?.id).toBe(CURRENT);
    expect(result.sessions[0]?.current).toBe(true);
    expect(result.sessions[1]?.id).toBe(OTHER);
    expect(result.sessions[1]?.current).toBe(false);
    expect(result.sessions[0]?.ip).toBe('203.0.113.x');
  });

  it('revoking another session does not clear the cookie', async () => {
    redis.getSession.mockResolvedValue(row(OTHER));
    await expect(service.revoke(viewer, OTHER, CURRENT, res)).resolves.toEqual({ ok: true });
    expect(redis.deleteSession).toHaveBeenCalledWith(OTHER, A);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('revoking the current session logs out and clears the cookie', async () => {
    await service.revoke(viewer, CURRENT, CURRENT, res);
    expect(auth.logout).toHaveBeenCalledWith(A, CURRENT, res);
    expect(redis.deleteSession).not.toHaveBeenCalled();
  });

  it('does not revoke a session owned by someone else', async () => {
    redis.getSession.mockResolvedValue({ ...row(OTHER), userId: 'someone-else' });
    await expect(service.revoke(viewer, OTHER, CURRENT, res)).resolves.toEqual({ ok: true });
    expect(redis.deleteSession).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
