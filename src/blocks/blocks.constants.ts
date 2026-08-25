export const CANNOT_BLOCK_SELF = 'You cannot block yourself';
export const USER_NOT_FOUND = 'User not found';
export const PICK_SOMEONE = 'Pick someone to block';
export const MESSAGE_BLOCKED = 'You cannot message this person';
export const CONTACT_BLOCKED = 'You cannot add this person';

export const BLOCKS_CHECK = 'BLOCKS_CHECK';
export const CONTACTS_ACTIONS = 'CONTACTS_ACTIONS';
export const CHAT_REALTIME = 'CHAT_REALTIME';

export type BlockDto = {
  id: string;
  name: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  blockedAt: string;
};
