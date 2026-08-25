import type { Presence, PublicUser } from '../users/users.constants';

export const PICK_SOMEONE = 'Pick someone to add';
export const CANNOT_ADD_SELF = 'You cannot add yourself';
export const USER_NOT_FOUND = 'User not found';
export const ACCOUNT_UNAVAILABLE = 'That account is not available';
export const CONTACT_NOT_FOUND = 'Contact not found';

export type ContactDto = {
  id: string;
  name: string;
  user: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  presence: string;
  note: string;
  sub: string;
  hrefChat?: string;
  hrefAudio: string;
  hrefVideo: string;
};

export function derivedNote(saved: string, person: PublicUser, presence: Presence) {
  const custom = saved.trim();
  if (custom) return custom;
  if (presence === 'online') return [person.role, person.location].filter(Boolean).join(' · ') || 'Online';
  if (presence === 'away') return person.role.trim() || 'Away';
  return lastSeenLine(person.lastSeenAt);
}

export function lastSeenLine(iso: string | null) {
  if (!iso) return 'Offline';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 'Offline';
  const delta = Date.now() - at;
  if (delta < 60_000) return 'Last seen just now';
  if (delta < 3_600_000) return `Last seen ${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `Last seen ${Math.floor(delta / 3_600_000)}h ago`;
  const days = Math.floor(delta / 86_400_000);
  if (days === 1) return 'Last seen yesterday';
  if (days < 7) return `Last seen ${days} days ago`;
  return `Last seen ${new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

export function callHref(type: 'audio' | 'video', name: string, userId: string) {
  return `/call?type=${type}&peer=${encodeURIComponent(name)}&userId=${userId}`;
}
