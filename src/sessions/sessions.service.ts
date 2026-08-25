import { Injectable } from '@nestjs/common';
import type { Response } from 'express';

import { AuthService } from '../auth/auth.service';
import { RedisService } from '../common/redis/redis.service';
import type { AuthViewer } from '../users/users.constants';
import { toSessionDto } from './sessions.constants';

@Injectable()
export class SessionsService {
  constructor(
    private readonly redis: RedisService,
    private readonly auth: AuthService,
  ) {}

  async list(viewer: AuthViewer, currentId: string) {
    const rows = await this.redis.listUserSessions(viewer.id);
    const sessions = rows
      .map((row) => toSessionDto(row, currentId))
      .sort(
        (a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt),
      );
    return { sessions };
  }

  async revoke(viewer: AuthViewer, sessionId: string, currentId: string, res: Response) {
    if (sessionId === currentId) return this.auth.logout(viewer.id, currentId, res);
    const session = await this.redis.getSession(sessionId);
    if (session?.userId === viewer.id) await this.redis.deleteSession(sessionId, viewer.id);
    return { ok: true as const };
  }
}
