import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, type Socket } from 'socket.io';

import { AUTH_COOKIE } from '../../auth/auth.constants';
import { RedisService } from '../../common/redis/redis.service';
import { UsersService } from '../../users/users.service';

export class SocketSessionAdapter extends IoAdapter {
  constructor(
    private readonly nestApp: NestExpressApplication,
    private readonly frontendOrigins: string | string[],
  ) {
    super(nestApp.getHttpServer());
  }

  createIOServer(port: number, options?: { cors?: unknown; path?: string }) {
    const jwt = this.nestApp.get(JwtService);
    const redis = this.nestApp.get(RedisService);
    const users = this.nestApp.get(UsersService);
    const server = super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      cors: {
        origin: this.frontendOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      },
    }) as Server;

    server.use((socket, next) => {
      void this.authenticate(socket, jwt, redis, users).then(
        () => next(),
        (error: unknown) => next(error instanceof Error ? error : new Error('Please sign in')),
      );
    });
    return server;
  }

  private async authenticate(socket: Socket, jwt: JwtService, redis: RedisService, users: UsersService) {
    let userId = '';
    const raw =
      typeof socket.handshake.auth?.token === 'string'
        ? socket.handshake.auth.token.replace(/^Bearer\s+/i, '').trim()
        : typeof socket.handshake.headers.authorization === 'string' && socket.handshake.headers.authorization.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7).trim()
          : '';
    if (raw) {
      try {
        const payload = jwt.verify<{ sub?: string; sid?: string }>(raw);
        if (payload.sid && payload.sub) {
          const session = await redis.getSession(payload.sid);
          if (session?.userId === payload.sub) userId = payload.sub;
        }
      } catch {
        /* cookie fallback */
      }
    }
    if (!userId) {
      const cookie = socket.handshake.headers.cookie ?? '';
      const part = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${AUTH_COOKIE}=`));
      const sessionId = part ? decodeURIComponent(part.slice(AUTH_COOKIE.length + 1)) : '';
      if (!sessionId) throw new Error('Please sign in');
      const session = await redis.getSession(sessionId);
      if (!session) throw new Error('Please sign in again');
      userId = session.userId;
    }
    const user = await users.findActiveById(userId);
    if (!user) throw new Error('Please sign in again');
    socket.data.userId = user.id;
    socket.data.isOwner = Boolean(user.isOwner);
  }
}
