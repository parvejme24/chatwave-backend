import { Controller, Delete, Get, HttpCode, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { SessionsService } from './sessions.service';

@Controller('auth/sessions')
@UseGuards(SessionGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  list(@CurrentUser() viewer: AuthViewer, @CurrentUser('sessionId') sessionId: string) {
    return this.sessions.list(viewer, sessionId);
  }

  @Delete(':id')
  @HttpCode(200)
  revoke(
    @CurrentUser() viewer: AuthViewer,
    @CurrentUser('sessionId') sessionId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sessions.revoke(viewer, id, sessionId, res);
  }
}
