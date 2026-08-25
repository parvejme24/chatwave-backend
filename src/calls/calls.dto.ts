import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { CALL_FILTERS, CALL_TYPES } from './calls.constants';

export class StartCallDto {
  @IsMongoId({ message: 'Pick a chat to call' })
  conversationId!: string;

  @IsIn(CALL_TYPES, { message: 'Pick audio or video' })
  type!: (typeof CALL_TYPES)[number];
}

export class EndCallDto {
  @IsOptional()
  @IsIn(['p2p', 'turn'], { message: 'Pick a valid ICE path' })
  ice?: 'p2p' | 'turn';
}

export class ListCallsDto {
  @IsOptional()
  @IsIn(CALL_FILTERS)
  filter: (typeof CALL_FILTERS)[number] = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}
