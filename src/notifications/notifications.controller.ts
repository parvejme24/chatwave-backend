import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { ListNotificationsDto, ReadNotificationsDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() viewer: AuthViewer, @Query() query: ListNotificationsDto) {
    return this.notifications.list(viewer, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() viewer: AuthViewer) {
    return { unreadCount: await this.notifications.unreadCount(viewer.id) };
  }

  @Post('read')
  @HttpCode(200)
  readMany(@CurrentUser() viewer: AuthViewer, @Body() dto: ReadNotificationsDto) {
    return this.notifications.markRead(viewer, dto.ids);
  }

  @Post(':id/read')
  @HttpCode(200)
  readOne(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.notifications.markOne(viewer, id);
  }
}
