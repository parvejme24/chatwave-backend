export const THEMES = ['light', 'dark', 'system'] as const;
export const VIDEO_QUALITIES = ['auto', '720p', '1080p'] as const;
export const SOUND_OFF = 'off';
export const DELETE_TTL = 60 * 30;
export const BAD_SOUND = 'That sound is not available';
export const BAD_TOKEN = 'This link has expired';
export const DELETE_EMAIL_FAILED = 'Could not send the confirmation email';

export const SOUND_EVENTS = [
  { id: 'send', title: 'Send message', hint: 'When you send a text, voice, or video note' },
  { id: 'notify', title: 'Notification', hint: 'Incoming message alert' },
  { id: 'incoming', title: 'Incoming call', hint: 'Rings while a call is waiting' },
  { id: 'callStart', title: 'Start call', hint: 'When a voice or video call connects' },
  { id: 'callEnd', title: 'End call', hint: 'When a call ends or is declined' },
  { id: 'typing', title: 'Typing', hint: 'Key ticks while you write' },
  { id: 'delete', title: 'Delete message', hint: 'When you remove a message' },
] as const;

export type SoundEvent = (typeof SOUND_EVENTS)[number]['id'];
export type Theme = (typeof THEMES)[number];
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

export const SOUND_OPTIONS: Record<SoundEvent, Array<{ id: string; name: string }>> = {
  send: [
    { id: 'pop', name: 'Pop' },
    { id: 'soft', name: 'Soft' },
    { id: 'click', name: 'Click' },
    { id: 'bubble', name: 'Bubble' },
  ],
  typing: [
    { id: 'tick', name: 'Tick' },
    { id: 'soft', name: 'Soft' },
    { id: 'knock', name: 'Knock' },
  ],
  notify: [
    { id: 'chime', name: 'Chime' },
    { id: 'ping', name: 'Ping' },
    { id: 'bell', name: 'Bell' },
    { id: 'marimba', name: 'Marimba' },
  ],
  incoming: [
    { id: 'classic', name: 'Classic' },
    { id: 'bright', name: 'Bright' },
    { id: 'soft', name: 'Soft' },
    { id: 'pulse', name: 'Pulse' },
  ],
  callStart: [
    { id: 'sweep', name: 'Sweep' },
    { id: 'rise', name: 'Rise' },
    { id: 'chirp', name: 'Chirp' },
    { id: 'fanfare', name: 'Fanfare' },
  ],
  callEnd: [
    { id: 'drop', name: 'Drop' },
    { id: 'fade', name: 'Fade' },
    { id: 'click', name: 'Click' },
    { id: 'low', name: 'Low' },
  ],
  delete: [
    { id: 'thud', name: 'Thud' },
    { id: 'snap', name: 'Snap' },
    { id: 'whoosh', name: 'Whoosh' },
  ],
};

export type SoundFavorites = Record<SoundEvent, string>;

export const SOUND_DEFAULTS: SoundFavorites = {
  send: 'pop',
  typing: 'tick',
  notify: 'chime',
  incoming: 'classic',
  callStart: 'sweep',
  callEnd: 'drop',
  delete: 'thud',
};

export type UserSettings = {
  theme: Theme;
  reduceMotion: boolean;
  messageNotifications: boolean;
  notificationSounds: boolean;
  missedCallEmails: boolean;
  unreadDigest: boolean;
  readReceipts: boolean;
  showLastSeen: boolean;
  videoQuality: VideoQuality;
  noiseSuppression: boolean;
  autoDownload: boolean;
  soundFavorites: SoundFavorites;
};

export const SETTINGS_DEFAULTS: UserSettings = {
  theme: 'system',
  reduceMotion: false,
  messageNotifications: true,
  notificationSounds: true,
  missedCallEmails: true,
  unreadDigest: false,
  readReceipts: true,
  showLastSeen: true,
  videoQuality: '720p',
  noiseSuppression: true,
  autoDownload: false,
  soundFavorites: { ...SOUND_DEFAULTS },
};

export function allowedSounds(event: SoundEvent) {
  return [...SOUND_OPTIONS[event].map((option) => option.id), SOUND_OFF];
}

export function mergeFavorites(current?: Partial<SoundFavorites> | null, patch?: Partial<SoundFavorites> | null): SoundFavorites {
  const next = { ...SOUND_DEFAULTS };
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (typeof value === 'string') next[key as keyof SoundFavorites] = value;
  }
  return next;
}

export function mergeSettings(
  current?: (Partial<Omit<UserSettings, 'soundFavorites'>> & { soundFavorites?: Partial<SoundFavorites> }) | null,
  patch?: (Partial<Omit<UserSettings, 'soundFavorites'>> & { soundFavorites?: Partial<SoundFavorites> }) | null,
): UserSettings {
  const src = current ?? {};
  const next = patch ?? {};
  return {
    theme: next.theme ?? src.theme ?? SETTINGS_DEFAULTS.theme,
    reduceMotion: next.reduceMotion ?? src.reduceMotion ?? SETTINGS_DEFAULTS.reduceMotion,
    messageNotifications: next.messageNotifications ?? src.messageNotifications ?? SETTINGS_DEFAULTS.messageNotifications,
    notificationSounds: next.notificationSounds ?? src.notificationSounds ?? SETTINGS_DEFAULTS.notificationSounds,
    missedCallEmails: next.missedCallEmails ?? src.missedCallEmails ?? SETTINGS_DEFAULTS.missedCallEmails,
    unreadDigest: next.unreadDigest ?? src.unreadDigest ?? SETTINGS_DEFAULTS.unreadDigest,
    readReceipts: next.readReceipts ?? src.readReceipts ?? SETTINGS_DEFAULTS.readReceipts,
    showLastSeen: next.showLastSeen ?? src.showLastSeen ?? SETTINGS_DEFAULTS.showLastSeen,
    videoQuality: next.videoQuality ?? src.videoQuality ?? SETTINGS_DEFAULTS.videoQuality,
    noiseSuppression: next.noiseSuppression ?? src.noiseSuppression ?? SETTINGS_DEFAULTS.noiseSuppression,
    autoDownload: next.autoDownload ?? src.autoDownload ?? SETTINGS_DEFAULTS.autoDownload,
    soundFavorites: mergeFavorites(src.soundFavorites, next.soundFavorites),
  };
}
