import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../blocks/blocks.module';
import { ContactsModule } from '../contacts/contacts.module';
import { UsersModule } from '../users/users.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { Conversation, ConversationSchema } from './conversation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Conversation.name, schema: ConversationSchema }]),
    UsersModule,
    forwardRef(() => BlocksModule),
    forwardRef(() => ContactsModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
