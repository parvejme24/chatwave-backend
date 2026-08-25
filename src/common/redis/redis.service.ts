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
  type OAuthProvider,
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

  async createSession(
    userId: string,
    meta: Omit<SessionRecord, 'userId' | 'createdAt'>,
  ): Promise<string> {
    const sessionId = randomUUID();
    const payload: SessionRecord = {
      userId,
      createdAt: new Date().toISOString(),
      userAgent: meta.userAgent,
      ip: meta.ip,
      platform: meta.platform,
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
    await this.client
      .multi()
      .expire(sessionKey, SESSION_TTL)
      .expire(userKey, SESSION_TTL)
      .exec();
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
}
