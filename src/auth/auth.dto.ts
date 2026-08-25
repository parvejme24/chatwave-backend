import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

function Email() {
  return applyDecorators(
    Transform(lower),
    IsEmail({}, { message: 'Enter a valid email address' }),
    IsNotEmpty({ message: 'Email is required' }),
  );
}

function Password(minLength = 1) {
  return applyDecorators(
    IsString({ message: 'Password is required' }),
    IsNotEmpty({ message: 'Password is required' }),
    ...(minLength >= 8
      ? [MinLength(8, { message: 'Password must be at least 8 characters' })]
      : []),
  );
}

export class RegisterDto {
  @IsString({ message: 'Name is required' })
  @IsNotEmpty({ message: 'Name is required' })
  @MinLength(2, { message: 'Enter your name' })
  @MaxLength(60, { message: 'Name is too long' })
  name!: string;

  @Email()
  email!: string;

  @Password(8)
  password!: string;
}

export class LoginDto {
  @Email()
  email!: string;

  @Password()
  password!: string;
}

export class ForgotPasswordDto {
  @Email()
  email!: string;
}

export class ResetPasswordDto {
  @Email()
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  otp!: string;

  @Password(8)
  password!: string;
}

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
  @MinLength(2, { message: 'Username is too short' })
  @MaxLength(32, { message: 'Username is too long' })
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
}
