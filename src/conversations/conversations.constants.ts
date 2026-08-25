import { TONES } from '../users/users.constants';

export const MIN_GROUP_MEMBERS = 3;
export const CONVERSATION_TYPES = ['direct', 'group'] as const;
export const MEMBER_ROLES = ['admin', 'member'] as const;
export const LIST_FILTERS = ['all', 'unread', 'groups', 'archived', 'calls'] as const;

export type ConversationType = (typeof CONVERSATION_TYPES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type PreviewIcon = 'mic' | 'video' | 'image';
export type ListFilter = (typeof LIST_FILTERS)[number];

export type ConversationListItem = {
  id: string;
  type: ConversationType;
  group: boolean;
  name: string;
  username: string | null;
  initials: string;
  tone: string;
  photoUrl: string | null;
  presence: string;
  status: string;
  sub: string;
  time: string;
  unread: number;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  preview: string;
  previewIcon: PreviewIcon | null;
  live: boolean;
};

export type ConversationDetail = ConversationListItem & {
  createdBy: string;
  members: Array<{
    id: string;
    name: string;
    username: string;
    initials: string;
    tone: string;
    photoUrl: string | null;
    presence: string;
    role: MemberRole;
    isMe: boolean;
  }>;
  messages: [];
};

export function pairKey(a: string, b: string) {
  return [a, b].sort().join(':');
}

export function toneFromName(name: string) {
  return TONES[name.length % TONES.length];
}
