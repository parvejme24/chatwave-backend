import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { TONES } from '../users/users.constants';
import { CONVERSATION_TYPES, MEMBER_ROLES } from './conversations.constants';

@Schema({ _id: false })
export class ConversationMember {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ enum: MEMBER_ROLES, default: 'member' })
  role: string;

  @Prop({ default: false })
  pinned: boolean;

  @Prop({ default: false })
  muted: boolean;

  @Prop({ default: false })
  archived: boolean;

  @Prop({ default: 0, min: 0 })
  unreadCount: number;

  @Prop({ type: Date, default: null })
  lastReadAt: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  lastReadMessage: Types.ObjectId | null;

  @Prop({ type: Date, default: Date.now })
  joinedAt: Date;

  @Prop({ type: Date, default: null })
  leftAt: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  removedBy: Types.ObjectId | null;
}

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({ required: true, enum: CONVERSATION_TYPES })
  type: string;

  @Prop({ trim: true, default: '' })
  name: string;

  @Prop({ uppercase: true, maxlength: 2, default: '' })
  initials: string;

  @Prop({ enum: TONES, default: 'e' })
  tone: string;

  @Prop({ type: String, default: null })
  photo: string | null;

  @Prop({ type: String, default: null })
  photoPublicId: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: [ConversationMember], default: [] })
  members: ConversationMember[];

  @Prop({ type: Types.ObjectId, default: null })
  lastMessage: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  lastMessageSender: Types.ObjectId | null;

  @Prop({ type: Date, default: Date.now })
  lastMessageAt: Date;

  @Prop({ default: '' })
  preview: string;

  @Prop({ type: String, default: null })
  previewIcon: string | null;

  @Prop({ type: String })
  pairKey?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type ConversationDocument = HydratedDocument<Conversation>;
export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ 'members.user': 1, lastMessageAt: -1 });
ConversationSchema.index({ type: 1, lastMessageAt: -1 });
ConversationSchema.index({ pairKey: 1 }, { unique: true, sparse: true });
