import { randomBytes, randomInt } from 'crypto';

export const AUTH_COOKIE = 'cw_session';
export const BCRYPT_COST = 12;
export const SESSION_TTL = 60 * 60 * 24 * 7;
export const OTP_TTL = 60 * 10;
export const OTP_WINDOW = 60 * 15;
export const OTP_MAX = 5;
export const PHOTO_MAX = 2 * 1024 * 1024;
export const PHOTO_FOLDER = 'chatwave/avatars';
export const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const TONES = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export const PRESENCE = ['online', 'away', 'offline'] as const;
export const STATUSES = ['active', 'banned'] as const;

export const redisKey = {
  session: (id: string) => `sess:${id}`,
  userSessions: (id: string) => `user_sessions:${id}`,
  otp: (email: string) => `otp:reset:${email}`,
  otpCount: (email: string) => `otp:reset:count:${email}`,
  oauthLink: (id: string) => `oauth:link:${id}`,
};

export type OAuthProvider = 'google' | 'github';
export type SessionPlatform = 'web' | 'android' | 'ios';

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  role: string;
  location: string;
  isOwner: boolean;
  presence: string;
  status: string;
  providers: { google: boolean; github: boolean };
  createdAt: string;
};

export type SessionRecord = {
  userId: string;
  createdAt: string;
  userAgent: string;
  ip: string;
  platform: SessionPlatform;
};

export type UploadedPhoto = {
  buffer: Buffer;
  mimetype: string;
  size: number;
};

export type OAuthProfile = {
  provider: OAuthProvider;
  providerId: string;
  email: string;
  name: string;
  photoUrl?: string | null;
};

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || 'CW').toUpperCase();
}

export function usernameFromEmail(email: string): string {
  const local = (email.split('@')[0] ?? 'user').toLowerCase().replace(/[^a-z0-9._]/g, '');
  return local.slice(0, 24) || 'user';
}

export function randomTone() {
  return TONES[randomInt(0, TONES.length)];
}

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function uniqueSuffix() {
  return randomBytes(2).toString('hex');
}

export function detectPlatform(ua: string): SessionPlatform {
  const value = ua.toLowerCase();
  if (value.includes('android')) return 'android';
  if (value.includes('iphone') || value.includes('ipad') || value.includes('ios')) {
    return 'ios';
  }
  return 'web';
}

export function clientIp(ip?: string, forwarded?: unknown) {
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || ip || '';
  }
  return ip ?? '';
}

export function toPublicUser(user: {
  _id: { toString(): string };
  name: string;
  email: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl?: string | null;
  role?: string;
  location?: string;
  isOwner?: boolean;
  presence?: string;
  status?: string;
  providers?: { googleId?: string | null; githubId?: string | null };
  createdAt?: Date;
}): PublicUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    username: user.username,
    initials: user.initials,
    tone: user.tone,
    photoUrl: user.photoUrl ?? null,
    role: user.role ?? '',
    location: user.location ?? '',
    isOwner: Boolean(user.isOwner),
    presence: user.presence ?? 'offline',
    status: user.status ?? 'active',
    providers: {
      google: Boolean(user.providers?.googleId),
      github: Boolean(user.providers?.githubId),
    },
    createdAt: (user.createdAt ?? new Date()).toISOString(),
  };
}

export function providerField(provider: OAuthProvider) {
  return provider === 'google' ? 'googleId' : 'githubId';
}
