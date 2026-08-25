import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy as GitHubStrategyBase, Profile as GitHubProfileBase } from 'passport-github2';
import { Profile as GoogleProfile, Strategy as GoogleStrategyBase } from 'passport-google-oauth20';
import { Strategy as LocalStrategyBase } from 'passport-local';

import { AppEnv } from '../config/env.validation';
import { AuthService, OAuthFlowError } from './auth.service';
import type { UserDocument } from '../users/user.schema';

@Injectable()
export class LocalStrategy extends PassportStrategy(LocalStrategyBase) {
  constructor(private readonly auth: AuthService) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  validate(email: string, password: string): Promise<UserDocument> {
    if (!email || !password) {
      throw new UnauthorizedException({ error: 'Invalid email or password' });
    }
    return this.auth.validateLocalUser(email, password);
  }
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(GoogleStrategyBase, 'google') {
  constructor(
    config: ConfigService<AppEnv, true>,
    private readonly auth: AuthService,
  ) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID', { infer: true }) || 'not-configured',
      clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true }) || 'not-configured',
      callbackURL: `${config.get('API_URL', { infer: true })}/api/auth/google/callback`,
      scope: ['email', 'profile'],
      passReqToCallback: true,
    });
  }

  validate(req: Request, _a: string, _r: string, profile: GoogleProfile) {
    const email = profile.emails?.[0]?.value;
    if (!email) throw new OAuthFlowError('Google did not share an email address');
    return this.auth.upsertOAuthUser(
      {
        provider: 'google',
        providerId: profile.id,
        email,
        name: profile.displayName || email.split('@')[0] || 'ChatWave user',
        photoUrl: profile.photos?.[0]?.value ?? null,
      },
      req,
    );
  }
}

type GitHubProfile = GitHubProfileBase & {
  emails?: { value?: string; primary?: boolean; verified?: boolean }[];
  _json?: { email?: string; avatar_url?: string; name?: string; login?: string };
};

@Injectable()
export class GithubStrategy extends PassportStrategy(GitHubStrategyBase, 'github') {
  constructor(
    config: ConfigService<AppEnv, true>,
    private readonly auth: AuthService,
  ) {
    super({
      clientID: config.get('GITHUB_CLIENT_ID', { infer: true }) || 'not-configured',
      clientSecret: config.get('GITHUB_CLIENT_SECRET', { infer: true }) || 'not-configured',
      callbackURL: `${config.get('API_URL', { infer: true })}/api/auth/github/callback`,
      scope: ['user:email'],
      passReqToCallback: true,
    });
  }

  validate(req: Request, _a: string, _r: string, profile: GitHubProfile) {
    const emails = (profile.emails ?? []) as {
      value?: string;
      primary?: boolean;
      verified?: boolean;
    }[];
    const email =
      emails.find((item) => item.primary && item.verified)?.value ||
      emails.find((item) => item.verified)?.value ||
      emails[0]?.value ||
      profile._json?.email;

    if (!email) {
      throw new OAuthFlowError(
        'GitHub did not share an email address. Make a primary email public, or use another sign-in method.',
      );
    }

    const json = profile._json ?? {};
    return this.auth.upsertOAuthUser(
      {
        provider: 'github',
        providerId: String(profile.id),
        email,
        name: profile.displayName || json.name || json.login || email.split('@')[0] || 'ChatWave user',
        photoUrl: json.avatar_url ?? profile.photos?.[0]?.value ?? null,
      },
      req,
    );
  }
}
