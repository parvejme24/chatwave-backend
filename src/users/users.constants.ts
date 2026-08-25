import { randomInt } from 'crypto';

export const TONES = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export const PRESENCE = ['online', 'away', 'offline'] as const;
export const STATUSES = ['active', 'banned'] as const;
export const PHOTO_MAX = 2 * 1024 * 1024;
export const PHOTO_FOLDER = 'chatwave/avatars';
export const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PRESENCE_TTL = 45;
export const LAST_SEEN_THROTTLE = 60;

export type Presence = (typeof PRESENCE)[number];
export type LivePresence = 'online' | 'away';

export type UploadedPhoto = { buffer: Buffer; mimetype: string; size: number };
export type AuthViewer = { id: string; isOwner: boolean };

export type OwnerUser = {
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
  lastSeenAt: string | null;
  status: string;
  providers: { google: boolean; github: boolean };
  settings: { showLastSeen: boolean; readReceipts: boolean };
  createdAt: string;
};

export type PublicUser = {
  id: string;
  name: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  role: string;
  location: string;
  presence: string;
  lastSeenAt: string | null;
  sub: string;
};

export function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || 'CW').toUpperCase();
}

export function usernameFromEmail(email: string) {
  let local = (email.split('@')[0] ?? 'user').toLowerCase().replace(/[^a-z0-9._]/g, '');
  if (local.length < 3) local = `${local}user`.slice(0, 24);
  return local.slice(0, 24) || 'user';
}

export function randomTone() {
  return TONES[randomInt(0, TONES.length)];
}

export function isManagedUserHidden(user: { status?: string | null; deletedAt?: Date | string | null }) {
  return user.status === 'banned' || user.deletedAt != null;
}
