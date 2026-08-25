import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import type { CookieOptions, Request, Response } from 'express';

import { MailService } from '../common/mail/mail.service';
import { RedisService } from '../common/redis/redis.service';
import { AppEnv } from '../config/env.validation';
import { UsersService } from '../users/users.service';
import type { UserDocument } from '../users/user.schema';
import type { UploadedPhoto } from '../users/users.constants';
import {
  AUTH_COOKIE,
  BCRYPT_COST,
  clientIp,
  cookieSessionId,
  detectPlatform,
  generateOtp,
  OTP_MAX,
  providerField,
  SESSION_TTL,
  type OAuthProfile,
  type OAuthProvider,
} from './auth.constants';
import { LoginDto, RegisterDto, ResetPasswordDto, UpdateProfileDto } from './auth.dto';

export class OAuthFlowError extends Error {
  constructor(message = 'OAuth failed') {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(forwardRef(() => UsersService)) private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  private get<K extends keyof AppEnv>(key: K) {
    return this.config.get(key, { infer: true });
  }

  async register(dto: RegisterDto) {
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException({ error: 'An account with this email already exists' });
    }
    const user = await this.users.createLocalUser({
      name: dto.name,
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_COST),
    });
    return { user: await this.users.toOwnerPayload(user) };
  }

  async login(dto: LoginDto, req: Request, res: Response) {
    return this.issueSession(await this.validateLocalUser(dto.email, dto.password), req, res);
  }

  async validateLocalUser(email: string, password: string) {
    const user = await this.users.findByEmailWithPassword(email);
    if (!user) throw new UnauthorizedException({ error: 'Invalid email or password' });
    this.assertAllowed(user);
    if (!user.passwordHash) {
      throw new UnauthorizedException({
        error:
          'This account uses Google or GitHub to sign in. Continue with that provider, or reset your password.',
      });
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException({ error: 'Invalid email or password' });
    }
    return user;
  }

  async forgotPassword(email: string) {
    if ((await this.redis.incrementOtpCount(email)) > OTP_MAX) {
      throw new BadRequestException({ error: 'Too many reset attempts. Try again later.' });
    }
    const user = await this.users.findByEmail(email);
    if (user && user.status === 'active' && !user.deletedAt) {
      const otp = generateOtp();
      await this.redis.setOtpHash(email, await bcrypt.hash(otp, BCRYPT_COST));
      await this.mail.sendPasswordResetOtp(email, otp);
    }
    return { ok: true as const };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const [user, otpHash] = await Promise.all([
      this.users.findByEmailWithPassword(dto.email),
      this.redis.getOtpHash(dto.email),
    ]);
    if (!user || !otpHash) {
      throw new BadRequestException({ error: 'Invalid or expired code' });
    }
    this.assertAllowed(user);
    if (!(await bcrypt.compare(dto.otp, otpHash))) {
      throw new BadRequestException({ error: 'Invalid or expired code' });
    }
    user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    await user.save();
    await this.redis.deleteOtp(dto.email);
    await this.redis.deleteAllSessions(user.id);
    return { ok: true as const };
  }

  async getMe(userId: string, sessionId: string, res: Response) {
    await this.redis.refreshSession(sessionId, userId);
    this.setCookie(res, sessionId);
    return this.users.getMe(userId);
  }

  async logout(userId: string, sessionId: string, res: Response) {
    await this.users.goOffline(userId);
    await this.redis.deleteSession(sessionId, userId);
    this.clearCookie(res);
    return { ok: true as const };
  }

  async logoutAll(userId: string, res: Response) {
    await this.users.goOffline(userId);
    await this.redis.deleteAllSessions(userId);
    this.clearCookie(res);
    return { ok: true as const };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, file?: UploadedPhoto) {
    const updated = await this.users.updateMe(userId, dto);
    if (!file) return updated;
    return this.users.updatePhoto(userId, file);
  }

  async startOAuthLink(userId: string, provider: OAuthProvider, res: Response) {
    this.assertOAuthConfigured(provider);
    await this.redis.setOAuthLink(userId, provider);
    res.redirect(`${this.get('API_URL')}/api/auth/${provider}`);
  }

  async upsertOAuthUser(profile: OAuthProfile, req: Request) {
    const email = profile.email.toLowerCase().trim();
    if (!email) throw new OAuthFlowError('This provider did not share an email address');

    const sessionUser = await this.userFromRequest(req);
    if (sessionUser) {
      const intent = await this.redis.consumeOAuthLink(sessionUser.id);
      if (intent === profile.provider) return this.linkProvider(sessionUser.id, profile);
    }

    const field = `providers.${providerField(profile.provider)}` as const;
    let user =
      (await this.users.findByProvider(field, profile.providerId)) ??
      (await this.users.findByEmail(email));

    if (user) {
      this.assertAllowed(user);
      return this.users.applyOAuth(user, profile);
    }

    return this.users.createOAuthUser({
      name: profile.name || email,
      email,
      photoUrl: profile.photoUrl ?? null,
      providers: { [providerField(profile.provider)]: profile.providerId },
    });
  }

  async finishOAuth(user: UserDocument, req: Request, res: Response) {
    await this.issueSession(user, req, res);
    res.redirect(`${this.get('FRONTEND_URL')}/chats?auth=success`);
  }

  redirectOAuthError(res: Response) {
    res.redirect(`${this.get('FRONTEND_URL')}/sign-in?auth=error`);
  }

  assertOAuthConfigured(provider: OAuthProvider) {
    const configured =
      provider === 'google'
        ? this.get('GOOGLE_CLIENT_ID') && this.get('GOOGLE_CLIENT_SECRET')
        : this.get('GITHUB_CLIENT_ID') && this.get('GITHUB_CLIENT_SECRET');
    if (!configured) {
      throw new ServiceUnavailableException({
        error: `${provider === 'google' ? 'Google' : 'GitHub'} sign-in is not configured`,
      });
    }
  }

  async findActiveUserById(userId: string) {
    return this.users.findActiveById(userId);
  }

  private async issueSession(user: UserDocument, req: Request, res: Response) {
    this.assertAllowed(user);
    await this.users.markOnline(user);
    const sessionId = await this.redis.createSession(user.id, {
      userAgent: req.headers['user-agent'] ?? '',
      ip: clientIp(req.ip, req.headers['x-forwarded-for']),
      platform: detectPlatform(req.headers['user-agent'] ?? ''),
    });
    this.setCookie(res, sessionId);
    return {
      user: await this.users.toOwnerPayload(user),
      accessToken: this.jwt.sign({ sub: user.id, sid: sessionId }, { expiresIn: '15m' }),
    };
  }

  private async linkProvider(userId: string, profile: OAuthProfile) {
    const user = await this.users.findActiveById(userId);
    if (!user) throw new OAuthFlowError('Please sign in again');
    this.assertAllowed(user);
    const field = `providers.${providerField(profile.provider)}` as const;
    if (await this.users.providerTaken(field, profile.providerId, user.id)) {
      const label = profile.provider === 'google' ? 'Google' : 'GitHub';
      throw new OAuthFlowError(`This ${label} account is already linked to another ChatWave user`);
    }
    return this.users.applyOAuth(user, profile);
  }

  private async userFromRequest(req: Request) {
    const sessionId = cookieSessionId(req);
    if (!sessionId) return null;
    const session = await this.redis.getSession(sessionId);
    if (!session) return null;
    const user = await this.users.findActiveById(session.userId);
    return user ? { id: user.id, isOwner: Boolean(user.isOwner) } : null;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.get('NODE_ENV') === 'production',
      path: '/',
      maxAge: SESSION_TTL * 1000,
    };
  }

  setCookie(res: Response, sessionId: string) {
    res.cookie(AUTH_COOKIE, sessionId, this.cookieOptions());
  }

  clearCookie(res: Response) {
    res.clearCookie(AUTH_COOKIE, this.cookieOptions());
  }

  private assertAllowed(user: UserDocument) {
    if (user.deletedAt) {
      throw new UnauthorizedException({ error: 'This account is no longer available' });
    }
    if (user.status === 'banned') {
      throw new ForbiddenException({ error: 'This account has been banned' });
    }
  }
}
