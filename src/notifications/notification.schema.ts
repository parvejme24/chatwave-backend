import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

import { NOTIFICATION_TYPES } from './notifications.constants';

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true, enum: NOTIFICATION_TYPES })
  type: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: '' })
  body: string;

  @Prop({ type: Types.ObjectId, ref: 'Conversation', default: null })
  conversation: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Message', default: null })
  message: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Call', default: null })
  call: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actor: Types.ObjectId | null;

  @Prop({ default: '' })
  href: string;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  @Prop({ type: Date, default: null })
  emailSentAt: Date | null;

  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  meta: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, type: 1, createdAt: -1 });
