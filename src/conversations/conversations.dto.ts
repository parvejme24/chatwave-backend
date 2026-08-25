import { Type, Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { TONES } from '../users/users.constants';
import { LIST_FILTERS, MIN_GROUP_MEMBERS } from './conversations.constants';

export class CreateDirectDto {
  @IsMongoId({ message: 'Pick someone to chat with' })
  userId!: string;
}

export class CreateGroupDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'Give this group a name' })
  @MaxLength(60, { message: 'Group name is too long' })
  name!: string;

  @ArrayMinSize(MIN_GROUP_MEMBERS, { message: 'Add at least 3 other people' })
  @ArrayUnique({ message: 'Remove duplicate people' })
  @IsMongoId({ each: true, message: 'Pick valid people' })
  memberIds!: string[];
}

export class UpdateConversationDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'Give this group a name' })
  @MaxLength(60, { message: 'Group name is too long' })
  name?: string;

  @IsOptional()
  @IsIn(TONES, { message: 'Pick a valid avatar tone' })
  tone?: (typeof TONES)[number];
}

export class UpdateMembershipDto {
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ListConversationsDto {
  @IsOptional()
  @IsIn(LIST_FILTERS)
  filter: (typeof LIST_FILTERS)[number] = 'all';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
