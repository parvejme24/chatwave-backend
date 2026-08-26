import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../blocks/blocks.module';
import { CONVERSATIONS_ACTIONS } from '../blocks/blocks.constants';
import { CloudinaryModule } from '../common/cloudinary/cloudinary.module';
import { ContactsModule } from '../contacts/contacts.module';
import { Message, MessageSchema } from '../messages/message.schema';
import { UsersModule } from '../users/users.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { Conversation, ConversationSchema } from './conversation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    CloudinaryModule,
    UsersModule,
    forwardRef(() => BlocksModule),
    forwardRef(() => ContactsModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    { provide: CONVERSATIONS_ACTIONS, useExisting: ConversationsService },
  ],
  exports: [ConversationsService, CONVERSATIONS_ACTIONS],
})
export class ConversationsModule {}
