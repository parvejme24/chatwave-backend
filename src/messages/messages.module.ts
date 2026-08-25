import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../blocks/blocks.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { ChatGateway } from './messages.gateway';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { Message, MessageSchema } from './message.schema';
import { CHAT_REALTIME } from '../blocks/blocks.constants';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    UsersModule,
    ConversationsModule,
    forwardRef(() => BlocksModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, ChatGateway, { provide: CHAT_REALTIME, useExisting: ChatGateway }],
  exports: [MessagesService, ChatGateway, CHAT_REALTIME],
})
export class MessagesModule {}
