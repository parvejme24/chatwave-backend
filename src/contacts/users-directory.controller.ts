import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { ListContactsDto } from './contacts.dto';
import { ContactsService } from './contacts.service';

@Controller('users')
@UseGuards(SessionGuard)
export class UsersDirectoryController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  async list(@CurrentUser() viewer: AuthViewer, @Query() query: ListContactsDto) {
    const result = await this.contacts.list(viewer, query.q, query.presence, query.limit);
    return { users: result.contacts, total: result.total, onlineCount: result.onlineCount };
  }
}
