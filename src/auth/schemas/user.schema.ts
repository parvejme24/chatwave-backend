import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { PRESENCE, STATUSES, TONES } from '../auth.constants';

@Schema({ _id: false })
export class UserProviders {
  @Prop({ type: String })
  googleId?: string;

  @Prop({ type: String })
  githubId?: string;
}

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true, maxlength: 60 })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  username: string;

  @Prop({ type: String, select: false, default: null })
  passwordHash: string | null;

  @Prop({ required: true, uppercase: true, maxlength: 2 })
  initials: string;

  @Prop({ enum: TONES, default: 'a' })
  tone: string;

  @Prop({ type: String, default: null })
  photoUrl: string | null;

  @Prop({ type: String, default: null })
  photoPublicId: string | null;

  @Prop({ default: '', trim: true })
  role: string;

  @Prop({ default: '', trim: true })
  location: string;

  @Prop({ default: false })
  isOwner: boolean;

  @Prop({ enum: PRESENCE, default: 'offline' })
  presence: string;

  @Prop({ type: Date })
  lastSeenAt?: Date;

  @Prop({ enum: STATUSES, default: 'active' })
  status: string;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: UserProviders, default: () => ({}) })
  providers: UserProviders;

  @Prop({ type: Date, default: null })
  emailVerifiedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ status: 1, deletedAt: 1 });
UserSchema.index(
  { 'providers.googleId': 1 },
  { unique: true, sparse: true },
);
UserSchema.index(
  { 'providers.githubId': 1 },
  { unique: true, sparse: true },
);
