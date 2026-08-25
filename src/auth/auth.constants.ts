import { randomInt } from 'crypto';
import type { Request } from 'express';

export const AUTH_COOKIE = 'cw_session';
export const BCRYPT_COST = 12;
export const SESSION_TTL = 60 * 60 * 24 * 7;
export const OTP_TTL = 60 * 10;
export const OTP_WINDOW = 60 * 15;
export const OTP_MAX = 5;

export { PHOTO_MAX } from '../users/users.constants';

export const redisKey = {
  session: (id: string) => `sess:${id}`,
  userSessions: (id: string) => `user_sessions:${id}`,
  otp: (email: string) => `otp:reset:${email}`,
  otpCount: (email: string) => `otp:reset:count:${email}`,
  oauthLink: (id: string) => `oauth:link:${id}`,
  deleteAccount: (token: string) => `delete:${token}`,
};

export type OAuthProvider = 'google' | 'github';
export type SessionPlatform = 'web' | 'android' | 'ios';

export type SessionMeta = {
  userAgent: string;
  ip: string;
  platform: SessionPlatform;
};

export type SessionRecord = SessionMeta & {
  userId: string;
  createdAt: string;
  lastActiveAt: string;
  device: string;
  browser: string;
  city: string;
  country: string;
};

export type OAuthProfile = {
  provider: OAuthProvider;
  providerId: string;
  email: string;
  name: string;
  photoUrl?: string | null;
};

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function detectPlatform(ua: string): SessionPlatform {
  const value = ua.toLowerCase();
  if (value.includes('android')) return 'android';
  if (value.includes('iphone') || value.includes('ipad') || value.includes('ios')) {
    return 'ios';
  }
  return 'web';
}

export function browserName(ua: string) {
  const value = ua.toLowerCase();
  if (value.includes('edg/')) return 'Edge';
  if (value.includes('chrome/') || value.includes('crios/')) return 'Chrome';
  if (value.includes('firefox/') || value.includes('fxios/')) return 'Firefox';
  if (value.includes('safari/') && !value.includes('chrome')) return 'Safari';
  return 'ChatWave';
}

export function osName(ua: string) {
  const value = ua.toLowerCase();
  if (value.includes('android')) return 'Android';
  if (value.includes('iphone') || value.includes('ipad') || value.includes('ios')) return 'iOS';
  if (value.includes('mac os')) return 'macOS';
  if (value.includes('windows')) return 'Windows';
  if (value.includes('linux')) return 'Linux';
  return 'Web';
}

export function deviceLabel(ua: string, platform: SessionPlatform) {
  if (platform === 'android') return 'ChatWave on Android';
  if (platform === 'ios') return 'ChatWave on iOS';
  return `${browserName(ua)} on ${osName(ua)}`;
}

export function maskIp(ip: string) {
  if (!ip) return '';
  if (ip.includes(':')) return ip.replace(/[0-9a-f]+$/i, 'x');
  return ip.replace(/\.\d+$/, '.x');
}

export function clientIp(ip?: string, forwarded?: unknown) {
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || ip || '';
  }
  return ip ?? '';
}

export function providerField(provider: OAuthProvider) {
  return provider === 'google' ? 'googleId' : 'githubId';
}

export function cookieSessionId(req: Request) {
  return (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
}
