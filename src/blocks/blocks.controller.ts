import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import type { AuthViewer } from '../users/users.constants';
import { CreateBlockDto } from './blocks.dto';
import { BlocksService } from './blocks.service';

@Controller('blocks')
@UseGuards(SessionGuard)
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  list(@CurrentUser() viewer: AuthViewer) {
    return this.blocks.list(viewer);
  }

  @Post()
  async add(@CurrentUser() viewer: AuthViewer, @Body() dto: CreateBlockDto, @Res({ passthrough: true }) res: Response) {
    const { created, block } = await this.blocks.add(viewer, dto);
    res.status(created ? 201 : 200);
    return { block };
  }

  @Delete(':userId')
  @HttpCode(200)
  remove(@CurrentUser() viewer: AuthViewer, @Param('userId') userId: string) {
    return this.blocks.remove(viewer, userId);
  }
}
