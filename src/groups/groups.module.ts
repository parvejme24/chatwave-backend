import { Module, forwardRef } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../blocks/blocks.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [UsersModule, ConversationsModule, MessagesModule, forwardRef(() => BlocksModule), forwardRef(() => AuthModule)],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
