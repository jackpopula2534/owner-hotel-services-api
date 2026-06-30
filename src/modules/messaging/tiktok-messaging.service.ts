import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import * as crypto from 'crypto';
import * as https from 'https';
import { AutoReplyService } from './auto-reply.service';
import { ChannelIntegrationService } from './channel-integration.service';
import { MessagingGateway } from './messaging.gateway';

// ─── TikTok Business Messaging constants ──────────────────────────────────────
// หมายเหตุ: TikTok ให้ตั้ง callback URL ระดับ "แอป" (ครั้งเดียวใน TikTok Developer Portal)
// แล้ว push event ของทุกบัญชีมาที่ URL เดียว → map → tenant ด้วย to_user_id (open_id ของบัญชีเรา)
// endpoint ส่งข้อความปรับได้ผ่าน ENV เพื่อรองรับเวอร์ชัน API ที่ต่างกัน
const TIKTOK_SEND_API_DEFAULT =
  'https://business-api.tiktok.com/open_api/v1.3/business/message/send/';

// ─── Webhook event types ──────────────────────────────────────────────────────

interface TtMessage {
  message_id?: string;
  type?: string; // "text" | "image" | ...
  text?: { text?: string };
  content?: string;
}

interface TtMessagingEvent {
  /** บัญชีผู้ส่ง (ลูกค้า) */
  from_user_id?: string;
  /** บัญชีผู้รับ = business account ของเรา (ใช้ map → tenant) */
  to_user_id?: string;
  /** ชื่อแสดงของผู้ส่ง (ถ้า TikTok ส่งมา) */
  from_display_name?: string;
  create_time?: number;
  message?: TtMessage;
}

export interface TtWebhookBody {
  /** "message" | "im.message.receive" ฯลฯ */
  event?: string;
  /** บางเวอร์ชันใส่บัญชีปลายทางที่ระดับ root */
  to_user_id?: string;
  client_key?: string;
  create_time?: number;
  data?: TtMessagingEvent | TtMessagingEvent[];
}

