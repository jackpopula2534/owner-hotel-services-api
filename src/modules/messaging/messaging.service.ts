import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { MessagingGateway } from './messaging.gateway';
import { ConversationQueryDto } from './dto/messaging.dto';
import { LineMessagingService } from './line-messaging.service';
import { FacebookMessagingService } from './facebook-messaging.service';
import { TiktokMessagingService } from './tiktok-messaging.service';

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

    // นับจำนวนข้อความขาเข้าที่ยังไม่ได้อ่าน (unread) ต่อ conversation ในหน้านี้
    const ids = conversations.map((c) => c.id);
    const unreadGroups = ids.length
      ? await this.prisma.message.groupBy({
          by: ['conversationId'],
          where: {
            conversationId: { in: ids },
            direction: 'INBOUND',
            readAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const unreadMap = new Map(
      unreadGroups.map((g) => [g.conversationId, g._count._all]),
    );

    const data = conversations.map((c) => ({
      ...c,
      unreadCount: unreadMap.get(c.id) ?? 0,
    }));

    return {
      success: true,
      data,
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

    // เปิดห้องแชต = อ่านแล้ว → mark ข้อความขาเข้าที่ยังไม่อ่านให้เป็นอ่านแล้ว
    // (ทำให้ unreadCount ของ conversation นี้กลับเป็น 0 และคงอยู่หลัง refresh)
    await this.prisma.message.updateMany({
      where: { conversationId, direction: 'INBOUND', readAt: null },
      data: { readAt: new Date() },
    });

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
    tiktokService: TiktokMessagingService,
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
    } else if (conversation.channel === 'TIKTOK') {
      await tiktokService.sendReply(tenantId, conversationId, content, staffId);
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
