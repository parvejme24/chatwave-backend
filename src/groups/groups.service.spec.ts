import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { CloudinaryService } from '../common/cloudinary/cloudinary.service';
import { Conversation } from '../conversations/conversation.schema';
import { ConversationsService } from '../conversations/conversations.service';
import { ChatGateway } from '../messages/messages.gateway';
import { Message } from '../messages/message.schema';
import { MessagesService } from '../messages/messages.service';
import { UsersService } from '../users/users.service';
import { ADMIN_REMOVE_ERROR, LAST_ADMIN_ERROR, LEAVE_INSTEAD } from './groups.constants';
import { GroupsService } from './groups.service';

const A = '64a000000000000000000001';
const B = '64a000000000000000000002';
const C = '64a000000000000000000003';
const D = '64a000000000000000000004';
const CONV = '64b000000000000000000001';
const admin = { id: A, isOwner: false };
const member = { id: B, isOwner: false };
const NAMES: Record<string, string> = {
  [A]: 'Ayesha Rahman',
  [B]: 'Nadia Hasan',
  [C]: 'Farhan Ahmed',
  [D]: 'Rakib Islam',
};

function q<T>(value: T) {
  const query = { sort: jest.fn(), limit: jest.fn(), exec: jest.fn().mockResolvedValue(value) };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function seat(user: string, extra: Record<string, unknown> = {}) {
  return {
    user,
    role: 'member',
    pinned: false,
    muted: false,
    archived: false,
    unreadCount: 0,
    joinedAt: new Date('2026-08-01T00:00:00.000Z'),
    leftAt: null,
    removedBy: null,
    ...extra,
  };
}

function group() {
  return {
    id: CONV,
    type: 'group',
    name: 'Frontend Guild',
    initials: 'FG',
    tone: 'e',
    photo: null,
    createdBy: A,
    members: [
      seat(A, { role: 'admin', joinedAt: new Date('2026-08-20T00:00:00.000Z') }),
      seat(B),
      seat(C, { joinedAt: new Date('2026-08-10T00:00:00.000Z') }),
    ],
    lastMessageAt: new Date('2026-08-25T13:48:00.000Z'),
    preview: 'You created this group',
    previewIcon: null,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function person(id: string) {
  const name = NAMES[id] ?? 'ChatWave user';
  return { id, name, username: name.split(' ')[0]?.toLowerCase() ?? 'user', initials: 'CW', tone: 'a', photoUrl: null, status: 'active', deletedAt: null };
}

function body(err: unknown) {
  return err instanceof HttpException ? err.getResponse() : err;
}

describe('GroupsService', () => {
  let service: GroupsService;
  let conversations: ConversationsService;
  const model = { findById: jest.fn() };
  const users = { findById: jest.fn(), findByIds: jest.fn(), publicUser: jest.fn(), publicUsers: jest.fn() };
  const messages = { sendSystem: jest.fn() };
  const realtime = {
    emitGroupUpdated: jest.fn(),
    emitMemberLeft: jest.fn(),
    emitConversationRemoved: jest.fn(),
    emitPreview: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    users.findById.mockImplementation(async (id: string) => person(id));
    users.findByIds.mockImplementation(async (ids: string[]) => ids.map((id) => person(id)));
    users.publicUser.mockImplementation(async (_v: unknown, user: { id: string; name: string; username: string }) => ({
      ...user,
      initials: 'NH',
      tone: 'a',
      photoUrl: null,
      presence: 'online',
      sub: '',
    }));
    users.publicUsers.mockImplementation(async (viewer: unknown, docs: Array<{ id: string; name: string; username: string }>) =>
      Promise.all(docs.map((doc) => users.publicUser(viewer, doc))),
    );
    messages.sendSystem.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        GroupsService,
        ConversationsService,
        { provide: getModelToken(Conversation.name), useValue: model },
        { provide: getModelToken(Message.name), useValue: { deleteMany: jest.fn() } },
        { provide: UsersService, useValue: users },
        { provide: MessagesService, useValue: messages },
        { provide: ChatGateway, useValue: realtime },
        { provide: ModuleRef, useValue: { get: jest.fn() } },
        { provide: CloudinaryService, useValue: { uploadAvatar: jest.fn(), deleteAsset: jest.fn() } },
      ],
    }).compile();
    service = module.get(GroupsService);
    conversations = module.get(ConversationsService);
  });

  it('member cannot remove people', async () => {
    model.findById.mockReturnValue(q(group()));
    const err = await service.removeMember(member, CONV, C).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(body(err)).toEqual({ error: ADMIN_REMOVE_ERROR });
  });

  it('admin cannot remove self', async () => {
    model.findById.mockReturnValue(q(group()));
    const err = await service.removeMember(admin, CONV, A).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(body(err)).toEqual({ error: LEAVE_INSTEAD });
  });

  it('cannot demote last admin', async () => {
    model.findById.mockReturnValue(q(group()));
    const err = await service.setAdmin(admin, CONV, A, false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(body(err)).toEqual({ error: LAST_ADMIN_ERROR });
  });

  it('last admin leave promotes another member', async () => {
    const row = group();
    model.findById.mockReturnValue(q(row));
    await service.leave(admin, CONV);
    expect(row.members.find((m) => String(m.user) === B)?.role).toBe('admin');
    expect(row.members.find((m) => String(m.user) === A)?.leftAt).toBeInstanceOf(Date);
    expect(messages.sendSystem).toHaveBeenCalledWith(CONV, null, 'Ayesha Rahman left the group.');
    expect(realtime.emitConversationRemoved).toHaveBeenCalledWith(A, CONV);
  });

  it('leave then GET conversation is 404 for that user', async () => {
    const row = group();
    model.findById.mockReturnValue(q(row));
    await service.leave(member, CONV);
    await expect(conversations.getOne(member, CONV)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('add members emits and they become members', async () => {
    const row = group();
    model.findById.mockReturnValue(q(row));
    const result = await service.addMembers(admin, CONV, [D]);
    expect(result.created).toBe(true);
    expect(row.members.some((m) => String(m.user) === D && !m.leftAt)).toBe(true);
    expect(messages.sendSystem).toHaveBeenCalledWith(CONV, A, 'You added Rakib Islam to the group.');
    expect(realtime.emitGroupUpdated).toHaveBeenCalled();
    expect(realtime.emitPreview).toHaveBeenCalledWith(D, expect.objectContaining({ conversationId: CONV }));
    expect(result.conversation.members.some((m) => m.id === D && m.role === 'member')).toBe(true);
  });
});
