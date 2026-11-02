import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AppEnv } from './config/env.validation';

// Render's free tier sleeps after 15 minutes without inbound traffic, so ping our own public URL.
@Injectable()
export class KeepAliveJob {
  private readonly logger = new Logger(KeepAliveJob.name);

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handle() {
    if (this.config.get('NODE_ENV', { infer: true }) !== 'production') return;
    const url = process.env.RENDER_EXTERNAL_URL || this.config.get('API_URL', { infer: true });
    if (!url) return;

    try {
      await fetch(url, { signal: AbortSignal.timeout(10000) });
    } catch (error) {
      this.logger.warn(`Keep-alive ping to ${url} failed: ${String(error)}`);
    }
  }
}
