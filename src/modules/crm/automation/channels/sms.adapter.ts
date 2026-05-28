import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapter, ChannelName, OutboundMessage, SendResult } from './channel.types';

/**
 * SMS adapter — stub implementation.
 *
 * Wire to a provider (Twilio, AWS SNS, ThaiBulkSMS) by replacing `send()`
 * with the provider SDK call. Provider credentials should come from
 * ConfigService (SMS_PROVIDER, SMS_API_KEY, SMS_FROM).
 */
@Injectable()
export class SmsChannelAdapter implements ChannelAdapter {
  readonly channel: ChannelName = 'sms';
  private readonly logger = new Logger(SmsChannelAdapter.name);

  canSend(message: OutboundMessage): boolean {
    return !!message.recipient && /^\+?\d{8,15}$/.test(message.recipient);
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.canSend(message)) {
      return { success: false, errorMessage: 'invalid phone number' };
    }
    const text = message.bodyOverride ?? message.subject ?? 'Update from your hotel';
    this.logger.warn(
      `[SMS stub] tenant=${message.tenantId} to=${message.recipient} text="${text.slice(0, 80)}"`,
    );
    // TODO Phase 4.1: integrate with SMS provider
    return { success: true, providerMessageId: `sms-stub-${Date.now()}` };
  }
}