@Injectable()
export class TiktokMessagingService {
  private readonly logger = new Logger(TiktokMessagingService.name);
  // verify token + client secret ระดับ "แอป" (TikTok App ของผู้ให้บริการ ตั้งครั้งเดียว) → ใช้ ENV
  private readonly verifyToken: string;
  private readonly appClientSecret: string;
  private readonly sendApi: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly autoReplyService: AutoReplyService,
    private readonly channelIntegration: ChannelIntegrationService,
    private readonly gateway: MessagingGateway,
  ) {
    this.verifyToken = this.configService.get<string>('TIKTOK_VERIFY_TOKEN', '');
    this.appClientSecret = this.configService.get<string>('TIKTOK_CLIENT_SECRET', '');
    this.sendApi = this.configService.get<string>('TIKTOK_SEND_API', TIKTOK_SEND_API_DEFAULT);
  }

  // ─── Webhook Verification (GET) ───────────────────────────────────────────────

  /** TikTok ส่ง challenge มาให้ตอบกลับเป็น text/plain เพื่อยืนยัน URL */
  verifyWebhook(mode: string, token: string, challenge: string): string {
    // บางการตั้งค่า TikTok ไม่ส่ง mode → ตรวจแค่ verify token ก็พอ
    if ((!mode || mode === 'subscribe') && token === this.verifyToken) {
      this.logger.log('[TikTok] Webhook verified successfully');
      return challenge;
    }
    throw new BadRequestException('TikTok webhook verification failed');
  }

  // ─── Signature Verification ───────────────────────────────────────────────────

  /**
   * TikTok เซ็น payload ด้วย HMAC-SHA256 (client secret) ใส่มาใน header
   * รองรับทั้งรูปแบบ "sha256=<hash>" และ hash เปล่า ๆ
   */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.appClientSecret) {
      this.logger.warn('TIKTOK_CLIENT_SECRET not set — skipping signature check');
      return true;
    }
    if (!signature) return false;
    const digest = crypto
      .createHmac('sha256', this.appClientSecret)
      .update(rawBody)
      .digest('hex');
    const ok = signature === digest || signature === `sha256=${digest}`;
    if (!ok) {
      this.logger.warn(
        '[TikTok] ลายเซ็น webhook ไม่ตรง — ตรวจสอบ TIKTOK_CLIENT_SECRET ใน .env ให้ตรงกับ App',
      );
    }
    return ok;
  }

  // ─── Handle Incoming Webhook (POST) ──────────────────────────────────────────

  async handleWebhook(body: TtWebhookBody): Promise<void> {
    const events = this.normalizeEvents(body);
    for (const event of events) {
      const accountId = event.to_user_id ?? body.to_user_id;
      if (!accountId) {
        this.logger.warn('[TikTok] event ไม่มี to_user_id — ข้าม');
        continue;
      }
      const route = await this.channelIntegration.getTiktokByAccountId(accountId);
      if (!route) {
        this.logger.warn(`[TikTok] ไม่พบ tenant ที่ผูกกับ accountId=${accountId} — ข้าม event`);
        continue;
      }
      await this.handleMessage(route.tenantId, route.accessToken, event);
    }
  }

  /** payload ของ TikTok มาได้หลายรูปแบบ (object เดี่ยว / array) → normalize เป็น array */
  private normalizeEvents(body: TtWebhookBody): TtMessagingEvent[] {
    if (Array.isArray(body.data)) return body.data;
    if (body.data) return [body.data];
    return [];
  }

  private async handleMessage(
    tenantId: string,
    accessToken: string,
    event: TtMessagingEvent,
  ): Promise<void> {
    const fromUserId = event.from_user_id;
    const msg = event.message;
    if (!fromUserId || !msg) return;

    const text = msg.text?.text ?? msg.content ?? '';
    if (!text) return; // Phase นี้รองรับข้อความตัวอักษรก่อน

    const externalMsgId = msg.message_id ?? null;

    try {
      const conversation = await this.upsertConversation(
        tenantId,
        fromUserId,
        event.from_display_name,
      );

      const inbound = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          tenantId,
          channel: 'TIKTOK',
          direction: 'INBOUND',
          messageType: 'text',
          content: text,
          externalMsgId,
          isAutoReply: false,
        },
      });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });
      this.gateway.emitNewMessage(tenantId, {
        conversationId: conversation.id,
        message: inbound,
      });

      this.logger.log(
        `[TikTok] Inbound from user=${fromUserId} conversationId=${conversation.id}`,
      );

      // Auto-reply
      const replyText = await this.autoReplyService.findMatchingTemplate(
        tenantId,
        'TIKTOK',
        text,
      );
      if (replyText) {
        await this.ttSend(accessToken, fromUserId, replyText);
        const autoMsg = await this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            tenantId,
            channel: 'TIKTOK',
            direction: 'OUTBOUND',
            messageType: 'text',
            content: replyText,
            isAutoReply: true,
          },
        });
        this.gateway.emitNewMessage(tenantId, {
          conversationId: conversation.id,
          message: autoMsg,
        });
      }
    } catch (err) {
      this.logger.error(`[TikTok] handleMessage error: ${(err as Error).message}`);
    }
  }

  // ─── Send Message (Staff Reply) ───────────────────────────────────────────────

  async sendReply(
    tenantId: string,
    conversationId: string,
    content: string,
    staffId: string,
  ): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, channel: 'TIKTOK' },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    const creds = await this.channelIntegration.getTiktokCredentials(tenantId);
    if (!creds?.accessToken) {
      throw new BadRequestException('ยังไม่ได้เชื่อมต่อ TikTok — ตั้งค่าที่หน้าเชื่อมต่อช่องทาง');
    }

    await this.ttSend(creds.accessToken, conversation.externalId, content);

    await this.prisma.message.create({
      data: {
        conversationId,
        tenantId,
        channel: 'TIKTOK',
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

    this.logger.log(`[TikTok] Outbound by staff=${staffId} to conversationId=${conversationId}`);
  }

  // ─── Helper: Upsert Conversation ─────────────────────────────────────────────

  private async upsertConversation(
    tenantId: string,
    userId: string,
    displayName?: string,
  ) {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalId: {
          tenantId,
          channel: 'TIKTOK',
          externalId: userId,
        },
      },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: {
        tenantId,
        channel: 'TIKTOK',
        externalId: userId,
        displayName: displayName ?? null,
        isActive: true,
        lastMessageAt: new Date(),
      },
    });
  }

  // ─── TikTok Send API ──────────────────────────────────────────────────────────

  private ttSend(accessToken: string, recipientId: string, text: string): Promise<void> {
    const body = JSON.stringify({
      to_user_id: recipientId,
      message: { type: 'text', text: { text } },
    });
    return this.ttPost(this.sendApi, accessToken, body);
  }

  private ttPost(url: string, accessToken: string, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            // TikTok Business API ใช้ access token ใน header นี้
            'Access-Token': accessToken,
            Authorization: `Bearer ${accessToken}`,
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode < 300) {
              resolve();
            } else {
              reject(new BadRequestException(`TikTok Send API error ${res.statusCode}: ${data}`));
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
