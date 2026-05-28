import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ChannelAdapter, ChannelName, OutboundMessage, SendResult } from './channel.types';

/**
 * LINE Messaging API adapter.
 *
 * Wiring strategy: looks up the guest's LINE userId from the existing
 * Conversation model (messaging module). If a conversation exists with
 * platform='LINE' for this guest, we push to that externalId.
 *
 * For Phase 4 the actual HTTP call to LINE is a stub — wire it to
 * LineMessagingService.pushMessage() once that method is made public.
 */
@Injectable()
export class LineChannelAdapter implements ChannelAdapter {
  readonly channel: ChannelName = 'line';
  private readonly logger = new Logger(LineChannelAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  canSend(message: OutboundMessage): boolean {
    return !!message.guestId;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.canSend(message) || !message.guestId) {
      return { success: false, errorMessage: 'guestId required for LINE' };
    }
    try {
      // Find a LINE conversation for this guest
      const conversation = await this.prisma.conversation.findFirst({
        where: {
          tenantId: message.tenantId,
          guestId: message.guestId,
          channel: 'LINE',
        },
        select: { id: true, externalId: true },
      });

      if (!conversation?.externalId) {
        return { success: false, errorMessage: 'no LINE conversation for guest' };
      }

      const text = this.buildBody(message);
      this.logger.debug(
        `[LINE] push to ${conversation.externalId.slice(0, 6)}…: ${text.slice(0, 80)}`,
      );

      // TODO Phase 4.1: wire to LineMessagingService.pushMessage()
      // For now, record the outbound message in the conversation so it shows
      // up in the LINE thread inside the admin UI.
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          tenantId: message.tenantId,
          channel: 'LINE',
          direction: 'OUTBOUND',
          content: text,
          messageType: 'text',
        },
      });

      return { success: true, providerMessageId: `local-${conversation.id}` };
    } catch (error) {
      this.logger.warn(`LINE send failed: ${(error as Error).message}`);
      return { success: false, errorMessage: (error as Error).message };
    }
  }

  private buildBody(message: OutboundMessage): string {
    if (message.bodyOverride) return message.bodyOverride;
    if (message.subject) return message.subject;
    return 'Update from your hotel';
  }
}
