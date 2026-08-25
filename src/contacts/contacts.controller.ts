import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { AddContactDto, ListContactsDto, UpdateContactDto } from './contacts.dto';
import { ContactsService } from './contacts.service';

@Controller('contacts')
@UseGuards(SessionGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@CurrentUser() viewer: AuthViewer, @Query() query: ListContactsDto) {
    return this.contacts.list(viewer, query.q, query.presence);
  }

  @Get('online')
  online(@CurrentUser() viewer: AuthViewer) {
    return this.contacts.list(viewer, undefined, 'online');
  }

  @Get('invite-link')
  inviteLink(@CurrentUser() viewer: AuthViewer) {
    return this.contacts.inviteLink(viewer);
  }

  @Get('suggestions')
  suggestions(@CurrentUser() viewer: AuthViewer) {
    return this.contacts.suggestions(viewer);
  }

  @Post()
  async add(@CurrentUser() viewer: AuthViewer, @Body() dto: AddContactDto, @Res({ passthrough: true }) res: Response) {
    const { created, contact } = await this.contacts.add(viewer, dto);
    res.status(created ? 201 : 200);
    return { contact };
  }

  @Patch(':personId')
  updateNote(@CurrentUser() viewer: AuthViewer, @Param('personId') personId: string, @Body() dto: UpdateContactDto) {
    return this.contacts.updateNote(viewer, personId, dto.note);
  }

  @Delete(':personId')
  @HttpCode(200)
  remove(@CurrentUser() viewer: AuthViewer, @Param('personId') personId: string) {
    return this.contacts.remove(viewer, personId);
  }

  @Post(':personId/chat')
  @HttpCode(200)
  openChat(@CurrentUser() viewer: AuthViewer, @Param('personId') personId: string) {
    return this.contacts.openChat(viewer, personId);
  }
}
