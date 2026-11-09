import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../../../../email/email.service';
import { ChannelAdapter, ChannelName, OutboundMessage, SendResult } from './channel.types';

@Injectable()
export class EmailChannelAdapter implements ChannelAdapter {
  readonly channel: ChannelName = 'email';
  private readonly logger = new Logger(EmailChannelAdapter.name);

  constructor(private readonly email: EmailService) {}

  canSend(message: OutboundMessage): boolean {
    return !!message.recipient && /@/.test(message.recipient);
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.canSend(message)) {
      return { success: false, errorMessage: 'invalid email address' };
    }
    try {
      await this.email.sendEmail({
        to: message.recipient,
        subject: message.subject ?? 'Update from your hotel',
        template: (message.templateKey ?? 'campaign-generic') as never,
        context: { body: message.bodyOverride ?? '', ...(message.context ?? {}) },
        language: 'en',
        tenantId: message.tenantId,
      } as never);
      return { success: true };
    } catch (error) {
      this.logger.warn(`Email send failed: ${(error as Error).message}`);
      return { success: false, errorMessage: (error as Error).message };
    }
  }
}
