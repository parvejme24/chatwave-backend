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
}
