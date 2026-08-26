import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';

import { isManagedUserHidden, type AuthViewer } from '../users/users.constants';
import { UsersService } from '../users/users.service';
import { Block, BlockDocument } from './block.schema';
import {
  CANNOT_BLOCK_SELF,
  CHAT_REALTIME,
  CONTACTS_ACTIONS,
  CONVERSATIONS_ACTIONS,
  MESSAGE_BLOCKED,
  PICK_SOMEONE,
  USER_NOT_FOUND,
  type BlockDto,
} from './blocks.constants';
import { CreateBlockDto } from './blocks.dto';

type ContactsActions = {
  remove(viewer: AuthViewer, personId: string): Promise<unknown>;
};

type ConversationsActions = {
  archiveDirectBetween(blockerId: string, blockedId: string): Promise<void>;
};

type ChatRealtime = {
  emitBlocked(blockerId: string, blockedId: string): void;
};

@Injectable()
export class BlocksService {
  constructor(
    @InjectModel(Block.name) private readonly blocks: Model<BlockDocument>,
    @Inject(forwardRef(() => UsersService)) private readonly users: UsersService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async list(viewer: AuthViewer) {
    const rows = await this.blocks.find({ blocker: new Types.ObjectId(viewer.id) }).sort({ createdAt: -1 }).exec();
    const people = await this.users.findByIds(rows.map((row) => String(row.blocked)));
    const byId = new Map(people.map((person) => [person.id, person]));
    const blocks: BlockDto[] = [];
    for (const row of rows) {
      const person = byId.get(String(row.blocked));
      if (!person || isManagedUserHidden(person)) continue;
      const profile = await this.users.publicUser(viewer, person);
      blocks.push({
        id: person.id,
        name: profile.name,
        username: profile.username,
        initials: profile.initials,
        tone: profile.tone,
        photoUrl: profile.photoUrl,
        blockedAt: (row.createdAt ?? new Date()).toISOString(),
      });
    }
    return { blocks, total: blocks.length };
  }

  async add(viewer: AuthViewer, dto: CreateBlockDto) {
    if (!dto.userId && !dto.username) throw new BadRequestException({ error: PICK_SOMEONE });
    const person = dto.userId
      ? isMongoId(dto.userId)
        ? await this.users.findById(dto.userId)
        : null
      : await this.users.findByUsername(dto.username ?? '');
    if (!person || isManagedUserHidden(person)) throw new NotFoundException({ error: USER_NOT_FOUND });
    if (person.id === viewer.id) throw new BadRequestException({ error: CANNOT_BLOCK_SELF });
    const existing = await this.blocks.findOne(pair(viewer.id, person.id)).exec();
    if (existing) return { created: false, block: await this.toDto(viewer, person.id, existing.createdAt) };
    try {
      const row = await this.blocks.create(pair(viewer.id, person.id));
      await this.afterBlock(viewer.id, person.id);
      return { created: true, block: await this.toDto(viewer, person.id, row.createdAt) };
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const row = await this.blocks.findOne(pair(viewer.id, person.id)).exec();
      if (!row) throw error;
      return { created: false, block: await this.toDto(viewer, person.id, row.createdAt) };
    }
  }

  async remove(viewer: AuthViewer, userId: string) {
    if (isMongoId(userId)) await this.blocks.deleteOne(pair(viewer.id, userId)).exec();
    return { ok: true as const };
  }

  async isBlocked(a: string, b: string) {
    if (!a || !b || a === b || !isMongoId(a) || !isMongoId(b)) return false;
    return Boolean(
      await this.blocks
        .findOne({
          $or: [pair(a, b), pair(b, a)],
        })
        .exec(),
    );
  }

  async isBlockedBy(blocker: string, blocked: string) {
    if (!isMongoId(blocker) || !isMongoId(blocked)) return false;
    return Boolean(await this.blocks.findOne(pair(blocker, blocked)).exec());
  }

  async listBlockedIds(userId: string) {
    if (!isMongoId(userId)) return [] as Types.ObjectId[];
    const rows = await this.blocks.find({ blocker: new Types.ObjectId(userId) }).exec();
    return rows.map((row) => row.blocked);
  }

  async restrictedIds(userId: string) {
    const ids = new Set<string>();
    if (!isMongoId(userId)) return ids;
    const rows = await this.blocks
      .find({ $or: [{ blocker: new Types.ObjectId(userId) }, { blocked: new Types.ObjectId(userId) }] })
      .exec();
    for (const row of rows) {
      const blocker = String(row.blocker);
      const blocked = String(row.blocked);
      ids.add(blocker === userId ? blocked : blocker);
    }
    return ids;
  }

  async assertNotBlocked(userA: string, userB: string, error = MESSAGE_BLOCKED) {
    if (await this.isBlocked(userA, userB)) throw new ForbiddenException({ error });
  }

  private async afterBlock(blockerId: string, blockedId: string) {
    const viewer = (id: string) => ({ id, isOwner: false });
    const contacts = this.pick<ContactsActions>(CONTACTS_ACTIONS);
    const conversations = this.pick<ConversationsActions>(CONVERSATIONS_ACTIONS);
    const realtime = this.pick<ChatRealtime>(CHAT_REALTIME);
    try {
      await contacts?.remove(viewer(blockerId), blockedId);
      await contacts?.remove(viewer(blockedId), blockerId);
    } catch {
      /* best-effort */
    }
    try {
      await conversations?.archiveDirectBetween(blockerId, blockedId);
    } catch {
      /* best-effort */
    }
    try {
      realtime?.emitBlocked(blockerId, blockedId);
    } catch {
      /* best-effort */
    }
  }

  private pick<T>(token: string) {
    try {
      return this.moduleRef.get<T>(token, { strict: false });
    } catch {
      return undefined;
    }
  }

  private async toDto(viewer: AuthViewer, personId: string, createdAt?: Date) {
    const person = await this.users.findById(personId);
    if (!person) throw new NotFoundException({ error: USER_NOT_FOUND });
    const profile = await this.users.publicUser(viewer, person);
    return {
      id: person.id,
      name: profile.name,
      username: profile.username,
      initials: profile.initials,
      tone: profile.tone,
      photoUrl: profile.photoUrl,
      blockedAt: (createdAt ?? new Date()).toISOString(),
    };
  }
}

function pair(blocker: string, blocked: string) {
  return { blocker: new Types.ObjectId(blocker), blocked: new Types.ObjectId(blocked) };
}

function isMongoId(id: string) {
  return isValidObjectId(id) && String(new Types.ObjectId(id)) === id;
}

function isDuplicate(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
