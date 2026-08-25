import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';

import { BlocksService } from '../blocks/blocks.service';
import { CONTACT_BLOCKED } from '../blocks/blocks.constants';
import { AppEnv } from '../config/env.validation';
import { ConversationsService } from '../conversations/conversations.service';
import { isManagedUserHidden, type AuthViewer, type Presence } from '../users/users.constants';
import { UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { Contact, ContactDocument } from './contact.schema';
import {
  ACCOUNT_UNAVAILABLE,
  CANNOT_ADD_SELF,
  CONTACT_NOT_FOUND,
  PICK_SOMEONE,
  USER_NOT_FOUND,
  callHref,
  derivedNote,
  type ContactDto,
} from './contacts.constants';
import { AddContactDto } from './contacts.dto';

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(Contact.name) private readonly contacts: Model<ContactDocument>,
    private readonly users: UsersService,
    private readonly conversations: ConversationsService,
    private readonly config: ConfigService<AppEnv, true>,
    @Optional() @Inject(forwardRef(() => BlocksService)) private readonly blocks?: BlocksService,
  ) {}

  async list(viewer: AuthViewer, q?: string, presence?: Presence) {
    const items = await this.visibleContacts(viewer);
    const query = q?.trim().toLowerCase();
    const contacts = items
      .filter((item) => !query || item.name.toLowerCase().includes(query) || item.username.toLowerCase().includes(query))
      .filter((item) => !presence || item.presence === presence)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return {
      contacts,
      total: items.length,
      onlineCount: items.filter((item) => item.presence === 'online').length,
    };
  }

  async add(viewer: AuthViewer, dto: AddContactDto) {
    if (!dto.userId && !dto.username) throw new BadRequestException({ error: PICK_SOMEONE });
    const person = dto.userId
      ? isMongoId(dto.userId)
        ? await this.users.findById(dto.userId)
        : null
      : await this.users.findByUsername(dto.username ?? '');
    if (!person) throw new NotFoundException({ error: USER_NOT_FOUND });
    if (person.id === viewer.id) throw new BadRequestException({ error: CANNOT_ADD_SELF });
    if (isManagedUserHidden(person)) throw new ForbiddenException({ error: ACCOUNT_UNAVAILABLE });
    await this.blocks?.assertNotBlocked(viewer.id, person.id, CONTACT_BLOCKED);
    const existing = await this.contacts.findOne(pair(viewer.id, person.id)).exec();
    if (existing) return { created: false, contact: await this.toDto(viewer, person, existing.note) };
    try {
      const row = await this.contacts.create({ ...pair(viewer.id, person.id), note: dto.note?.trim() ?? '' });
      return { created: true, contact: await this.toDto(viewer, person, row.note) };
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      const row = await this.contacts.findOne(pair(viewer.id, person.id)).exec();
      if (!row) throw error;
      return { created: false, contact: await this.toDto(viewer, person, row.note) };
    }
  }

  async updateNote(viewer: AuthViewer, personId: string, note: string) {
    if (!isMongoId(personId)) throw new NotFoundException({ error: CONTACT_NOT_FOUND });
    const person = await this.users.findById(personId);
    if (!person || person.id === viewer.id || isManagedUserHidden(person)) {
      throw new NotFoundException({ error: CONTACT_NOT_FOUND });
    }
    const row = await this.contacts.findOneAndUpdate(pair(viewer.id, person.id), { note: note.trim() }, { new: true }).exec();
    if (!row) throw new NotFoundException({ error: CONTACT_NOT_FOUND });
    return { contact: await this.toDto(viewer, person, row.note) };
  }

  async remove(viewer: AuthViewer, personId: string) {
    if (isMongoId(personId)) await this.contacts.deleteOne(pair(viewer.id, personId)).exec();
    return { ok: true as const };
  }

  async openChat(viewer: AuthViewer, personId: string) {
    const { conversation } = await this.conversations.getOrCreateDirect(viewer, personId);
    return { conversationId: conversation.id, href: `/chats/${conversation.id}` };
  }

  async inviteLink(viewer: AuthViewer) {
    const me = await this.users.findById(viewer.id);
    if (!me) throw new NotFoundException({ error: USER_NOT_FOUND });
    const origin = this.config.get('FRONTEND_URL', { infer: true }).replace(/\/$/, '');
    return { url: `${origin}/sign-up?ref=${encodeURIComponent(me.username)}` };
  }

  async suggestions(viewer: AuthViewer) {
    const peerIds = await this.conversations.listDirectPeerIds(viewer.id);
    if (peerIds.length === 0) return { contacts: [] as ContactDto[] };
    const saved = await this.contacts
      .find({ owner: new Types.ObjectId(viewer.id), person: { $in: peerIds.map((id) => new Types.ObjectId(id)) } })
      .exec();
    const have = new Set(saved.map((row) => String(row.person)));
    const missing = peerIds.filter((id) => id !== viewer.id && !have.has(id)).slice(0, 10);
    const skip = await this.blocks?.restrictedIds(viewer.id);
    const people = (await this.users.findByIds(missing)).filter(
      (p) => p.id !== viewer.id && !isManagedUserHidden(p) && !skip?.has(p.id),
    );
    const contacts = await Promise.all(people.map((person) => this.toDto(viewer, person, '')));
    contacts.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { contacts };
  }

  private async visibleContacts(viewer: AuthViewer) {
    const rows = await this.contacts.find({ owner: new Types.ObjectId(viewer.id) }).exec();
    const people = await this.users.findByIds(rows.map((row) => String(row.person)));
    const byId = new Map(people.map((person) => [person.id, person]));
    const skip = await this.blocks?.restrictedIds(viewer.id);
    const visible = rows.flatMap((row) => {
      const person = byId.get(String(row.person));
      if (!person || person.id === viewer.id || isManagedUserHidden(person) || skip?.has(person.id)) return [];
      return [{ person, note: row.note }];
    });
    const directs = await this.conversations.directIdsFor(
      viewer.id,
      visible.map((item) => item.person.id),
    );
    return Promise.all(visible.map((item) => this.toDto(viewer, item.person, item.note, directs.get(item.person.id))));
  }

  private async toDto(viewer: AuthViewer, person: UserDocument, savedNote: string, conversationId?: string) {
    const profile = await this.users.publicUser(viewer, person);
    const presence = await this.users.livePresence(person.id);
    const note = derivedNote(savedNote, profile, presence);
    const chatId = conversationId ?? (await this.conversations.directIdsFor(viewer.id, [person.id])).get(person.id);
    return {
      id: person.id,
      name: profile.name,
      user: profile.username,
      username: profile.username,
      initials: profile.initials,
      tone: profile.tone,
      photoUrl: profile.photoUrl,
      presence,
      note,
      sub: `@${profile.username} · ${note}`,
      hrefAudio: callHref('audio', profile.name, person.id),
      hrefVideo: callHref('video', profile.name, person.id),
      ...(chatId ? { hrefChat: `/chats/${chatId}` } : {}),
    };
  }
}

function pair(ownerId: string, personId: string) {
  return { owner: new Types.ObjectId(ownerId), person: new Types.ObjectId(personId) };
}

function isMongoId(id: string) {
  return isValidObjectId(id) && String(new Types.ObjectId(id)) === id;
}

function isDuplicate(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}
