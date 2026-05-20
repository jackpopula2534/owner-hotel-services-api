import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MessagingGateway } from './messaging.gateway';
import { ConversationQueryDto } from './dto/messaging.dto';
import { LineMessagingService } from './line-messaging.service';
import { FacebookMessagingService } from './facebook-messaging.service';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: MessagingGateway,
  ) {}

  // ─── Conversations ────────────────────────────────────────────────────────────

  async getConversations(tenantId: string, query: ConversationQueryDto) {
    const { channel, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      ...(channel && channel !== 'ALL' ? { channel } : {}),
    };

    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      success: true,
      data: conversations,
      meta: { page, limit, total },
    };
  }

  async getMessages(tenantId: string, conversationId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conversation) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } };
    }

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({ where: { conversationId } }),
    ]);

    return {
      success: true,
      data: { conversation, messages },
      meta: { page, limit, total },
    };
  }

  // ─── Route reply to correct channel ──────────────────────────────────────────

  async routeReply(
    tenantId: string,
    conversationId: string,
    content: string,
    staffId: string,
    lineService: LineMessagingService,
    fbService: FacebookMessagingService,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    if (conversation.channel === 'LINE') {
      await lineService.sendReply(tenantId, conversationId, content, staffId);
    } else if (conversation.channel === 'FACEBOOK') {
      await fbService.sendReply(tenantId, conversationId, content, staffId);
    } else {
      throw new NotFoundException(`Unsupported channel: ${conversation.channel}`);
    }
  }

  // ─── Emit real-time to staff ──────────────────────────────────────────────────

  emitNewInboundMessage(tenantId: string, conversationId: string, message: unknown) {
    this.gateway.emitNewMessage(tenantId, { conversationId, message });
    this.logger.log(`[RT] Emitted new_message to tenant=${tenantId}`);
  }

  emitConversationUpdate(tenantId: string, conversation: unknown) {
    this.gateway.emitConversationUpdate(tenantId, conversation);
  }
}
