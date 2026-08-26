import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { coerceLinks, SENDABLE_TYPES } from './messages.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SendMessageDto {
  @IsOptional()
  @IsIn(SENDABLE_TYPES, { message: 'Pick a valid message type' })
  type: (typeof SENDABLE_TYPES)[number] = 'text';

  @IsOptional()
  @IsString()
  @MaxLength(4000, { message: 'That message is too long' })
  text?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000, { message: 'That caption is too long' })
  caption?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(3600)
  duration?: number;

  @IsOptional()
  @IsMongoId({ message: 'Reply to a valid message' })
  replyTo?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => coerceLinks(value))
  @IsArray()
  @ArrayMaxSize(10, { message: 'You can attach up to 10 links' })
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }, { each: true, message: 'Use a valid http or https link' })
  links?: string[];
}

export class ListMessagesDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;

  @IsOptional()
  @IsIn(['all', 'pinned'])
  view: 'all' | 'pinned' = 'all';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class ReactDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Pick an emoji' })
  @MaxLength(8, { message: 'That emoji is too long' })
  emoji!: string;
}

export class DeleteMessageDto {
  @IsOptional()
  @IsIn(['me', 'everyone'], { message: 'Choose me or everyone' })
  scope?: 'me' | 'everyone';
}
