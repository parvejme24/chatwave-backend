import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';

import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { RedisService } from '../common/redis/redis.service';
import { UpdateProfileDto } from './users.dto';
import { User, UserDocument } from './user.schema';
import {
  initialsFromName,
  LAST_SEEN_THROTTLE,
  PHOTO_MAX,
  PHOTO_MIME,
  PRESENCE_TTL,
  randomTone,
  usernameFromEmail,
  type AuthViewer,
  type OwnerUser,
  type Presence,
  type PublicUser,
  type UploadedPhoto,
} from './users.constants';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly redis: RedisService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async getMe(userId: string) {
    return { user: await this.toOwnerPayload(await this.requireActive(userId)) };
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const user = await this.requireActive(userId);
    if (dto.name) {
      user.name = dto.name;
      user.initials = initialsFromName(dto.name);
    }
    if (dto.username && dto.username !== user.username) {
      if (await this.taken({ username: dto.username }, userId)) {
        throw new ConflictException({ error: 'That username is already taken' });
      }
      user.username = dto.username;
    }
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.location !== undefined) user.location = dto.location;
    if (dto.tone) user.tone = dto.tone;
    await this.save(user);
    return { user: await this.toOwnerPayload(user) };
  }

  async updatePhoto(userId: string, file: UploadedPhoto) {
    if (!file.buffer?.length) {
      throw new BadRequestException({ error: 'Choose a photo to upload' });
    }
    if (!PHOTO_MIME.includes(file.mimetype as (typeof PHOTO_MIME)[number])) {
      throw new BadRequestException({ error: 'Use a JPEG, PNG, or WebP image' });
    }
    if (file.size > PHOTO_MAX) {
      throw new BadRequestException({ error: 'Keep the photo under 2 MB' });
    }
    const user = await this.requireActive(userId);
    const uploaded = await this.cloudinary.uploadAvatar(file.buffer);
    const previous = user.photoPublicId;
    user.photoUrl = uploaded.url;
    user.photoPublicId = uploaded.publicId;
    await this.save(user);
    if (previous) await this.cloudinary.deleteAsset(previous);
    return { user: await this.toOwnerPayload(user) };
  }

  async deletePhoto(userId: string) {
    const user = await this.requireActive(userId);
    if (user.photoPublicId) await this.cloudinary.deleteAsset(user.photoPublicId);
    user.photoUrl = null;
    user.photoPublicId = null;
    await this.save(user);
    return { user: await this.toOwnerPayload(user) };
  }

  async setPresence(userId: string, presence: Presence) {
    const user = await this.requireActive(userId);
    const now = new Date();
    if (presence === 'offline') {
      await this.redis.clearLivePresence(userId);
      user.presence = 'offline';
      user.lastSeenAt = now;
      await this.save(user);
    } else {
      await this.redis.setLivePresence(userId, presence, PRESENCE_TTL);
      user.presence = presence;
      if (await this.redis.claimLastSeenWrite(userId, LAST_SEEN_THROTTLE)) {
        user.lastSeenAt = now;
        await this.save(user);
      }
    }
    return {
      presence: (await this.redis.getLivePresence(userId)) ?? 'offline',
      lastSeenAt: (user.lastSeenAt ?? now).toISOString(),
    };
  }

  async search(viewer: AuthViewer, q?: string, presence?: Presence, limit = 20) {
    const take = Math.min(Math.max(limit || 20, 1), 50);
    const filter: Record<string, unknown> = {
      _id: { $ne: viewer.id },
      status: 'active',
      deletedAt: null,
    };
    const query = q?.trim();
    if (query) {
      const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = viewer.isOwner
        ? [{ name: rx }, { username: rx }, { email: rx }]
        : [{ name: rx }, { username: rx }];
    }
    const rows = await this.users.find(filter).limit(take * 3).exec();
    const users: PublicUser[] = [];
    for (const row of rows) {
      if (row.status !== 'active' || row.deletedAt) continue;
      const item = await this.publicUser(viewer, row);
      if (presence && item.presence !== presence) continue;
      users.push(item);
      if (users.length >= take) break;
    }
    return { users };
  }

  async listOnline(viewer: AuthViewer) {
    const ids = (await this.redis.listOnlineUserIds()).filter(
      (id) => id !== viewer.id && isMongoId(id),
    );
    if (!ids.length) return { users: [] as PublicUser[] };
    const rows = await this.users
      .find({ _id: { $in: ids }, status: 'active', deletedAt: null })
      .exec();
    const users = await Promise.all(rows.map((row) => this.publicUser(viewer, row)));
    return { users: users.filter((u) => u.presence === 'online' || u.presence === 'away') };
  }

  async getPublicById(viewer: AuthViewer, id: string) {
    if (!isMongoId(id)) throw new NotFoundException({ error: 'User not found' });
    return { user: await this.visiblePublic(viewer, await this.users.findById(id).exec()) };
  }

  async getPublicByUsername(viewer: AuthViewer, username: string) {
    const user = await this.users
      .findOne({ username: username.replace(/^@/, '').toLowerCase() })
      .exec();
    return { user: await this.visiblePublic(viewer, user) };
  }

  findById(id: string) {
    return this.users.findById(id).exec();
  }

  findByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([] as UserDocument[]);
    return this.users.find({ _id: { $in: ids } }).exec();
  }

  async findActiveById(id: string) {
    const user = await this.users.findById(id).exec();
    return !user || user.status === 'banned' || user.deletedAt ? null : user;
  }

  findByEmail(email: string) {
    return this.users.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  findByEmailWithPassword(email: string) {
    return this.users.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash').exec();
  }

  findByProvider(path: 'providers.googleId' | 'providers.githubId', providerId: string) {
    return this.users.findOne({ [path]: providerId }).exec();
  }

  async createLocalUser(input: { name: string; email: string; passwordHash: string }) {
    return this.create({ ...(await this.baseAccount(input.name, input.email)), passwordHash: input.passwordHash });
  }

  async createOAuthUser(input: {
    name: string;
    email: string;
    photoUrl?: string | null;
    providers: { googleId?: string; githubId?: string };
  }) {
    return this.create({
      ...(await this.baseAccount(input.name, input.email)),
      passwordHash: null,
      photoUrl: input.photoUrl ?? null,
      emailVerifiedAt: new Date(),
      providers: input.providers,
    });
  }

  markBanned(userId: string) {
    return this.users.findByIdAndUpdate(userId, { status: 'banned' }).exec();
  }

  softDelete(userId: string) {
    return this.users.findByIdAndUpdate(userId, { deletedAt: new Date() }).exec();
  }

  async applyOAuth(
    user: UserDocument,
    profile: { provider: 'google' | 'github'; providerId: string; photoUrl?: string | null },
  ) {
    user.providers ??= {};
    user.providers[profile.provider === 'google' ? 'googleId' : 'githubId'] = profile.providerId;
    user.markModified('providers');
    if (!user.photoUrl && profile.photoUrl) user.photoUrl = profile.photoUrl;
    if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
    await this.save(user);
    return user;
  }

  async markOnline(user: UserDocument) {
    await this.redis.setLivePresence(user.id, 'online', PRESENCE_TTL);
    user.presence = 'online';
    user.lastSeenAt = new Date();
    await this.save(user);
    return user;
  }

  async goOffline(userId: string) {
    await this.redis.clearLivePresence(userId);
    await this.users.findByIdAndUpdate(userId, { presence: 'offline', lastSeenAt: new Date() }).exec();
  }

  providerTaken(
    path: 'providers.googleId' | 'providers.githubId',
    providerId: string,
    exceptId?: string,
  ) {
    return this.taken({ [path]: providerId }, exceptId);
  }

  async toOwnerPayload(user: UserDocument): Promise<OwnerUser> {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      initials: user.initials,
      tone: user.tone,
      photoUrl: user.photoUrl ?? null,
      role: user.role ?? '',
      location: user.location ?? '',
      isOwner: Boolean(user.isOwner),
      presence: (await this.redis.getLivePresence(user.id)) ?? 'offline',
      lastSeenAt: user.lastSeenAt ? user.lastSeenAt.toISOString() : null,
      status: user.status ?? 'active',
      providers: { google: Boolean(user.providers?.googleId), github: Boolean(user.providers?.githubId) },
      settings: {
        showLastSeen: user.settings?.showLastSeen !== false,
        readReceipts: user.settings?.readReceipts !== false,
      },
      createdAt: (user.createdAt ?? new Date()).toISOString(),
    };
  }

  async publicUser(viewer: AuthViewer, user: UserDocument): Promise<PublicUser> {
    const hideSeen = viewer.id !== user.id && user.settings?.showLastSeen === false;
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      initials: user.initials,
      tone: user.tone,
      photoUrl: user.photoUrl ?? null,
      role: user.role ?? '',
      location: user.location ?? '',
      presence: hideSeen ? 'offline' : ((await this.redis.getLivePresence(user.id)) ?? 'offline'),
      lastSeenAt: hideSeen || !user.lastSeenAt ? null : user.lastSeenAt.toISOString(),
      sub: [user.role, user.location].filter(Boolean).join(' · '),
    };
  }

  private async visiblePublic(viewer: AuthViewer, user: UserDocument | null) {
    if (!user) throw new NotFoundException({ error: 'User not found' });
    if (viewer.id !== user.id && !viewer.isOwner && (user.status === 'banned' || user.deletedAt)) {
      throw new NotFoundException({ error: 'User not found' });
    }
    return this.publicUser(viewer, user);
  }

  private async requireActive(userId: string) {
    const user = await this.findActiveById(userId);
    if (!user) throw new UnauthorizedException({ error: 'Please sign in again' });
    return user;
  }

  private async taken(filter: Record<string, unknown>, exceptId?: string) {
    if (exceptId) filter._id = { $ne: exceptId };
    return Boolean(await this.users.findOne(filter).exec());
  }

  private async save(user: UserDocument) {
    try {
      await user.save();
      return user;
    } catch (error) {
      throwDuplicate(error);
    }
  }

  private async create(doc: Record<string, unknown>) {
    try {
      return await this.users.create(doc);
    } catch (error) {
      throwDuplicate(error);
    }
  }

  private async baseAccount(name: string, email: string) {
    const trimmed = name.trim();
    return {
      name: trimmed,
      email: email.toLowerCase().trim(),
      username: await this.uniqueUsername(usernameFromEmail(email)),
      initials: initialsFromName(trimmed),
      tone: randomTone(),
      isOwner: (await this.users.countDocuments().exec()) === 0,
      settings: { showLastSeen: true, readReceipts: true },
    };
  }

  private async uniqueUsername(base: string) {
    const root = base.slice(0, 24);
    for (let i = 0; i < 8; i += 1) {
      const extra = i === 0 ? '' : randomBytes(2).toString('hex');
      const candidate = `${root.slice(0, 24 - extra.length)}${extra}`;
      if (!(await this.taken({ username: candidate }))) return candidate;
    }
    return `${root.slice(0, 16)}${Date.now().toString(36).slice(-8)}`;
  }
}

function isMongoId(id: string) {
  return isValidObjectId(id) && String(new Types.ObjectId(id)) === id;
}

function throwDuplicate(error: unknown): never {
  const code = typeof error === 'object' && error && 'code' in error ? error.code : null;
  const key = typeof error === 'object' && error && 'keyPattern' in error
    ? (error.keyPattern as Record<string, unknown>)
    : undefined;
  if (code === 11000 && key?.username) throw new ConflictException({ error: 'That username is already taken' });
  if (code === 11000 && key?.email) {
    throw new ConflictException({ error: 'An account with this email already exists' });
  }
  throw error;
}
