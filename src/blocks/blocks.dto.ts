import { Transform } from 'class-transformer';
import { IsMongoId, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateBlockDto {
  @ValidateIf((dto: CreateBlockDto) => !dto.username)
  @IsMongoId({ message: 'Pick someone to block' })
  userId?: string;

  @ValidateIf((dto: CreateBlockDto) => !dto.userId)
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
}
