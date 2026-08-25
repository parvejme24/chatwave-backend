import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { Call, CallSchema } from '../calls/call.schema';
import { Conversation, ConversationSchema } from '../conversations/conversation.schema';
import { MessagesModule } from '../messages/messages.module';
import { Message, MessageSchema } from '../messages/message.schema';
import { User, UserSchema } from '../users/user.schema';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditEvent, AuditEventSchema } from './audit-event.schema';
import { AuditService } from './audit.service';
import { OwnerGuard } from './owner.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditEvent.name, schema: AuditEventSchema },
      { name: User.name, schema: UserSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Call.name, schema: CallSchema },
      { name: Conversation.name, schema: ConversationSchema },
    ]),
    UsersModule,
    MessagesModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [AdminController],
  providers: [AdminService, AuditService, OwnerGuard],
  exports: [AuditService],
})
export class AdminModule {}
