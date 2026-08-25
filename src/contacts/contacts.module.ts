import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../blocks/blocks.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { Contact, ContactSchema } from './contact.schema';
import { CONTACTS_ACTIONS } from '../blocks/blocks.constants';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Contact.name, schema: ContactSchema }]),
    UsersModule,
    forwardRef(() => ConversationsModule),
    forwardRef(() => BlocksModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [ContactsController],
  providers: [ContactsService, { provide: CONTACTS_ACTIONS, useExisting: ContactsService }],
  exports: [ContactsService, CONTACTS_ACTIONS],
})
export class ContactsModule {}
