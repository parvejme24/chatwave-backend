import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { ConfirmDeleteDto, UpdateSettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @UseGuards(SessionGuard)
  get(@CurrentUser() viewer: AuthViewer, @CurrentUser('sessionId') sessionId: string) {
    return this.settings.getForUser(viewer, sessionId);
  }

  @Patch()
  @UseGuards(SessionGuard)
  update(
    @CurrentUser() viewer: AuthViewer,
    @CurrentUser('sessionId') sessionId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.settings.update(viewer, dto, sessionId);
  }

  @Get('sounds')
  @UseGuards(SessionGuard)
  sounds(@CurrentUser() viewer: AuthViewer) {
    return this.settings.sounds(viewer);
  }

  @Post('delete-account')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  requestDelete(@CurrentUser() viewer: AuthViewer) {
    return this.settings.requestDelete(viewer);
  }

  @Post('delete-account/confirm')
  @HttpCode(200)
  confirmDelete(@Body() dto: ConfirmDeleteDto) {
    return this.settings.confirmDelete(dto);
  }
}
