import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { User } from './schemas/user.schema';
import { RedisService } from '../common/redis/redis.service';
import { MailService } from '../common/mail/mail.service';
import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { BCRYPT_COST } from './auth.constants';

function mockQuery<T>(value: T) {
  const query = {
    select: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  query.select.mockReturnValue(query);
  return query;
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => 'user-1' },
    name: 'Ayesha Rahman',
    email: 'ayesha@example.com',
    username: 'ayesha',
    initials: 'AR',
    tone: 'a',
    photoUrl: null,
    role: '',
    location: '',
    isOwner: false,
    presence: 'offline',
    status: 'active',
    deletedAt: null,
    passwordHash: null,
    providers: { googleId: null, githubId: null },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  const userModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
  };
  const redis = {
    createSession: jest.fn().mockResolvedValue('session-1'),
    deleteAllSessions: jest.fn().mockResolvedValue(undefined),
    deleteOtp: jest.fn().mockResolvedValue(undefined),
    getOtpHash: jest.fn(),
    setOtpHash: jest.fn().mockResolvedValue(undefined),
    incrementOtpCount: jest.fn().mockResolvedValue(1),
  };
  const mail = {
    sendPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
  };
  const jwt = {
    sign: jest.fn().mockReturnValue('access-token'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    redis.createSession.mockResolvedValue('session-1');
    jwt.sign.mockReturnValue('access-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: RedisService, useValue: redis },
        { provide: MailService, useValue: mail },
        { provide: CloudinaryService, useValue: {} },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                JWT_SECRET: 'test-jwt-secret-key-32',
                NODE_ENV: 'test',
                FRONTEND_URL: 'http://localhost:3000',
                API_URL: 'http://localhost:5000',
              };
              return values[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('creates a user without starting a session', async () => {
      userModel.findOne.mockReturnValue(mockQuery(null));
      userModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });
      const created = makeUser({ isOwner: true });
      userModel.create.mockResolvedValue(created);

      const result = await service.register({
        name: 'Ayesha Rahman',
        email: 'ayesha@example.com',
        password: 'password1',
      });

      expect(userModel.create).toHaveBeenCalled();
      expect(result.user.email).toBe('ayesha@example.com');
      expect(result.user.isOwner).toBe(true);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(redis.createSession).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email with 409', async () => {
      userModel.findOne.mockReturnValue(mockQuery(makeUser()));

      await expect(
        service.register({
          name: 'Ayesha Rahman',
          email: 'ayesha@example.com',
          password: 'password1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    const req = {
      headers: { 'user-agent': 'jest' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const res = { cookie: jest.fn() } as unknown as Response;

    it('returns the user and access token for a valid password', async () => {
      const passwordHash = await bcrypt.hash('password1', BCRYPT_COST);
      const user = makeUser({ passwordHash });
      userModel.findOne.mockReturnValue(mockQuery(user));

      const result = await service.login(
        { email: 'ayesha@example.com', password: 'password1' },
        req,
        res,
      );

      expect(result.accessToken).toBe('access-token');
      expect(result.user.id).toBe('user-1');
      expect(redis.createSession).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalled();
    });

    it('rejects a banned account', async () => {
      const passwordHash = await bcrypt.hash('password1', BCRYPT_COST);
      userModel.findOne.mockReturnValue(
        mockQuery(makeUser({ passwordHash, status: 'banned' })),
      );

      await expect(
        service.login(
          { email: 'ayesha@example.com', password: 'password1' },
          req,
          res,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an oauth-only account with no password', async () => {
      userModel.findOne.mockReturnValue(
        mockQuery(makeUser({ passwordHash: null, providers: { googleId: 'g1' } })),
      );

      await expect(
        service.login(
          { email: 'ayesha@example.com', password: 'password1' },
          req,
          res,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('resetPassword', () => {
    it('sets a new password and revokes redis sessions', async () => {
      const otp = '123456';
      const otpHash = await bcrypt.hash(otp, BCRYPT_COST);
      const user = makeUser({ passwordHash: 'old' });
      userModel.findOne.mockReturnValue(mockQuery(user));
      redis.getOtpHash.mockResolvedValue(otpHash);

      const result = await service.resetPassword({
        email: 'ayesha@example.com',
        otp,
        password: 'newpass12',
      });

      expect(result).toEqual({ ok: true });
      expect(user.save).toHaveBeenCalled();
      expect(redis.deleteOtp).toHaveBeenCalledWith('ayesha@example.com');
      expect(redis.deleteAllSessions).toHaveBeenCalledWith('user-1');
    });

    it('rejects an invalid otp', async () => {
      const otpHash = await bcrypt.hash('999999', BCRYPT_COST);
      userModel.findOne.mockReturnValue(mockQuery(makeUser()));
      redis.getOtpHash.mockResolvedValue(otpHash);

      await expect(
        service.resetPassword({
          email: 'ayesha@example.com',
          otp: '123456',
          password: 'newpass12',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
