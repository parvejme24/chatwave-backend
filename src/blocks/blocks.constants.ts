export const CANNOT_BLOCK_SELF = 'You cannot block yourself';
export const USER_NOT_FOUND = 'User not found';
export const PICK_SOMEONE = 'Pick someone to block';
export const MESSAGE_BLOCKED =
  "You can't message this person. One of you has blocked the other.";
export const CONTACT_BLOCKED =
  "You can't add this person. One of you has blocked the other.";

export const BLOCKS_CHECK = 'BLOCKS_CHECK';
export const CONTACTS_ACTIONS = 'CONTACTS_ACTIONS';
export const CHAT_REALTIME = 'CHAT_REALTIME';
export const CONVERSATIONS_ACTIONS = 'CONVERSATIONS_ACTIONS';

export type BlockDto = {
  id: string;
  name: string;
  username: string;
  initials: string;
  tone: string;
  photoUrl: string | null;
  blockedAt: string;
};
