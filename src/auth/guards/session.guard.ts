import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { RedisService } from '../../common/redis/redis.service';
import { UsersService } from '../../users/users.service';
import { AUTH_COOKIE } from '../auth.constants';
import { AuthedRequest } from '../decorators/current-user.decorator';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    @Inject(forwardRef(() => UsersService)) private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & AuthedRequest>();
    const { sessionId, userId } = await this.resolve(request);
    const user = await this.users.getAuthViewer(userId);
    if (!user) throw new UnauthorizedException({ error: 'Please sign in again' });
    request.authUser = user;
    request.sessionId = sessionId;
    return true;
  }

  private async resolve(request: Request) {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<{ sub?: string; sid?: string }>(
          header.slice(7).trim(),
        );
        if (payload.sid && payload.sub) {
          const session = await this.redis.getSession(payload.sid);
          if (session?.userId === payload.sub) {
            return { sessionId: payload.sid, userId: payload.sub };
          }
        }
      } catch {
        throw new UnauthorizedException({ error: 'Please sign in again' });
      }
    }

    const sessionId = (request.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
    if (!sessionId) throw new UnauthorizedException({ error: 'Please sign in' });
    const session = await this.redis.getSession(sessionId);
    if (!session) throw new UnauthorizedException({ error: 'Please sign in again' });
    return { sessionId, userId: session.userId };
  }
}
