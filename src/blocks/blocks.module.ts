import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { Block, BlockSchema } from './block.schema';
import { BLOCKS_CHECK } from './blocks.constants';
import { BlocksController } from './blocks.controller';
import { BlocksService } from './blocks.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Block.name, schema: BlockSchema }]),
    forwardRef(() => UsersModule),
    forwardRef(() => AuthModule),
  ],
  controllers: [BlocksController],
  providers: [BlocksService, { provide: BLOCKS_CHECK, useExisting: BlocksService }],
  exports: [BlocksService, BLOCKS_CHECK],
})
export class BlocksModule {}
