import { isValidObjectId, Types } from 'mongoose';

export const OWNER_ONLY = 'This area is only for the owner.';
export const CANNOT_MODERATE_OWNER = 'Cannot moderate the owner account';
export const USER_NOT_FOUND = 'User not found';
export const ACCOUNT_DELETED = 'This account was deleted';

export const AUDIT_KINDS = [
  'signup',
  'login',
  'message',
  'media',
  'call',
  'group',
  'ban',
  'unban',
  'delete',
] as const;

export const HISTORY_CAP = 100;
export const MESSAGE_HISTORY_CAP = 30;
export const CALL_HISTORY_CAP = 30;
export const GROUP_HISTORY_CAP = 10;

export type AuditKind = (typeof AUDIT_KINDS)[number];
export type HistoryKind = AuditKind;

export type ManagedUserListDto = {
  id: string;
  name: string;
  user: string;
  username: string;
  email: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  presence: string;
  note: string;
  joined: string;
  lastSeen: string;
  status: 'active' | 'banned';
  eventCount: number;
  isOwner: boolean;
};

export type UserHistoryEvent = {
  id: string;
  at: string;
  day: string;
  kind: HistoryKind;
  title: string;
  detail: string;
};

export type RawHistoryEvent = {
  id: string;
  at: Date;
  kind: HistoryKind;
  title: string;
  detail: string;
};

export function isMongoId(id: string) {
  return isValidObjectId(id) && String(new Types.ObjectId(id)) === id;
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatJoined(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDay(date: Date, now = new Date()) {
  const day = utcDay(date);
  const today = utcDay(now);
  if (day === today) return 'Today';
  if (day === utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)))) {
    return 'Yesterday';
  }
  return formatJoined(date);
}

export function toHistoryEvent(row: RawHistoryEvent, now = new Date()): UserHistoryEvent {
  return {
    id: row.id,
    at: formatClock(row.at),
    day: formatDay(row.at, now),
    kind: row.kind,
    title: row.title,
    detail: row.detail,
  };
}

function utcDay(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
