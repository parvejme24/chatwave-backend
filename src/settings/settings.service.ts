import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

import { BlocksService } from '../blocks/blocks.service';
import { MailService } from '../common/mail/mail.service';
import { RedisService } from '../common/redis/redis.service';
import { AppEnv } from '../config/env.validation';
import { SessionsService } from '../sessions/sessions.service';
import type { AuthViewer } from '../users/users.constants';
import { UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import {
  BAD_SOUND,
  BAD_TOKEN,
  DELETE_EMAIL_FAILED,
  DELETE_TTL,
  SOUND_EVENTS,
  SOUND_OFF,
  SOUND_OPTIONS,
  allowedSounds,
  mergeSettings,
  type SoundFavorites,
} from './settings.constants';
import { ConfirmDeleteDto, UpdateSettingsDto } from './settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly config: ConfigService<AppEnv, true>,
    @Optional() @Inject(forwardRef(() => BlocksService)) private readonly blocks?: BlocksService,
    @Optional() private readonly sessions?: SessionsService,
  ) {}

  async getForUser(viewer: AuthViewer, sessionId?: string) {
    const user = await this.requireUser(viewer.id);
    const settings = mergeSettings(user.settings);
    const [blockedCount, sessions] = await Promise.all([
      this.blockedCount(viewer.id),
      this.sessionList(viewer, sessionId),
    ]);
    return {
      profile: await this.users.toOwnerPayload(user),
      settings,
      auth: {
        email: user.email,
        emailVerified: Boolean(user.emailVerifiedAt),
        providers: { google: Boolean(user.providers?.googleId), github: Boolean(user.providers?.githubId) },
      },
      privacy: { blockedCount },
      isOwner: Boolean(user.isOwner),
      sessions,
      storage: { bytes: 0, conversations: 0 },
    };
  }

  async update(viewer: AuthViewer, dto: UpdateSettingsDto, sessionId?: string) {
    const user = await this.requireUser(viewer.id);
    const settings = mergeSettings(user.settings, this.patchFrom(dto));
    this.assertFavorites(settings.soundFavorites);
    user.settings = settings;
    user.markModified('settings');
    await user.save();
    return this.getForUser(viewer, sessionId);
  }

  async sounds(viewer: AuthViewer) {
    const user = await this.requireUser(viewer.id);
    const favorites = mergeSettings(user.settings).soundFavorites;
    return {
      events: SOUND_EVENTS.map((event) => ({
        ...event,
        options: SOUND_OPTIONS[event.id],
      })),
      off: SOUND_OFF,
      favorites,
    };
  }

  async requestDelete(viewer: AuthViewer) {
    const user = await this.requireUser(viewer.id);
    const token = randomBytes(24).toString('hex');
    await this.redis.setDeleteToken(token, user.id, DELETE_TTL);
    const origin = this.config.get('FRONTEND_URL', { infer: true }).replace(/\/$/, '');
    const url = `${origin}/settings/delete-account?token=${token}`;
    try {
      await this.mail.sendConfirmDeleteAccount(user.email, url);
    } catch {
      throw new BadRequestException({ error: DELETE_EMAIL_FAILED });
    }
    return { ok: true as const, emailed: true };
  }

  async confirmDelete(dto: ConfirmDeleteDto) {
    const userId = await this.redis.consumeDeleteToken(dto.token);
    if (!userId) throw new BadRequestException({ error: BAD_TOKEN });
    await this.users.closeAccount(userId);
    await this.redis.deleteAllSessions(userId);
    return { ok: true as const };
  }

  private patchFrom(dto: UpdateSettingsDto) {
    return {
      ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
      ...(dto.reduceMotion !== undefined ? { reduceMotion: dto.reduceMotion } : {}),
      ...(dto.messageNotifications !== undefined ? { messageNotifications: dto.messageNotifications } : {}),
      ...(dto.notificationSounds !== undefined ? { notificationSounds: dto.notificationSounds } : {}),
      ...(dto.missedCallEmails !== undefined ? { missedCallEmails: dto.missedCallEmails } : {}),
      ...(dto.unreadDigest !== undefined ? { unreadDigest: dto.unreadDigest } : {}),
      ...(dto.readReceipts !== undefined ? { readReceipts: dto.readReceipts } : {}),
      ...(dto.showLastSeen !== undefined ? { showLastSeen: dto.showLastSeen } : {}),
      ...(dto.videoQuality !== undefined ? { videoQuality: dto.videoQuality } : {}),
      ...(dto.noiseSuppression !== undefined ? { noiseSuppression: dto.noiseSuppression } : {}),
      ...(dto.autoDownload !== undefined ? { autoDownload: dto.autoDownload } : {}),
      ...(dto.soundFavorites ? { soundFavorites: dto.soundFavorites } : {}),
    };
  }

  private assertFavorites(favorites: SoundFavorites) {
    for (const event of SOUND_EVENTS) {
      if (!allowedSounds(event.id).includes(favorites[event.id])) {
        throw new BadRequestException({ error: BAD_SOUND });
      }
    }
  }

  private async blockedCount(userId: string) {
    return (await this.blocks?.listBlockedIds(userId))?.length ?? 0;
  }

  private async sessionList(viewer: AuthViewer, sessionId?: string) {
    if (!this.sessions || !sessionId) return [];
    return (await this.sessions.list(viewer, sessionId)).sessions;
  }

  private async requireUser(userId: string): Promise<UserDocument> {
    const user = await this.users.findActiveById(userId);
    if (!user) throw new UnauthorizedException({ error: 'Please sign in again' });
    return user;
  }
}
