import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { BlocksModule } from '../blocks/blocks.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { UsersModule } from '../users/users.module';
import { Call, CallSchema } from './call.schema';
import { CallsController } from './calls.controller';
import { CallsGateway } from './calls.gateway';
import { CallsRealtime } from './calls.realtime';
import { CallsService } from './calls.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Call.name, schema: CallSchema }]),
    UsersModule,
    ConversationsModule,
    MessagesModule,
    forwardRef(() => BlocksModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway, CallsRealtime],
})
export class CallsModule {}
