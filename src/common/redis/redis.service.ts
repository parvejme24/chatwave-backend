import {
  Injectable,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

import {
  OTP_TTL,
  OTP_WINDOW,
  redisKey,
  SESSION_TTL,
  browserName,
  deviceLabel,
  type OAuthProvider,
  type SessionMeta,
  type SessionRecord,
} from '../../auth/auth.constants';
import { AppEnv } from '../../config/env.validation';
import { type LivePresence } from '../../users/users.constants';

const presenceKey = {
  live: (id: string) => `presence:${id}`,
  onlineSet: 'online_users',
  lastSeen: (id: string) => `presence:seen:${id}`,
};

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService<AppEnv, true>) {
    const url = this.config.get('REDIS_URL', { infer: true });
    const tls =
      url.startsWith('rediss://') || this.config.get('REDIS_TLS', { infer: true });

    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      ...(tls && !url.startsWith('rediss://') ? { tls: {} } : {}),
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis error: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async createSession(userId: string, meta: SessionMeta): Promise<string> {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const payload: SessionRecord = {
      userId,
      createdAt: now,
      lastActiveAt: now,
      userAgent: meta.userAgent,
      ip: meta.ip,
      platform: meta.platform,
      device: deviceLabel(meta.userAgent, meta.platform),
      browser: browserName(meta.userAgent),
      city: '',
      country: '',
    };

    const sessionKey = redisKey.session(sessionId);
    const userKey = redisKey.userSessions(userId);

    await this.client
      .multi()
      .set(sessionKey, JSON.stringify(payload), 'EX', SESSION_TTL)
      .sadd(userKey, sessionId)
      .expire(userKey, SESSION_TTL)
      .exec();

    return sessionId;
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const raw = await this.client.get(redisKey.session(sessionId));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  async refreshSession(sessionId: string, userId: string): Promise<void> {
    const sessionKey = redisKey.session(sessionId);
    const userKey = redisKey.userSessions(userId);
    const raw = await this.client.get(sessionKey);
    if (!raw) return;
    let payload: SessionRecord;
    try {
      payload = JSON.parse(raw) as SessionRecord;
    } catch {
      return;
    }
    payload.lastActiveAt = new Date().toISOString();
    await this.client
      .multi()
      .set(sessionKey, JSON.stringify(payload), 'EX', SESSION_TTL)
      .expire(userKey, SESSION_TTL)
      .exec();
  }

  async listUserSessions(userId: string): Promise<Array<SessionRecord & { id: string }>> {
    const ids = await this.client.smembers(redisKey.userSessions(userId));
    if (ids.length === 0) return [];
    const pipeline = this.client.pipeline();
    for (const id of ids) pipeline.get(redisKey.session(id));
    const results = await pipeline.exec();
    const rows: Array<SessionRecord & { id: string }> = [];
    ids.forEach((id, index) => {
      const raw = results?.[index]?.[1];
      if (typeof raw !== 'string') return;
      try {
        rows.push({ id, ...(JSON.parse(raw) as SessionRecord) });
      } catch {
        /* skip corrupt rows */
      }
    });
    return rows;
  }

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    await this.client
      .multi()
      .del(redisKey.session(sessionId))
      .srem(redisKey.userSessions(userId), sessionId)
      .exec();
  }

  async deleteAllSessions(userId: string): Promise<void> {
    const userKey = redisKey.userSessions(userId);
    const sessionIds = await this.client.smembers(userKey);
    if (sessionIds.length === 0) {
      await this.client.del(userKey);
      return;
    }

    const pipeline = this.client.multi();
    for (const sessionId of sessionIds) {
      pipeline.del(redisKey.session(sessionId));
    }
    pipeline.del(userKey);
    await pipeline.exec();
  }

  async setOtpHash(email: string, hash: string): Promise<void> {
    await this.client.set(redisKey.otp(email), hash, 'EX', OTP_TTL);
  }

  async getOtpHash(email: string): Promise<string | null> {
    return this.client.get(redisKey.otp(email));
  }

  async deleteOtp(email: string): Promise<void> {
    await this.client.del(redisKey.otp(email));
  }

  async incrementOtpCount(email: string): Promise<number> {
    const key = redisKey.otpCount(email);
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, OTP_WINDOW);
    }
    return count;
  }

  async setOAuthLink(userId: string, provider: OAuthProvider): Promise<void> {
    await this.client.set(redisKey.oauthLink(userId), provider, 'EX', 600);
  }

  async consumeOAuthLink(userId: string): Promise<OAuthProvider | null> {
    const key = redisKey.oauthLink(userId);
    const value = await this.client.get(key);
    if (!value) return null;
    await this.client.del(key);
    if (value === 'google' || value === 'github') return value;
    return null;
  }

  async setDeleteToken(token: string, userId: string, ttl: number): Promise<void> {
    await this.client.set(redisKey.deleteAccount(token), userId, 'EX', ttl);
  }

  async consumeDeleteToken(token: string): Promise<string | null> {
    const key = redisKey.deleteAccount(token);
    const userId = await this.client.get(key);
    if (!userId) return null;
    await this.client.del(key);
    return userId;
  }

  async setLivePresence(userId: string, presence: LivePresence, ttl: number): Promise<void> {
    await this.client
      .multi()
      .set(presenceKey.live(userId), presence, 'EX', ttl)
      .sadd(presenceKey.onlineSet, userId)
      .exec();
  }

  async clearLivePresence(userId: string): Promise<void> {
    await this.client
      .multi()
      .del(presenceKey.live(userId))
      .srem(presenceKey.onlineSet, userId)
      .exec();
  }

  async getLivePresence(userId: string): Promise<LivePresence | null> {
    const value = await this.client.get(presenceKey.live(userId));
    if (value === 'online' || value === 'away') return value;
    if (value === null) await this.client.srem(presenceKey.onlineSet, userId);
    return null;
  }

  async claimLastSeenWrite(userId: string, ttl: number): Promise<boolean> {
    const result = await this.client.set(presenceKey.lastSeen(userId), '1', 'EX', ttl, 'NX');
    return result === 'OK';
  }

  async listOnlineUserIds(): Promise<string[]> {
    const ids = await this.client.smembers(presenceKey.onlineSet);
    if (ids.length === 0) return [];

    const pipeline = this.client.pipeline();
    for (const id of ids) pipeline.get(presenceKey.live(id));
    const results = await pipeline.exec();

    const live: string[] = [];
    const stale: string[] = [];
    ids.forEach((id, index) => {
      const value = results?.[index]?.[1];
      if (value === 'online' || value === 'away') live.push(id);
      else stale.push(id);
    });
    if (stale.length > 0) await this.client.srem(presenceKey.onlineSet, ...stale);
    return live;
  }

  async tooMany(key: string, max: number, windowSec: number): Promise<boolean> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, windowSec);
    return count > max;
  }

  async addSocketConnection(userId: string): Promise<number> {
    return this.client.incr(`socks:${userId}`);
  }

  async dropSocketConnection(userId: string): Promise<number> {
    const count = await this.client.decr(`socks:${userId}`);
    if (count <= 0) {
      await this.client.del(`socks:${userId}`);
      return 0;
    }
    return count;
  }

  async socketCount(userId: string): Promise<number> {
    const raw = await this.client.get(`socks:${userId}`);
    return raw ? Number(raw) : 0;
  }

  async bumpUnreadDigest(userId: string, preview: string): Promise<void> {
    await this.client
      .multi()
      .incr(`digest:${userId}`)
      .set(`digest:${userId}:preview`, preview)
      .sadd('digest:pending', userId)
      .exec();
  }

  async pendingDigestUserIds(): Promise<string[]> {
    return this.client.smembers('digest:pending');
  }

  async takeUnreadDigest(userId: string): Promise<{ count: number; preview: string } | null> {
    const [countRaw, preview] = await Promise.all([
      this.client.get(`digest:${userId}`),
      this.client.get(`digest:${userId}:preview`),
    ]);
    const count = Number(countRaw ?? 0);
    await this.client.multi().del(`digest:${userId}`).del(`digest:${userId}:preview`).srem('digest:pending', userId).exec();
    if (!Number.isFinite(count) || count <= 0) return null;
    return { count, preview: preview ?? '' };
  }

  async setTyping(conversationId: string, userId: string): Promise<void> {
    await this.client.set(`typing:${conversationId}:${userId}`, '1', 'EX', 3);
  }

  async clearTyping(conversationId: string, userId: string): Promise<void> {
    await this.client.del(`typing:${conversationId}:${userId}`);
  }

  setCallRing(callId: string, ttlSec: number) {
    return this.client.set(`call:ring:${callId}`, '1', 'EX', ttlSec);
  }

  clearCallRing(callId: string) {
    return this.client.del(`call:ring:${callId}`);
  }

  setCallBusy(userId: string, callId: string, ttlSec: number) {
    return this.client.set(`call:busy:${userId}`, callId, 'EX', ttlSec);
  }

  getCallBusy(userId: string) {
    return this.client.get(`call:busy:${userId}`);
  }

  clearCallBusy(userId: string) {
    return this.client.del(`call:busy:${userId}`);
  }
}
