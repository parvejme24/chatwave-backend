export const CALL_TYPES = ['audio', 'video'] as const;
export const CALL_STATUSES = ['ringing', 'active', 'ended', 'missed', 'declined'] as const;
export const CALL_DIRECTIONS = ['in', 'out'] as const;
export const ICE_PATHS = ['p2p', 'turn', 'unknown'] as const;
export const CALL_FILTERS = ['all', 'missed', 'voice', 'video'] as const;

export type CallType = (typeof CALL_TYPES)[number];
export type CallStatus = (typeof CALL_STATUSES)[number];
export type CallFilter = (typeof CALL_FILTERS)[number];
export type CallSection = 'today' | 'yesterday' | 'older';
export type ViewerDirection = 'in' | 'out' | 'missed';
export type IceServer = { urls: string; username?: string; credential?: string };
export type CallPeer = {
  id: string;
  name: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  presence: string;
  group: boolean;
};
export type CallDto = {
  id: string;
  conversationId: string;
  type: CallType;
  status: CallStatus;
  initiatedBy: string;
  peer: CallPeer;
  href: string;
  startedAt: string;
  answeredAt: string | null;
  durationSec: number;
  iceServers: IceServer[];
};
export type CallRecordDto = {
  id: string;
  section: CallSection;
  name: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  presence: string;
  group: boolean;
  type: CallType;
  status: 'ended' | 'missed' | 'declined';
  direction: ViewerDirection;
  subtitle: string;
  duration?: string;
  endTag: null;
  actions: Array<{ type: CallType; href: string; label: string }>;
};

export const callRoom = (id: string) => `call:${id}`;
export const asType = (value: string): CallType => (value === 'video' ? 'video' : 'audio');
export const kindWord = (type: string) => (type === 'video' ? 'video' : 'voice');
export const callLabel = (type: string, missed = false) =>
  missed ? `Missed ${kindWord(type)} call` : type === 'video' ? 'Video call' : 'Voice call';
export const mmss = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
export const callHref = (type: string, peer: string, extra: Record<string, string> = {}) =>
  `/call?${new URLSearchParams({ type, peer, ...extra })}`;

export function callDirection(status: string, initiatedBy: string, viewerId: string): ViewerDirection {
  if (status === 'missed' || (status === 'declined' && initiatedBy !== viewerId)) return 'missed';
  return initiatedBy === viewerId ? 'out' : 'in';
}

function dayKey(date: Date, tz?: string) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function callSection(startedAt: Date, tz?: string, now = new Date()): CallSection {
  const day = dayKey(startedAt, tz);
  const today = dayKey(now, tz);
  if (day === today) return 'today';
  const [y, m, d] = today.split('-').map(Number);
  const yest = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) - 1));
  const ymd = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, '0')}-${String(yest.getUTCDate()).padStart(2, '0')}`;
  return day === ymd ? 'yesterday' : 'older';
}

export function clock(date: Date, tz?: string) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(date);
  }
}

export function asStatus(value: string): CallStatus {
  return CALL_STATUSES.includes(value as CallStatus) ? (value as CallStatus) : 'ended';
}
