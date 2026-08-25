import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  EVENT_CALL_INCOMING,
  EVENT_CALL_MISSED,
  EVENT_GROUP_MEMBER_ADDED,
  EVENT_MESSAGE_CREATED,
  type CallNotifyEvent,
  type GroupMemberAddedEvent,
  type MessageCreatedEvent,
} from './notifications.constants';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsListener {
  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent(EVENT_MESSAGE_CREATED)
  onMessageCreated(event: MessageCreatedEvent) {
    return this.notifications.onMessageCreated(event);
  }

  @OnEvent(EVENT_CALL_INCOMING)
  onCallIncoming(event: CallNotifyEvent) {
    return this.notifications.onCallIncoming(event);
  }

  @OnEvent(EVENT_CALL_MISSED)
  onCallMissed(event: CallNotifyEvent) {
    return this.notifications.onCallMissed(event);
  }

  @OnEvent(EVENT_GROUP_MEMBER_ADDED)
  onGroupMemberAdded(event: GroupMemberAddedEvent) {
    return this.notifications.onGroupMemberAdded(event);
  }
}
