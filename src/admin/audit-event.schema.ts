import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

import { AUDIT_KINDS } from './admin.constants';

@Schema({ timestamps: true, collection: 'auditevents' })
export class AuditEvent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actor: Types.ObjectId | null;

  @Prop({ required: true, enum: AUDIT_KINDS })
  kind: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: '' })
  detail: string;

  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  meta: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export type AuditEventDocument = HydratedDocument<AuditEvent>;
export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);

AuditEventSchema.index({ user: 1, createdAt: -1 });
AuditEventSchema.index({ kind: 1, createdAt: -1 });
