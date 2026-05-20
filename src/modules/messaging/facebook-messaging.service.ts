import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import * as crypto from 'crypto';
import * as https from 'https';
import { AutoReplyService } from './auto-reply.service';

// ─── Facebook Graph API constants ────────────────────────────────────────────

const FB_SEND_API = 'https://graph.facebook.com/v19.0/me/messages';
const FB_PROFILE_API = 'https://graph.facebook.com/v19.0';

// ─── Webhook event types ──────────────────────────────────────────────────────

interface FbMessagingEntry {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: { type: string; payload: { url?: string } }[];
  };
}

interface FbWebhookEntry {
  id: string;
  time: number;
  messaging: FbMessagingEntry[];
}

export interface FbWebhookBody {
  object: string; // "page"
  entry: FbWebhookEntry[];
}

@Injectable()
export class FacebookMessagingService {
  private readonly logger = new Logger(FacebookMessagingService.name);
  private readonly appSecret: string;
  private readonly pageAccessToken: string;
  private readonly verifyToken: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly autoReplyService: AutoReplyService,
  ) {
    this.appSecret = this.configService.get<string>('FB_APP_SECRET', '');
    this.pageAccessToken = this.configService.get<string>('FB_PAGE_ACCESS_TOKEN', '');
    this.verifyToken = this.configService.get<string>('FB_VERIFY_TOKEN', '');
  }

  // ─── Webhook Verification (GET) ───────────────────────────────────────────────

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('[FB] Webhook verified successfully');
      return challenge;
    }
    throw new BadRequestException('Facebook webhook verification failed');
  }

  // ─── Signature Verification ───────────────────────────────────────────────────

  verifySignature(rawBody: Buffer, signature: string): boolean {
    if (!this.appSecret) {
      this.logger.warn('FB_APP_SECRET not set — skipping signature check');
      return true;
    }
    // Facebook sends: sha256=<hash>
    const expected =
      'sha256=' + crypto.createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    return expected === signature;
  }

  // ─── Handle Incoming Webhook (POST) ──────────────────────────────────────────

  async handleWebhook(tenantId: string, body: FbWebhookBody): Promise<void> {
    if (body.object !== 'page') return;

    for (const entry of body.entry) {
      for (const event of entry.messaging) {
        if (event.message) {
          await this.handleMessage(tenantId, event);
        }
      }
    }
  }

  private async handleMessage(tenantId: string, event: FbMessagingEntry): Promise<void> {
    const psid = event.sender.id; // Page-Scoped User ID
    const msg = event.message;
    if (!msg) return;

    // Ignore messages sent by the page itself (echo)
    if (!msg.text && !msg.attachments?.length) return;

    const text = msg.text ?? '[attachment]';
    const externalMsgId = msg.mid;

    try {
      const conversation = await this.upsertConversation(tenantId, psid);

      // Save inbound message
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          tenantId,
          channel: 'FACEBOOK',
          direction: 'INBOUND',
          messageType: msg.text ? 'text' : 'file',
          content: text,
          externalMsgId,
          isAutoReply: false,
        },
      });

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      this.logger.log(`[FB] Inbound from psid=${psid} conversationId=${conversation.id}`);

      // Auto-reply — only for text messages
      if (msg.text) {
        const replyText = await this.autoReplyService.findMatchingTemplate(
          tenantId,
          'FACEBOOK',
          msg.text,
        );
        if (replyText) {
          await this.fbSend(psid, replyText);
          await this.prisma.message.create({
            data: {
              conversationId: conversation.id,
              tenantId,
              channel: 'FACEBOOK',
              direction: 'OUTBOUND',
              messageType: 'text',
              content: replyText,
              isAutoReply: true,
            },
          });
        }
      }
    } catch (err) {
      this.logger.error(`[FB] handleMessage error: ${(err as Error).message}`);
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
      where: { id: conversationId, tenantId, channel: 'FACEBOOK' },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    await this.fbSend(conversation.externalId, content);

    await this.prisma.message.create({
      data: {
        conversationId,
        tenantId,
        channel: 'FACEBOOK',
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

    this.logger.log(`[FB] Outbound by staff=${staffId} to conversationId=${conversationId}`);
  }

  // ─── Helper: Upsert Conversation ─────────────────────────────────────────────

  private async upsertConversation(tenantId: string, psid: string) {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        tenantId_channel_externalId: {
          tenantId,
          channel: 'FACEBOOK',
          externalId: psid,
        },
      },
    });
    if (existing) return existing;

    // Fetch FB user name
    let displayName: string | undefined;
    let pictureUrl: string | undefined;
    try {
      const profile = await this.getFbProfile(psid);
      displayName = profile.name;
      pictureUrl = profile.picture?.data?.url;
    } catch {
      this.logger.warn(`[FB] Could not fetch profile for psid=${psid}`);
    }

    return this.prisma.conversation.create({
      data: {
        tenantId,
        channel: 'FACEBOOK',
        externalId: psid,
        displayName,
        pictureUrl,
        isActive: true,
        lastMessageAt: new Date(),
      },
    });
  }

  // ─── Facebook Graph API calls ─────────────────────────────────────────────────

  private fbSend(recipientId: string, text: string): Promise<void> {
    const body = JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: 'RESPONSE',
      message: { text },
    });
    return this.fbPost(`${FB_SEND_API}?access_token=${this.pageAccessToken}`, body);
  }

  private getFbProfile(
    psid: string,
  ): Promise<{ name: string; picture?: { data: { url: string } } }> {
    return new Promise((resolve, reject) => {
      const path = `/${psid}?fields=name,picture&access_token=${this.pageAccessToken}`;
      const parsed = new URL(`${FB_PROFILE_API}${path}`);
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'GET',
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`FB profile API: ${res.statusCode} ${data}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  private fbPost(url: string, body: string): Promise<void> {
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
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode < 300) {
              resolve();
            } else {
              reject(new BadRequestException(`FB Send API error ${res.statusCode}: ${data}`));
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
