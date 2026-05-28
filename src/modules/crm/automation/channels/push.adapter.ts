import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapter, ChannelName, OutboundMessage, SendResult } from './channel.types';

/**
 * Firebase Cloud Messaging push adapter — bridges to existing
 * PushNotificationsService.sendToUser().
 *
 * Phase 4 ships as a stub so the AutomationModule can stay independent of
 * the PushNotificationsModule import cycle. Wire by injecting
 * PushNotificationsService and calling `.sendToUser({ userId, title, body })`.
 */
@Injectable()
export class PushChannelAdapter implements ChannelAdapter {
  readonly channel: ChannelName = 'push';
  private readonly logger = new Logger(PushChannelAdapter.name);

  canSend(message: OutboundMessage): boolean {
    // recipient should be a userId/guestId identifiable to the push service
    return !!message.guestId;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.canSend(message)) {
      return { success: false, errorMessage: 'guestId required for push' };
    }
    const title = message.subject ?? 'Update from your hotel';
    const body = message.bodyOverride ?? '';
    this.logger.warn(
      `[Push stub] tenant=${message.tenantId} guest=${message.guestId} title="${title}"`,
    );
    // TODO Phase 4.1: inject PushNotificationsService and dispatch
    void body;
    return { success: true, providerMessageId: `push-stub-${Date.now()}` };
  }
}
