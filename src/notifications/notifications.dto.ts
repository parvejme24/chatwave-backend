import { Transform, Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListNotificationsDto {
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
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unreadOnly = false;
}

export class ReadNotificationsDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true, message: 'Pick valid notifications' })
  ids?: string[];
}
