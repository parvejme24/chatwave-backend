import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { AuditKind } from './admin.constants';
import { AuditEvent, AuditEventDocument } from './audit-event.schema';

export type AuditLogInput = {
  user: string;
  actor?: string | null;
  kind: AuditKind;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditEvent.name) private readonly events: Model<AuditEventDocument>) {}

  async log(input: AuditLogInput) {
    await this.events.create({
      user: new Types.ObjectId(input.user),
      actor: input.actor ? new Types.ObjectId(input.actor) : null,
      kind: input.kind,
      title: input.title,
      detail: input.detail ?? '',
      meta: input.meta ?? {},
    });
  }

  listForUser(userId: string, limit: number) {
    return this.events
      .find({ user: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }
}
