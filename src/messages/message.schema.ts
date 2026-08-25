import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { MESSAGE_TYPES, RECEIPT_STATUSES } from './messages.constants';

@Schema({ _id: false })
export class MessageReaction {
  @Prop({ required: true })
  emoji: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  users: Types.ObjectId[];
}

@Schema({ _id: false })
export class MessageReceipt {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true, enum: RECEIPT_STATUSES })
  status: string;

  @Prop({ type: Date, default: Date.now })
  at: Date;
}

@Schema({ _id: false })
export class MessageMedia {
  @Prop({ default: '' })
  url: string;

  @Prop({ default: '' })
  publicId: string;

  @Prop({ default: '' })
  fileName: string;

  @Prop({ default: '' })
  fileSize: string;

  @Prop({ default: '' })
  mimeType: string;

  @Prop({ default: 0 })
  duration: number;

  @Prop({ default: 0 })
  seed: number;

  @Prop({ default: 0 })
  width: number;

  @Prop({ default: 0 })
  height: number;
}

@Schema({ timestamps: true, collection: 'messages' })
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversation: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  sender: Types.ObjectId | null;

  @Prop({ required: true, enum: MESSAGE_TYPES })
  type: string;

  @Prop({ default: '' })
  text: string;

  @Prop({ default: '' })
  caption: string;

  @Prop({ type: MessageMedia, default: () => ({}) })
  media: MessageMedia;

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  replyTo: Types.ObjectId | null;

  @Prop({ type: [MessageReaction], default: [] })
  reactions: MessageReaction[];

  @Prop({ default: false })
  pinned: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  pinnedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  pinnedAt: Date | null;

  @Prop({ type: [MessageReceipt], default: [] })
  receipts: MessageReceipt[];

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy: Types.ObjectId | null;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  deletedFor: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, default: null, index: true })
  callId: Types.ObjectId | null;

  @Prop({ type: { kind: String, missed: Boolean, label: String, meta: String, callId: String }, default: null })
  callMeta: { kind: string; missed: boolean; label: string; meta: string; callId: string } | null;

  createdAt: Date;
  updatedAt: Date;
}

export type MessageDocument = HydratedDocument<Message>;
export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ conversation: 1, createdAt: -1 });
MessageSchema.index({ conversation: 1, pinned: 1, createdAt: -1 });
MessageSchema.index({ conversation: 1, deletedAt: 1, createdAt: -1 });
MessageSchema.index({ text: 'text', caption: 'text', 'media.fileName': 'text' });
