import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { AddMembersDto, SetAdminDto } from './groups.dto';
import { GroupsService } from './groups.service';

@Controller('conversations')
@UseGuards(SessionGuard)
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get(':id/members')
  listMembers(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.groups.listMembers(viewer, id);
  }

  @Post(':id/members')
  async addMembers(
    @CurrentUser() viewer: AuthViewer,
    @Param('id') id: string,
    @Body() dto: AddMembersDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, conversation } = await this.groups.addMembers(viewer, id, dto.userIds);
    res.status(created ? 201 : 200);
    return { conversation };
  }

  @Delete(':id/members/:userId')
  @HttpCode(200)
  removeMember(@CurrentUser() viewer: AuthViewer, @Param('id') id: string, @Param('userId') userId: string) {
    return this.groups.removeMember(viewer, id, userId);
  }

  @Patch(':id/members/:userId/admin')
  setAdmin(@CurrentUser() viewer: AuthViewer, @Param('id') id: string, @Param('userId') userId: string, @Body() dto: SetAdminDto) {
    return this.groups.setAdmin(viewer, id, userId, dto.isAdmin);
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.groups.leave(viewer, id);
  }
}
