import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import * as crypto from 'crypto';
import * as https from 'https';
import { AutoReplyService } from './auto-reply.service';
import { LineWebhookBody, LineWebhookEvent } from './dto/messaging.dto';

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_PROFILE_URL = 'https://api.line.me/v2/bot/profile';

@Injectable()
export class LineMessagingService {
  private readonly logger = new Logger(LineMessagingService.name);
  private readonly channelSecret: string;
  private readonly channelAccessToken: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly autoReplyService: AutoReplyService,
  ) {
    this.channelSecret = this.configService.get<string>('LINE_CHANNEL_SECRET', '');
    this.channelAccessToken = this.configService.get<string>('LINE_CHANNEL_ACCESS_TOKEN', '');
  }

  // ─── Webhook Signature Verification ──────────────────────────────────────────

  verifySignature(rawBody: Buffer, signature: string): boolean {
    if (!this.channelSecret) {
      this.logger.warn('LINE_CHANNEL_SECRET not set — skipping signature check');
      return true;
    }
    const expected = crypto
      .createHmac('SHA256', this.channelSecret)
      .update(rawBody)
      .digest('base64');
    return expected === signature;
  }

  // ─── Handle Incoming Webhook ──────────────────────────────────────────────────

  async handleWebhook(tenantId: string, body: LineWebhookBody): Promise<void> {
    for (const event of body.events) {
      if (event.type === 'message' && event.message?.type === 'text') {
        await this.handleTextMessage(tenantId, event);
      } else if (event.type === 'follow') {
        await this.handleFollow(tenantId, event);
      } else if (event.type === 'unfollow') {
        await this.handleUnfollow(tenantId, event);
      }
    }
  }

  private async handleTextMessage(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const userId = event.source.userId;
    const text = event.message?.text ?? '';
    const externalMsgId = event.message?.id ?? '';

    try {
      // 1. Upsert conversation
      const conversation = await this.upsertConversation(tenantId, userId);

      // 2. Save inbound message
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          tenantId,
          channel: 'LINE',
          direction: 'INBOUND',
          messageType: 'text',
          content: text,
          externalMsgId,
          isAutoReply: false,
        },
      });

      // 3. Update conversation lastMessageAt
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      this.logger.log(`[LINE] Inbound from userId=${userId} conversationId=${conversation.id}`);

      // 4. Auto-reply check
      const replyText = await this.autoReplyService.findMatchingTemplate(tenantId, 'LINE', text);

      if (replyText && event.replyToken) {
        await this.replyMessage(event.replyToken, replyText);
        // Save outbound auto-reply
        await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            tenantId,
            channel: 'LINE',
            direction: 'OUTBOUND',
            messageType: 'text',
            content: replyText,
            isAutoReply: true,
          },
        });
      }
    } catch (err) {
      this.logger.error(`handleTextMessage error: ${(err as Error).message}`);
    }
  }

  private async handleFollow(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const userId = event.source.userId;
    await this.upsertConversation(tenantId, userId);
    this.logger.log(`[LINE] Follow event userId=${userId}`);
  }

  private async handleUnfollow(tenantId: string, event: LineWebhookEvent): Promise<void> {
    const userId = event.source.userId;
    await this.prisma.conversation.updateMany({
      where: { tenantId, channel: 'LINE', externalId: userId },
      data: { isActive: false },
    });
    this.logger.log(`[LINE] Unfollow event userId=${userId}`);
  }

  // ─── Send Message (Staff Reply) ───────────────────────────────────────────────

  async sendReply(
    tenantId: string,
    conversationId: string,
    content: string,
    staffId: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, channel: 'LINE' },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    // Push message via LINE API
    await this.pushMessage(conversation.externalId, content);

    // Save outbound message
    await this.prisma.message.create({
      data: {
        conversationId,
        tenantId,
        channel: 'LINE',
        direction: 'OUTBOUND',
        messageType: 'text',
        content,
        staffId,
        isAutoReply: false,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    this.logger.log(`[LINE] Outbound by staff=${staffId} to conversationId=${conversationId}`);
  }

  // ─── Helper: Upsert Conversation ─────────────────────────────────────────────

  private async upsertConversation(tenantId: string, lineUserId: string) {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalId: {
          tenantId,
          channel: 'LINE',
          externalId: lineUserId,
        },
      },
    });

    if (existing) return existing;

    // Fetch profile from LINE
    let displayName: string | undefined;
    let pictureUrl: string | undefined;
    try {
      const profile = await this.getLineProfile(lineUserId);
      displayName = profile.displayName;
      pictureUrl = profile.pictureUrl;
    } catch {
      this.logger.warn(`Could not fetch LINE profile for userId=${lineUserId}`);
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        channel: 'LINE',
        externalId: lineUserId,
        displayName,
        pictureUrl,
        isActive: true,
        lastMessageAt: new Date(),
      },
    });
  }

  // ─── LINE API Calls ───────────────────────────────────────────────────────────

  private replyMessage(replyToken: string, text: string): Promise<void> {
    const body = JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    });
    return this.linePost(LINE_REPLY_URL, body);
  }

  private pushMessage(to: string, text: string): Promise<void> {
    const body = JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    });
    return this.linePost(LINE_PUSH_URL, body);
  }

  private getLineProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${LINE_PROFILE_URL}/${userId}`);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.channelAccessToken}`,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`LINE profile API: ${res.statusCode}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  private linePost(url: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Authorization: `Bearer ${this.channelAccessToken}`,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode < 300) {
              resolve();
            } else {
              reject(new BadRequestException(`LINE API error ${res.statusCode}: ${data}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
