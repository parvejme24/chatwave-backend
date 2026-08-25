import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsDigestJob {
  constructor(private readonly notifications: NotificationsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  handle() {
    return this.notifications.sendDigests();
  }
}
