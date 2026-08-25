import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

import { AppEnv } from '../../config/env.validation';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly isDev: boolean;

  constructor(private readonly config: ConfigService<AppEnv, true>) {
    this.from = this.config.get('EMAIL_FROM', { infer: true });
    this.isDev =
      this.config.get('NODE_ENV', { infer: true }) !== 'production';

    const host = this.config.get('SMTP_HOST', { infer: true });
    const user = this.config.get('SMTP_USER', { infer: true });
    const pass = this.config.get('SMTP_PASS', { infer: true });
    const port = this.config.get('SMTP_PORT', { infer: true });

    if (!host || !user || !pass) {
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    const subject = 'ChatWave verification code';
    const text = [
      `Your ChatWave verification code is ${otp}.`,
      'This code expires in 10 minutes.',
      'If you did not request a password reset, you can ignore this email.',
    ].join('\n');
    const html = `
      <p>Your ChatWave verification code is <strong>${otp}</strong>.</p>
      <p>This code expires in 10 minutes.</p>
      <p>If you did not request a password reset, you can ignore this email.</p>
    `;

    if (!this.transporter) {
      if (this.isDev) {
        this.logger.warn(`SMTP is not configured. OTP for ${email}: ${otp}`);
        return;
      }
      throw new Error('Email is not configured');
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject,
        text,
        html,
      });
    } catch (error) {
      if (this.isDev) {
        const message = error instanceof Error ? error.message : 'send failed';
        this.logger.warn(`SMTP send failed (${message}). OTP for ${email}: ${otp}`);
        return;
      }
      throw error;
    }
  }

  async sendAccountBanned(email: string, name: string): Promise<void> {
    const subject = 'Your ChatWave account has been banned';
    const text = [
      `Hi ${name},`,
      'Your ChatWave account has been banned by the owner.',
      'If you think this is a mistake, reply to this email.',
    ].join('\n');
    const html = `
      <p>Hi ${name},</p>
      <p>Your ChatWave account has been banned by the owner.</p>
      <p>If you think this is a mistake, reply to this email.</p>
    `;

    if (!this.transporter) {
      if (this.isDev) {
        this.logger.warn(`SMTP is not configured. Banned-account notice for ${email}`);
        return;
      }
      throw new Error('Email is not configured');
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject,
        text,
        html,
      });
    } catch (error) {
      if (this.isDev) {
        const message = error instanceof Error ? error.message : 'send failed';
        this.logger.warn(`SMTP send failed (${message}). Banned-account notice for ${email}`);
        return;
      }
      throw error;
    }
  }

  async sendConfirmDeleteAccount(email: string, url: string): Promise<void> {
    const subject = 'Confirm your ChatWave account deletion';
    const text = [
      'Confirm that you want to delete your ChatWave account.',
      `Open this link within 30 minutes: ${url}`,
      'If you did not ask to delete your account, you can ignore this email.',
    ].join('\n');
    const html = `
      <p>Confirm that you want to delete your ChatWave account.</p>
      <p><a href="${url}">Delete my account</a></p>
      <p>This link expires in 30 minutes. If you did not ask to delete your account, you can ignore this email.</p>
    `;

    if (this.isDev) {
      this.logger.warn(`Delete-account link for ${email}: ${url}`);
    }

    if (!this.transporter) {
      if (this.isDev) {
        this.logger.warn(`SMTP is not configured. Delete-account link for ${email}: ${url}`);
        return;
      }
      throw new Error('Email is not configured');
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject,
        text,
        html,
      });
    } catch (error) {
      if (this.isDev) {
        const message = error instanceof Error ? error.message : 'send failed';
        this.logger.warn(`SMTP send failed (${message}). Delete-account link for ${email}: ${url}`);
        return;
      }
      throw error;
    }
  }
}
