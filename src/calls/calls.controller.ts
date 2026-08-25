import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { CallsService } from './calls.service';
import { EndCallDto, ListCallsDto, StartCallDto } from './calls.dto';

@Controller('calls')
@UseGuards(SessionGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post()
  @HttpCode(201)
  start(@CurrentUser() viewer: AuthViewer, @Body() dto: StartCallDto) {
    return this.calls.start(viewer, dto.conversationId, dto.type);
  }

  @Get('quality')
  quality(@CurrentUser() viewer: AuthViewer) {
    return this.calls.quality(viewer);
  }

  @Get()
  list(@CurrentUser() viewer: AuthViewer, @Query() query: ListCallsDto) {
    return this.calls.list(viewer, query.filter, query.limit, query.tz);
  }

  @Get(':id')
  getOne(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.calls.getOne(viewer, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.calls.accept(viewer, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.calls.decline(viewer, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentUser() viewer: AuthViewer, @Param('id') id: string, @Body() dto: EndCallDto) {
    return this.calls.end(viewer, id, dto.ice);
  }
}
