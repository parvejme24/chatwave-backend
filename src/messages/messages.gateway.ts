import { HttpException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { RedisService } from '../common/redis/redis.service';
import { ConversationsService } from '../conversations/conversations.service';
import { UsersService } from '../users/users.service';
import {
  chatId,
  room,
  type CanonicalMessage,
  type DeleteScope,
  type GroupSocketMember,
  type Preview,
  type RealtimePublisher,
  type ReceiptStatus,
} from './messages.constants';
import { MessagesService } from './messages.service';

type ChatSocket = Socket & { data: { userId?: string; isOwner?: boolean } };

@WebSocketGateway({ namespace: '/', path: '/socket.io' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, RealtimePublisher {
  private readonly offline = new Map<string, ReturnType<typeof setTimeout>>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly messages: MessagesService,
    private readonly conversations: ConversationsService,
    private readonly users: UsersService,
    private readonly redis: RedisService,
  ) {
    this.messages.bindPublisher(this);
  }

  async handleConnection(socket: ChatSocket) {
    const userId = socket.data?.userId;
    if (!userId) return socket.disconnect(true);
    const pending = this.offline.get(userId);
    if (pending) {
      clearTimeout(pending);
      this.offline.delete(userId);
    }
    await this.redis.addSocketConnection(userId);
    const user = await this.users.findById(userId);
    if (!user || user.status === 'banned' || user.deletedAt) return socket.disconnect(true);
    await this.users.markOnline(user);
    await socket.join(room('user', userId));
  }

  async handleDisconnect(socket: ChatSocket) {
    const userId = socket.data?.userId;
    if (!userId || (await this.redis.dropSocketConnection(userId)) > 0) return;
    this.offline.set(
      userId,
      setTimeout(() => {
        this.offline.delete(userId);
        void this.redis.socketCount(userId).then((n) => {
          if (n === 0) return this.users.goOffline(userId);
        });
      }, 2000),
    );
  }

  emitNew(conversationId: string, message: CanonicalMessage, members: Preview[]) {
    this.server.to(room('conversation', conversationId)).emit('message:new', { message });
    for (const { userId, ...preview } of members) {
      this.server.to(room('user', userId)).emit('conversation:preview', preview);
    }
  }

  emitUpdated(message: CanonicalMessage) {
    this.server.to(room('conversation', message.conversationId)).emit('message:updated', { message });
  }

  emitDeleted(id: string, conversationId: string, scope: DeleteScope, userId?: string) {
    const payload = { id, conversationId, scope };
    const target = scope === 'me' && userId ? room('user', userId) : room('conversation', conversationId);
    this.server.to(target).emit('message:deleted', payload);
  }

  emitReceipts(conversationId: string, messageId: string, receipts: { userId: string; status: ReceiptStatus; at: string }[]) {
    this.server.to(room('conversation', conversationId)).emit('receipts:updated', { conversationId, messageId, receipts });
  }

  emitGroupUpdated(conversationId: string, payload: { members: GroupSocketMember[]; status: string; sub: string }) {
    const body = { conversationId, ...payload };
    this.server.to(room('conversation', conversationId)).emit('group:updated', body);
    for (const member of payload.members) {
      this.server.to(room('user', member.id)).emit('group:updated', body);
    }
  }

  emitMemberLeft(conversationId: string, userId: string, reason: 'left' | 'removed') {
    const body = { conversationId, userId, reason };
    this.server.to(room('conversation', conversationId)).emit('group:member-left', body);
    this.server.to(room('user', userId)).emit('group:member-left', body);
  }

  emitConversationRemoved(userId: string, conversationId: string) {
    this.server.to(room('user', userId)).emit('conversation:removed', { conversationId });
  }

  emitPreview(userId: string, preview: Omit<Preview, 'userId'>) {
    this.server.to(room('user', userId)).emit('conversation:preview', preview);
  }

  emitBlocked(blockerId: string, blockedId: string) {
    this.server.to(room('user', blockerId)).emit('user:blocked', { userId: blockedId });
    this.server.to(room('user', blockedId)).emit('user:blocked', { userId: blockerId });
  }

  async kickBanned(userId: string) {
    if (!this.server) return;
    this.server.to(room('user', userId)).emit('auth:banned', { error: 'This account has been banned' });
    const sockets = await this.server.in(room('user', userId)).fetchSockets();
    for (const socket of sockets) socket.disconnect(true);
  }

  emitNotification(userId: string, notification: unknown) {
    this.server?.to(room('user', userId)).emit('notification:new', { notification });
  }

  emitBadge(userId: string, unreadCount: number) {
    this.server?.to(room('user', userId)).emit('notification:badge', { unreadCount });
  }

  async isInConversation(userId: string, conversationId: string) {
    if (!this.server || !conversationId) return false;
    const sockets = await this.server.in(room('conversation', conversationId)).fetchSockets();
    return sockets.some((socket) => (socket.data as { userId?: string } | undefined)?.userId === userId);
  }

  @SubscribeMessage('conversation:join')
  async join(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    const conversationId = chatId(body);
    const err = await this.guard(socket, conversationId);
    if (err) return err;
    await socket.join(room('conversation', conversationId));
    socket.emit('conversation:joined', { conversationId });
    return { ok: true, conversationId };
  }

  @SubscribeMessage('conversation:leave')
  async leave(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    const conversationId = chatId(body);
    if (conversationId) await socket.leave(room('conversation', conversationId));
    return { ok: true };
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: { conversationId?: string; type?: string; text?: string; replyTo?: string; clientId?: string },
  ) {
    const userId = socket.data.userId;
    const clientId = body?.clientId;
    if (!userId) return fail('Please sign in', clientId);
    if (body?.type && body.type !== 'text') return fail('Upload media over HTTP first', clientId);
    try {
      const message = await this.messages.send(
        { id: userId, isOwner: Boolean(socket.data.isOwner) },
        body?.conversationId ?? '',
        { type: 'text', text: body?.text, replyTo: body?.replyTo },
      );
      return { ok: true, message, clientId };
    } catch (error) {
      return fail(error, clientId);
    }
  }

  @SubscribeMessage('typing:start')
  typingStart(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    return this.typing(socket, body, true);
  }

  @SubscribeMessage('typing:stop')
  typingStop(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    return this.typing(socket, body, false);
  }

  @SubscribeMessage('message:delivered')
  delivered(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: { conversationId?: string; messageId?: string },
  ) {
    return this.receipt(socket, body, 'delivered');
  }

  @SubscribeMessage('message:seen')
  seen(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: { conversationId?: string; messageId?: string },
  ) {
    return this.receipt(socket, body, 'seen');
  }

  private async typing(socket: ChatSocket, body: unknown, typing: boolean) {
    const conversationId = chatId(body);
    const err = await this.guard(socket, conversationId);
    if (err) return err;
    const userId = socket.data.userId!;
    const user = await this.users.findById(userId);
    if (typing) await this.redis.setTyping(conversationId, userId);
    else await this.redis.clearTyping(conversationId, userId);
    const profile = { id: userId, name: user?.name ?? 'ChatWave user', initials: user?.initials ?? 'CW', tone: user?.tone ?? 'e' };
    socket.to(room('conversation', conversationId)).emit('typing', {
      conversationId,
      userId,
      name: profile.name,
      typing,
      user: profile,
    });
    return { ok: true };
  }

  private async receipt(
    socket: ChatSocket,
    body: { conversationId?: string; messageId?: string },
    kind: 'delivered' | 'seen',
  ) {
    const userId = socket.data.userId;
    if (!userId) return fail('Please sign in');
    try {
      await this.messages.mark({ id: userId, isOwner: Boolean(socket.data.isOwner) }, body?.conversationId ?? '', kind, body?.messageId);
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  }

  private async guard(socket: ChatSocket, conversationId: string) {
    const userId = socket.data.userId;
    if (!userId) return fail('Please sign in');
    try {
      await this.conversations.assertMember(userId, conversationId);
      return null;
    } catch (error) {
      return fail(error);
    }
  }
}

function fail(error: unknown, clientId?: string) {
  let message = 'Request failed';
  if (typeof error === 'string') message = error;
  else if (error instanceof HttpException) {
    const payload = error.getResponse();
    message =
      payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : error.message || message;
  }
  return { ok: false as const, error: message, clientId };
}
