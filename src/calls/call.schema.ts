import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { CALL_DIRECTIONS, CALL_STATUSES, CALL_TYPES, ICE_PATHS } from './calls.constants';

@Schema({ _id: false })
export class CallParticipant {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true, enum: CALL_DIRECTIONS })
  direction: string;

  @Prop({ type: Date, default: null })
  joinedAt: Date | null;

  @Prop({ type: Date, default: null })
  leftAt: Date | null;
}

@Schema({ timestamps: true, collection: 'calls' })
export class Call {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true })
  conversation: Types.ObjectId;

  @Prop({ required: true, enum: CALL_TYPES })
  type: string;

  @Prop({ enum: CALL_STATUSES, default: 'ringing' })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  initiatedBy: Types.ObjectId;

  @Prop({ type: [CallParticipant], required: true })
  participants: CallParticipant[];

  @Prop({ default: 0, min: 0 })
  durationSec: number;

  @Prop({ enum: ICE_PATHS, default: 'unknown' })
  ice: string;

  @Prop({ type: Date, default: Date.now })
  startedAt: Date;

  @Prop({ type: Date, default: null })
  answeredAt: Date | null;

  @Prop({ type: Date, default: null })
  endedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  endedBy: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export type CallDocument = HydratedDocument<Call>;
export const CallSchema = SchemaFactory.createForClass(Call);
CallSchema.index({ 'participants.user': 1, startedAt: -1 });
CallSchema.index({ conversation: 1, startedAt: -1 });
CallSchema.index({ status: 1, startedAt: -1 });
