import type { SessionPlatform, SessionRecord } from '../auth/auth.constants';
import { browserName, deviceLabel, maskIp } from '../auth/auth.constants';

export type SessionDto = {
  id: string;
  device: string;
  platform: SessionPlatform;
  browser: string;
  city: string;
  country: string;
  ip: string;
  current: boolean;
  lastActiveAt: string;
  lastActiveLabel: string;
  createdAt: string;
};

export function lastActiveLabel(iso: string) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return 'active now';
  const delta = Date.now() - at;
  if (delta < 60_000) return 'active now';
  if (delta < 3_600_000) {
    const n = Math.max(1, Math.floor(delta / 60_000));
    return n === 1 ? '1 minute ago' : `${n} minutes ago`;
  }
  if (delta < 86_400_000) {
    const n = Math.max(1, Math.floor(delta / 3_600_000));
    return n === 1 ? '1 hour ago' : `${n} hours ago`;
  }
  const n = Math.max(1, Math.floor(delta / 86_400_000));
  return n === 1 ? '1 day ago' : `${n} days ago`;
}

export function toSessionDto(row: SessionRecord & { id: string }, currentId: string): SessionDto {
  const lastActiveAt = row.lastActiveAt || row.createdAt;
  const platform = row.platform === 'android' || row.platform === 'ios' ? row.platform : 'web';
  return {
    id: row.id,
    device: row.device || deviceLabel(row.userAgent ?? '', platform),
    platform,
    browser: row.browser || browserName(row.userAgent ?? ''),
    city: row.city ?? '',
    country: row.country ?? '',
    ip: maskIp(row.ip ?? ''),
    current: row.id === currentId,
    lastActiveAt,
    lastActiveLabel: lastActiveLabel(lastActiveAt),
    createdAt: row.createdAt,
  };
}
