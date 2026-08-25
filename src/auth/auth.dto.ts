import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export { UpdateProfileDto } from '../users/users.dto';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase().trim() : value;

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
