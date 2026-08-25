import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

import { THEMES, VIDEO_QUALITIES, allowedSounds } from './settings.constants';

export class SoundFavoritesDto {
  @IsOptional()
  @IsIn(allowedSounds('send'), { message: 'That sound is not available' })
  send?: string;

  @IsOptional()
  @IsIn(allowedSounds('typing'), { message: 'That sound is not available' })
  typing?: string;

  @IsOptional()
  @IsIn(allowedSounds('notify'), { message: 'That sound is not available' })
  notify?: string;

  @IsOptional()
  @IsIn(allowedSounds('incoming'), { message: 'That sound is not available' })
  incoming?: string;

  @IsOptional()
  @IsIn(allowedSounds('callStart'), { message: 'That sound is not available' })
  callStart?: string;

  @IsOptional()
  @IsIn(allowedSounds('callEnd'), { message: 'That sound is not available' })
  callEnd?: string;

  @IsOptional()
  @IsIn(allowedSounds('delete'), { message: 'That sound is not available' })
  delete?: string;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsIn(THEMES, { message: 'Pick a valid theme' })
  theme?: (typeof THEMES)[number];

  @IsOptional()
  @IsBoolean()
  reduceMotion?: boolean;

  @IsOptional()
  @IsBoolean()
  messageNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  notificationSounds?: boolean;

  @IsOptional()
  @IsBoolean()
  missedCallEmails?: boolean;

  @IsOptional()
  @IsBoolean()
  unreadDigest?: boolean;

  @IsOptional()
  @IsBoolean()
  readReceipts?: boolean;

  @IsOptional()
  @IsBoolean()
  showLastSeen?: boolean;

  @IsOptional()
  @IsIn(VIDEO_QUALITIES, { message: 'Pick a valid video quality' })
  videoQuality?: (typeof VIDEO_QUALITIES)[number];

  @IsOptional()
  @IsBoolean()
  noiseSuppression?: boolean;

  @IsOptional()
  @IsBoolean()
  autoDownload?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SoundFavoritesDto)
  soundFavorites?: SoundFavoritesDto;
}

export class ConfirmDeleteDto {
  @IsString()
  @MinLength(8, { message: 'This link has expired' })
  token!: string;
}
