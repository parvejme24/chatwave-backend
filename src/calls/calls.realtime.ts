import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

import { room } from '../messages/messages.constants';
import { callRoom, type CallDto } from './calls.constants';

@Injectable()
export class CallsRealtime {
  private server: Server | null = null;

  bind(server: Server) {
    this.server = server;
  }

  emitIncoming(userId: string, call: CallDto) {
    this.server?.to(room('user', userId)).emit('call:incoming', { call });
  }

  emitStarted(conversationId: string, callId: string) {
    this.server?.to(room('conversation', conversationId)).emit('call:started', { conversationId, callId });
  }

  emitAccepted(conversationId: string, userIds: string[], payload: { callId: string; userId: string }) {
    this.fanout(conversationId, userIds, payload.callId, 'call:accepted', payload);
  }

  emitDeclined(conversationId: string, userIds: string[], payload: { callId: string; userId: string }) {
    this.fanout(conversationId, userIds, payload.callId, 'call:declined', payload);
  }

  emitEnded(
    conversationId: string,
    userIds: string[],
    payload: { callId: string; status: string; durationSec: number; endedBy: string | null; conversationId: string },
  ) {
    this.fanout(conversationId, userIds, payload.callId, 'call:ended', payload);
  }

  emitMissed(userIds: string[], payload: { callId: string }) {
    this.server?.to(callRoom(payload.callId)).emit('call:missed', payload);
    for (const id of userIds) this.server?.to(room('user', id)).emit('call:missed', payload);
  }

  emitParticipant(callId: string, userId: string, action: 'joined' | 'left') {
    const payload = { callId, userId, action };
    this.server?.to(callRoom(callId)).emit('call:participant', payload);
    this.server?.to(room('user', userId)).emit('call:participant', payload);
  }

  private fanout(conversationId: string, userIds: string[], callId: string, event: string, payload: object) {
    this.server?.to(room('conversation', conversationId)).emit(event, payload);
    this.server?.to(callRoom(callId)).emit(event, payload);
    for (const id of userIds) this.server?.to(room('user', id)).emit(event, payload);
  }
}
