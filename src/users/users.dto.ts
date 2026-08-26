import { Type, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PRESENCE, TONES } from './users.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateProfileDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Enter your name' })
  @MaxLength(60, { message: 'Name is too long' })
  name?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : value,
  )
  @IsString()
  @MinLength(3, { message: 'Username is too short' })
  @MaxLength(24, { message: 'Username is too long' })
  @Matches(/^[a-z0-9._]+$/, {
    message: 'Username can only use letters, numbers, dots, and underscores',
  })
  username?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80, { message: 'Role is too long' })
  role?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80, { message: 'Location is too long' })
  location?: string;

  @IsOptional()
  @IsIn(TONES, { message: 'Pick a valid avatar tone' })
  tone?: (typeof TONES)[number];
}

export class UpdatePresenceDto {
  @IsIn(PRESENCE, { message: 'Presence must be online, away, or offline' })
  presence!: (typeof PRESENCE)[number];
}

export class SearchUsersDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(PRESENCE)
  presence?: (typeof PRESENCE)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

/** GET /api/users — discoverable directory (not search). */
export class ListUsersDirectoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(PRESENCE)
  presence?: (typeof PRESENCE)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 200;
}
