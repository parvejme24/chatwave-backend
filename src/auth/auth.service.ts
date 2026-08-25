import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import type { CookieOptions, Request, Response } from 'express';
import { Model } from 'mongoose';

import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { MailService } from '../common/mail/mail.service';
import { RedisService } from '../common/redis/redis.service';
import { AppEnv } from '../config/env.validation';
import {
  AUTH_COOKIE,
  BCRYPT_COST,
  clientIp,
  detectPlatform,
  generateOtp,
  initialsFromName,
  OTP_MAX,
  PHOTO_MAX,
  PHOTO_MIME,
  providerField,
  PublicUser,
  randomTone,
  SESSION_TTL,
  toPublicUser,
  uniqueSuffix,
  usernameFromEmail,
  type OAuthProfile,
  type OAuthProvider,
  type UploadedPhoto,
} from './auth.constants';
import { LoginDto, RegisterDto, ResetPasswordDto, UpdateProfileDto } from './auth.dto';
import { User, UserDocument } from './schemas/user.schema';

export class OAuthFlowError extends Error {
  constructor(message = 'OAuth failed') {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly cloudinary: CloudinaryService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  private get<K extends keyof AppEnv>(key: K) {
    return this.config.get(key, { infer: true });
  }

  async register(dto: RegisterDto) {
    if (await this.users.findOne({ email: dto.email }).exec()) {
      throw new ConflictException({ error: 'An account with this email already exists' });
    }
    const user = await this.users.create({
      ...(await this.newAccount(dto.name, dto.email)),
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_COST),
    });
    return { user: toPublicUser(user) };
  }

  async login(dto: LoginDto, req: Request, res: Response) {
    return this.issueSession(await this.validateLocalUser(dto.email, dto.password), req, res);
  }

  async validateLocalUser(email: string, password: string) {
    const user = await this.users.findOne({ email }).select('+passwordHash').exec();
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
    const user = await this.users.findOne({ email, deletedAt: null }).exec();
    if (user?.status === 'active') {
      const otp = generateOtp();
      await this.redis.setOtpHash(email, await bcrypt.hash(otp, BCRYPT_COST));
      await this.mail.sendPasswordResetOtp(email, otp);
    }
    return { ok: true as const };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const [user, otpHash] = await Promise.all([
      this.users.findOne({ email: dto.email }).select('+passwordHash').exec(),
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
    await this.redis.deleteAllSessions(user._id.toString());
    return { ok: true as const };
  }

  async getMe(user: PublicUser, sessionId: string, res: Response) {
    await this.redis.refreshSession(sessionId, user.id);
    this.setCookie(res, sessionId);
    return { user };
  }

  async logout(userId: string, sessionId: string, res: Response) {
    await this.redis.deleteSession(sessionId, userId);
    this.clearCookie(res);
    return { ok: true as const };
  }

  async logoutAll(userId: string, res: Response) {
    await this.redis.deleteAllSessions(userId);
    this.clearCookie(res);
    return { ok: true as const };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, file?: UploadedPhoto) {
    const user = await this.users.findById(userId).exec();
    if (!user) throw new UnauthorizedException({ error: 'Please sign in again' });
    this.assertAllowed(user);

    if (dto.name) {
      user.name = dto.name;
      user.initials = initialsFromName(dto.name);
    }
    if (dto.username && dto.username !== user.username) {
      const taken = await this.users
        .findOne({ username: dto.username, _id: { $ne: user._id } })
        .exec();
      if (taken) throw new ConflictException({ error: 'That username is already taken' });
      user.username = dto.username;
    }
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.location !== undefined) user.location = dto.location;

    if (file) {
      if (!PHOTO_MIME.includes(file.mimetype as (typeof PHOTO_MIME)[number])) {
        throw new BadRequestException({ error: 'Use a JPEG, PNG, or WebP image' });
      }
      if (file.size > PHOTO_MAX) {
        throw new BadRequestException({ error: 'Keep the photo under 2 MB' });
      }
      const uploaded = await this.cloudinary.uploadAvatar(file.buffer);
      const previous = user.photoPublicId;
      user.photoUrl = uploaded.url;
      user.photoPublicId = uploaded.publicId;
      if (previous) await this.cloudinary.deleteAsset(previous);
    }

    await user.save();
    return { user: toPublicUser(user) };
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

    const field = `providers.${providerField(profile.provider)}`;
    let user =
      (await this.users.findOne({ [field]: profile.providerId }).exec()) ??
      (await this.users.findOne({ email }).exec());

    if (user) {
      this.assertAllowed(user);
      this.applyOAuth(user, profile);
      await user.save();
      return user;
    }

    return this.users.create({
      ...(await this.newAccount(profile.name || email, email)),
      passwordHash: null,
      photoUrl: profile.photoUrl ?? null,
      emailVerifiedAt: new Date(),
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
    const user = await this.users.findById(userId).exec();
    if (!user || user.status === 'banned' || user.deletedAt) return null;
    return user;
  }

  private async issueSession(user: UserDocument, req: Request, res: Response) {
    this.assertAllowed(user);
    user.lastSeenAt = new Date();
    await user.save();
    const sessionId = await this.redis.createSession(user._id.toString(), {
      userAgent: req.headers['user-agent'] ?? '',
      ip: clientIp(req.ip, req.headers['x-forwarded-for']),
      platform: detectPlatform(req.headers['user-agent'] ?? ''),
    });
    this.setCookie(res, sessionId);
    return {
      user: toPublicUser(user),
      accessToken: this.jwt.sign({ sub: user._id.toString(), sid: sessionId }, { expiresIn: '15m' }),
    };
  }

  private async linkProvider(userId: string, profile: OAuthProfile) {
    const user = await this.users.findById(userId).exec();
    if (!user) throw new OAuthFlowError('Please sign in again');
    this.assertAllowed(user);
    const field = `providers.${providerField(profile.provider)}`;
    const taken = await this.users
      .findOne({ [field]: profile.providerId, _id: { $ne: user._id } })
      .exec();
    if (taken) {
      const label = profile.provider === 'google' ? 'Google' : 'GitHub';
      throw new OAuthFlowError(`This ${label} account is already linked to another ChatWave user`);
    }
    this.applyOAuth(user, profile);
    await user.save();
    return user;
  }

  private applyOAuth(user: UserDocument, profile: OAuthProfile) {
    user.providers ??= {};
    user.providers[providerField(profile.provider)] = profile.providerId;
    if (!user.photoUrl && profile.photoUrl) user.photoUrl = profile.photoUrl;
    if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
  }

  private async userFromRequest(req: Request) {
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
    if (!sessionId) return null;
    const session = await this.redis.getSession(sessionId);
    if (!session) return null;
    const user = await this.findActiveUserById(session.userId);
    return user ? toPublicUser(user) : null;
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

  private async newAccount(name: string, email: string) {
    const trimmed = name.trim();
    return {
      name: trimmed,
      email,
      username: await this.uniqueUsername(usernameFromEmail(email)),
      initials: initialsFromName(trimmed),
      tone: randomTone(),
      isOwner: (await this.users.countDocuments().exec()) === 0,
    };
  }

  private async uniqueUsername(base: string) {
    for (let i = 0; i < 8; i += 1) {
      const candidate = i === 0 ? base : `${base}${uniqueSuffix()}`;
      if (!(await this.users.findOne({ username: candidate }).exec())) return candidate;
    }
    return `${base}${Date.now().toString(36)}`;
  }
}
