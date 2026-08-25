import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BlocksService } from '../blocks/blocks.service';
import { MailService } from '../common/mail/mail.service';
import { RedisService } from '../common/redis/redis.service';
import { SessionsService } from '../sessions/sessions.service';
import { UsersService } from '../users/users.service';
import { BAD_SOUND, SETTINGS_DEFAULTS, SOUND_DEFAULTS, mergeSettings } from './settings.constants';
import { UpdateSettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';

const A = '64a000000000000000000001';
const viewer = { id: A, isOwner: true };

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: A,
    email: 'ayesha@example.com',
    isOwner: true,
    emailVerifiedAt: new Date(),
    providers: { googleId: 'g-1' },
    settings: { ...SETTINGS_DEFAULTS, soundFavorites: { ...SOUND_DEFAULTS } },
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('SettingsService', () => {
  let service: SettingsService;
  const users = {
    findActiveById: jest.fn(),
    toOwnerPayload: jest.fn(),
    closeAccount: jest.fn(),
  };
  const blocks = { listBlockedIds: jest.fn() };
  const sessions = { list: jest.fn() };
  const redis = { setDeleteToken: jest.fn(), consumeDeleteToken: jest.fn(), deleteAllSessions: jest.fn() };
  const mail = { sendConfirmDeleteAccount: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3000') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const me = user();
    users.findActiveById.mockResolvedValue(me);
    users.toOwnerPayload.mockResolvedValue({ id: A, isOwner: true, settings: { showLastSeen: true, readReceipts: true } });
    blocks.listBlockedIds.mockResolvedValue(['x', 'y']);
    sessions.list.mockResolvedValue({ sessions: [{ id: 'sess-1', current: true }] });
    const module = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: UsersService, useValue: users },
        { provide: BlocksService, useValue: blocks },
        { provide: SessionsService, useValue: sessions },
        { provide: RedisService, useValue: redis },
        { provide: MailService, useValue: mail },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(SettingsService);
  });

  it('merges partial soundFavorites with defaults', async () => {
    const me = user({ settings: { soundFavorites: { send: 'bubble' } } });
    users.findActiveById.mockResolvedValue(me);
    await service.update(viewer, { soundFavorites: { notify: 'bell' } });
    expect(me.settings.soundFavorites).toEqual({ ...SOUND_DEFAULTS, send: 'bubble', notify: 'bell' });
    expect(me.markModified).toHaveBeenCalledWith('settings');
  });

  it('rejects an unknown sound id', async () => {
    const err = await service.update(viewer, { soundFavorites: { send: 'laser' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({ error: BAD_SOUND });
  });

  it('cannot PATCH isOwner', async () => {
    const dto = plainToInstance(UpdateSettingsDto, { isOwner: true, theme: 'dark' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
    const me = user({ isOwner: false });
    users.findActiveById.mockResolvedValue(me);
    await service.update({ id: A, isOwner: false }, { theme: 'dark' });
    expect(me.isOwner).toBe(false);
    expect(me.settings).not.toHaveProperty('isOwner');
  });

  it('GET includes blockedCount and isOwner', async () => {
    const page = await service.getForUser(viewer, 'sess-1');
    expect(page.isOwner).toBe(true);
    expect(page.privacy.blockedCount).toBe(2);
    expect(page.settings).toMatchObject({
      theme: SETTINGS_DEFAULTS.theme,
      videoQuality: SETTINGS_DEFAULTS.videoQuality,
      readReceipts: true,
      showLastSeen: true,
    });
    expect(page.sessions).toEqual([{ id: 'sess-1', current: true }]);
    expect(page.auth.providers).toEqual({ google: true, github: false });
  });

  it('fills missing settings keys from defaults', () => {
    expect(mergeSettings({ readReceipts: false }).readReceipts).toBe(false);
    expect(mergeSettings({ readReceipts: false }).theme).toBe('system');
    expect(mergeSettings({ soundFavorites: { send: 'click' } }).soundFavorites.send).toBe('click');
    expect(mergeSettings({ soundFavorites: { send: 'click' } }).soundFavorites.typing).toBe('tick');
  });
});
