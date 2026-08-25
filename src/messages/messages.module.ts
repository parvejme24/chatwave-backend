import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { ChatGateway } from './messages.gateway';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { Message, MessageSchema } from './message.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    UsersModule,
    ConversationsModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, ChatGateway],
  exports: [MessagesService],
})
export class MessagesModule {}
