import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { ContactsService } from '../contacts/contacts.service';
import { PHOTO_MAX, type AuthViewer, type UploadedPhoto } from '../users/users.constants';
import {
  CreateDirectDto,
  CreateGroupDto,
  ListConversationsDto,
  UpdateConversationDto,
  UpdateMembershipDto,
} from './conversations.dto';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
@UseGuards(SessionGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    @Inject(forwardRef(() => ContactsService)) private readonly contacts: ContactsService,
  ) {}

  @Get()
  list(@CurrentUser() viewer: AuthViewer, @Query() query: ListConversationsDto) {
    return this.conversations.list(viewer, query.filter, query.q, query.limit);
  }

  @Post('direct')
  async createDirect(
    @CurrentUser() viewer: AuthViewer,
    @Body() dto: CreateDirectDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, conversation } = await this.conversations.createDirect(viewer, dto.userId);
    res.status(created ? 201 : 200);
    return { conversation };
  }

  @Post('groups')
  createGroup(@CurrentUser() viewer: AuthViewer, @Body() dto: CreateGroupDto) {
    return this.conversations.createGroup(viewer, dto.name, dto.memberIds);
  }

  @Get(':id')
  getOne(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.conversations.getOne(viewer, id);
  }

  @Patch(':id')
  update(@CurrentUser() viewer: AuthViewer, @Param('id') id: string, @Body() dto: UpdateConversationDto) {
    return this.conversations.updateGroup(viewer, id, dto);
  }

  @Patch(':id/photo')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: PHOTO_MAX } }))
  updatePhoto(
    @CurrentUser() viewer: AuthViewer,
    @Param('id') id: string,
    @UploadedFile() file?: UploadedPhoto,
  ) {
    if (!file) throw new BadRequestException({ error: 'Choose a photo to upload' });
    return this.conversations.updateGroupPhoto(viewer, id, file);
  }

  @Delete(':id/photo')
  deletePhoto(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.conversations.deleteGroupPhoto(viewer, id);
  }

  @Patch(':id/membership')
  membership(@CurrentUser() viewer: AuthViewer, @Param('id') id: string, @Body() dto: UpdateMembershipDto) {
    return this.conversations.updateMembership(viewer, id, dto);
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.conversations.markRead(viewer, id);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    const { peerId } = await this.conversations.deleteConversation(viewer, id);
    if (peerId) await this.contacts.remove(viewer, peerId, { keepChat: true });
    return { ok: true as const };
  }
}
