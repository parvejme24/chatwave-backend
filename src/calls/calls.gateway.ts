import { HttpException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { room } from '../messages/messages.constants';
import { callRoom } from './calls.constants';
import { CallsRealtime } from './calls.realtime';
import { CallsService } from './calls.service';

type ChatSocket = Socket & { data: { userId?: string; isOwner?: boolean } };

@WebSocketGateway({ namespace: '/', path: '/socket.io' })
export class CallsGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly calls: CallsService,
    private readonly live: CallsRealtime,
  ) {}

  afterInit(server: Server) {
    this.live.bind(server);
  }

  handleDisconnect(socket: ChatSocket) {
    const userId = socket.data.userId;
    if (userId) this.calls.hangupIfDisconnected(userId);
  }

  @SubscribeMessage('call:join')
  async join(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    const callId = str(body, 'callId');
    const err = await this.guard(socket, callId);
    if (err) return err;
    await socket.join(callRoom(callId));
    const { participantIds } = await this.calls.markJoined(callId, socket.data.userId!);
    this.live.emitParticipant(callId, socket.data.userId!, 'joined', participantIds);
    return { ok: true, callId };
  }

  @SubscribeMessage('call:leave')
  async leave(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    const callId = str(body, 'callId');
    const userId = socket.data.userId;
    if (callId && userId) {
      await socket.leave(callRoom(callId));
      this.live.emitParticipant(callId, userId, 'left');
      // Leaving the socket room must NOT hang up the call. Hang-up is only via
      // HTTP POST /end (or disconnect cleanup) so a brief reconnect / remount
      // cannot kill an active call right after accept.
    }
    return { ok: true };
  }

  @SubscribeMessage('webrtc:offer')
  offer(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    return this.signal(socket, body, 'webrtc:offer');
  }

  @SubscribeMessage('webrtc:answer')
  answer(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    return this.signal(socket, body, 'webrtc:answer');
  }

  @SubscribeMessage('webrtc:ice')
  ice(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    return this.signal(socket, body, 'webrtc:ice');
  }

  @SubscribeMessage('webrtc:ready')
  ready(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    return this.signal(socket, body, 'webrtc:ready');
  }

  @SubscribeMessage('call:media')
  async media(@ConnectedSocket() socket: ChatSocket, @MessageBody() body: unknown) {
    const callId = str(body, 'callId');
    const err = await this.guard(socket, callId);
    if (err) return err;
    socket.to(callRoom(callId)).emit('call:media', {
      callId,
      userId: socket.data.userId,
      muted: bool(body, 'muted'),
      cameraOff: bool(body, 'cameraOff'),
    });
    return { ok: true };
  }

  private async signal(
    socket: ChatSocket,
    body: unknown,
    event: 'webrtc:offer' | 'webrtc:answer' | 'webrtc:ice' | 'webrtc:ready',
  ) {
    const callId = str(body, 'callId');
    const toUserId = str(body, 'toUserId');
    const err = await this.guard(socket, callId);
    if (err) return err;
    if (!toUserId) return fail('Pick someone to signal');
    const payload = {
      callId,
      fromUserId: socket.data.userId,
      toUserId,
      ...(event === 'webrtc:ice'
        ? { candidate: val(body, 'candidate') }
        : event === 'webrtc:ready'
          ? {}
          : { sdp: val(body, 'sdp') }),
    };
    this.server.to(room('user', toUserId)).emit(event, payload);
    // Also fan out on the call room so signaling still works if toUserId is stale.
    this.server.to(callRoom(callId)).except(socket.id).emit(event, payload);
    return { ok: true };
  }

  private async guard(socket: ChatSocket, callId: string) {
    if (!socket.data.userId) return fail('Please sign in');
    try {
      await this.calls.requireParticipant(callId, socket.data.userId);
      return null;
    } catch (error) {
      return fail(error);
    }
  }
}

function val(body: unknown, key: string) {
  return body && typeof body === 'object' && key in body ? (body as Record<string, unknown>)[key] : undefined;
}

function str(body: unknown, key: string) {
  const value = val(body, key);
  return typeof value === 'string' ? value : '';
}

function bool(body: unknown, key: string) {
  const value = val(body, key);
  return typeof value === 'boolean' ? value : undefined;
}

function fail(error: unknown) {
  let message = 'Request failed';
  if (typeof error === 'string') message = error;
  else if (error instanceof HttpException) {
    const payload = error.getResponse();
    message =
      payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : error.message || message;
  }
  return { ok: false as const, error: message };
}
