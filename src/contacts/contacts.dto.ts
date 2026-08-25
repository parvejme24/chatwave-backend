import { Transform } from 'class-transformer';
import { IsIn, IsMongoId, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

import { PRESENCE } from '../users/users.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AddContactDto {
  @ValidateIf((dto: AddContactDto) => !dto.username)
  @IsMongoId({ message: 'Pick someone to add' })
  userId?: string;

  @ValidateIf((dto: AddContactDto) => !dto.userId)
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
  @MaxLength(120, { message: 'Keep the note under 120 characters' })
  note?: string;
}

export class UpdateContactDto {
  @Transform(trim)
  @IsString()
  @MaxLength(120, { message: 'Keep the note under 120 characters' })
  note!: string;
}

export class ListContactsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(PRESENCE)
  presence?: (typeof PRESENCE)[number];
}
