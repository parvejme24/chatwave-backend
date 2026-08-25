import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { SearchUsersDto, UpdatePresenceDto, UpdateProfileDto } from './users.dto';
import { PHOTO_MAX, type AuthViewer, type UploadedPhoto } from './users.constants';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() viewer: AuthViewer) {
    return this.users.getMe(viewer.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() viewer: AuthViewer, @Body() dto: UpdateProfileDto) {
    return this.users.updateMe(viewer.id, dto);
  }

  @Patch('me/photo')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: PHOTO_MAX } }))
  updatePhoto(@CurrentUser() viewer: AuthViewer, @UploadedFile() file?: UploadedPhoto) {
    if (!file) throw new BadRequestException({ error: 'Choose a photo to upload' });
    return this.users.updatePhoto(viewer.id, file);
  }

  @Delete('me/photo')
  deletePhoto(@CurrentUser() viewer: AuthViewer) {
    return this.users.deletePhoto(viewer.id);
  }

  @Patch('me/presence')
  updatePresence(@CurrentUser() viewer: AuthViewer, @Body() dto: UpdatePresenceDto) {
    return this.users.setPresence(viewer.id, dto.presence);
  }

  @Get('search')
  search(@CurrentUser() viewer: AuthViewer, @Query() query: SearchUsersDto) {
    return this.users.search(viewer, query.q, query.presence, query.limit);
  }

  @Get('online')
  online(@CurrentUser() viewer: AuthViewer) {
    return this.users.listOnline(viewer);
  }

  @Get('by-username/:username')
  byUsername(@CurrentUser() viewer: AuthViewer, @Param('username') username: string) {
    return this.users.getPublicByUsername(viewer, username);
  }

  @Get(':id')
  byId(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.users.getPublicById(viewer, id);
  }
}
