import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { collectUploads, FILE_MAX, FILES_MAX, type UploadedChatFile } from './messages.constants';
import { DeleteMessageDto, ListMessagesDto, ReactDto, SendMessageDto } from './messages.dto';
import { MessagesService } from './messages.service';

@Controller()
@UseGuards(SessionGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('conversations/:conversationId/messages')
  list(
    @CurrentUser() viewer: AuthViewer,
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messages.list(viewer, conversationId, query);
  }

  @Post('conversations/:conversationId/messages')
  @HttpCode(201)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'files', maxCount: FILES_MAX },
      ],
      { limits: { fileSize: FILE_MAX, files: FILES_MAX } },
    ),
  )
  send(
    @CurrentUser() viewer: AuthViewer,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @UploadedFiles() uploaded?: { file?: UploadedChatFile[]; files?: UploadedChatFile[] },
  ) {
    return this.messages.send(viewer, conversationId, dto, collectUploads(uploaded));
  }

  @Post('conversations/:conversationId/delivered')
  @HttpCode(200)
  delivered(@CurrentUser() viewer: AuthViewer, @Param('conversationId') conversationId: string) {
    return this.messages.mark(viewer, conversationId, 'delivered');
  }

  @Post('conversations/:conversationId/seen')
  @HttpCode(200)
  seen(@CurrentUser() viewer: AuthViewer, @Param('conversationId') conversationId: string) {
    return this.messages.mark(viewer, conversationId, 'seen');
  }

  @Post('messages/:id/reactions')
  @HttpCode(200)
  react(@CurrentUser() viewer: AuthViewer, @Param('id') id: string, @Body() dto: ReactDto) {
    return this.messages.toggleReaction(viewer, id, dto.emoji);
  }

  @Post('messages/:id/pin')
  @HttpCode(200)
  pin(@CurrentUser() viewer: AuthViewer, @Param('id') id: string) {
    return this.messages.togglePin(viewer, id);
  }

  @Delete('messages/:id')
  remove(
    @CurrentUser() viewer: AuthViewer,
    @Param('id') id: string,
    @Query() query: DeleteMessageDto,
    @Body() body: DeleteMessageDto,
  ) {
    return this.messages.remove(viewer, id, body?.scope ?? query?.scope ?? 'me');
  }
}
