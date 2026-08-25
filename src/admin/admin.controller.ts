import { Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { ListAdminUsersDto } from './admin.dto';
import { AdminService } from './admin.service';
import { OwnerGuard } from './owner.guard';

@Controller('admin')
@UseGuards(SessionGuard, OwnerGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  list(@Query() query: ListAdminUsersDto) {
    return this.admin.list(query);
  }

  @Get('users/:id')
  get(@Param('id') id: string) {
    return this.admin.get(id);
  }

  @Post('users/:id/ban')
  @HttpCode(200)
  ban(@CurrentUser() actor: AuthViewer, @Param('id') id: string) {
    return this.admin.ban(actor, id);
  }

  @Post('users/:id/unban')
  @HttpCode(200)
  unban(@CurrentUser() actor: AuthViewer, @Param('id') id: string) {
    return this.admin.unban(actor, id);
  }

  @Delete('users/:id')
  @HttpCode(200)
  remove(@CurrentUser() actor: AuthViewer, @Param('id') id: string) {
    return this.admin.remove(actor, id);
  }
}
