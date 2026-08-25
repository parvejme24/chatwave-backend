import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'contacts' })
export class Contact {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  owner: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  person: Types.ObjectId;

  @Prop({ default: '', trim: true, maxlength: 120 })
  note: string;

  createdAt: Date;
  updatedAt: Date;
}

export type ContactDocument = HydratedDocument<Contact>;
export const ContactSchema = SchemaFactory.createForClass(Contact);

ContactSchema.index({ owner: 1, person: 1 }, { unique: true });
ContactSchema.index({ owner: 1, createdAt: -1 });
ContactSchema.pre('validate', function () {
  if (this.owner && this.person && String(this.owner) === String(this.person)) {
    throw new Error('You cannot add yourself');
  }
});
