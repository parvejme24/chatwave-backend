import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AppEnv } from '../config/env.validation';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GithubStrategy, GoogleStrategy, LocalStrategy } from './auth.strategies';
import { SessionGuard } from './guards/session.guard';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    PassportModule.register({ session: false }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionGuard,
    LocalStrategy,
    GoogleStrategy,
    GithubStrategy,
  ],
  exports: [AuthService, SessionGuard, JwtModule],
})
export class AuthModule {}
