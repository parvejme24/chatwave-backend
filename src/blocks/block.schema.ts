import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'blocks' })
export class Block {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  blocker: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  blocked: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type BlockDocument = HydratedDocument<Block>;
export const BlockSchema = SchemaFactory.createForClass(Block);

BlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
BlockSchema.index({ blocked: 1, blocker: 1 });
BlockSchema.pre('validate', function () {
  if (this.blocker && this.blocked && String(this.blocker) === String(this.blocked)) {
    throw new Error('You cannot block yourself');
  }
});
