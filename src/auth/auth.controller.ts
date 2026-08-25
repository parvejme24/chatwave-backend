import {
  Body,
  Controller,
  Get,
  HttpCode,
  Next,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import passport from 'passport';

import { PHOTO_MAX, type OAuthProvider, type PublicUser, type UploadedPhoto } from './auth.constants';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { SessionGuard } from './guards/session.guard';
import type { UserDocument } from './schemas/user.schema';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, req, res);
  }

  @Get('google')
  google(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    this.startOAuth('google', req, res, next);
  }

  @Get('google/callback')
  googleCallback(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    this.oauthCallback('google', req, res, next);
  }

  @Get('github')
  github(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    this.startOAuth('github', req, res, next);
  }

  @Get('github/callback')
  githubCallback(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    this.oauthCallback('github', req, res, next);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(
    @CurrentUser() user: PublicUser,
    @CurrentUser('sessionId') sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.getMe(user, sessionId, res);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  logout(
    @CurrentUser() user: PublicUser,
    @CurrentUser('sessionId') sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(user.id, sessionId, res);
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  logoutAll(@CurrentUser() user: PublicUser, @Res({ passthrough: true }) res: Response) {
    return this.auth.logoutAll(user.id, res);
  }

  @Patch('profile')
  @UseGuards(SessionGuard)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: PHOTO_MAX } }))
  updateProfile(
    @CurrentUser() user: PublicUser,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() file?: UploadedPhoto,
  ) {
    return this.auth.updateProfile(user.id, dto, file);
  }

  @Post('link/google')
  @UseGuards(SessionGuard)
  linkGoogle(@CurrentUser() user: PublicUser, @Res() res: Response) {
    return this.auth.startOAuthLink(user.id, 'google', res);
  }

  @Post('link/github')
  @UseGuards(SessionGuard)
  linkGithub(@CurrentUser() user: PublicUser, @Res() res: Response) {
    return this.auth.startOAuthLink(user.id, 'github', res);
  }

  private startOAuth(
    provider: OAuthProvider,
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    this.auth.assertOAuthConfigured(provider);
    const scope = provider === 'google' ? ['email', 'profile'] : ['user:email'];
    passport.authenticate(provider, { scope, session: false })(req, res, next);
  }

  private oauthCallback(
    provider: OAuthProvider,
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    passport.authenticate(
      provider,
      { session: false },
      (err: unknown, user: UserDocument | false) => {
        void this.completeOAuth(err, user, req, res);
      },
    )(req, res, next);
  }

  private async completeOAuth(
    err: unknown,
    user: UserDocument | false,
    req: Request,
    res: Response,
  ) {
    try {
      if (err || !user) {
        this.auth.redirectOAuthError(res);
        return;
      }
      await this.auth.finishOAuth(user, req, res);
    } catch {
      this.auth.redirectOAuthError(res);
    }
  }
}
