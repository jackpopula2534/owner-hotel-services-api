import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import * as crypto from 'crypto';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { AutoReplyService } from './auto-reply.service';
import { ChannelIntegrationService } from './channel-integration.service';
import { MessagingGateway } from './messaging.gateway';
import { LineWebhookBody, LineWebhookEvent } from './dto/messaging.dto';

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_PROFILE_URL = 'https://api.line.me/v2/bot/profile';
// รูป/ไฟล์จาก LINE ต้องดาวน์โหลด binary ผ่านโดเมน api-data (ไม่ใช่ api.line.me)
const LINE_CONTENT_HOST = 'api-data.line.me';
// โฟลเดอร์เก็บไฟล์ที่รับเข้ามา — เสิร์ฟผ่าน /uploads (ดู main.ts useStaticAssets)
const LINE_UPLOAD_SUBDIR = path.join('messaging', 'line');
// จำกัดขนาดไฟล์ที่ดาวน์โหลดจาก LINE กัน memory spike / OOM (วิดีโอใหญ่)
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

@Injectable()
export class LineMessagingService {
  private readonly logger = new Logger(LineMessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoReplyService: AutoReplyService,
    private readonly channelIntegration: ChannelIntegrationService,
    private readonly gateway: MessagingGateway,
  ) {}

  // ─── Webhook Signature Verification ──────────────────────────────────────────

  /**
   * ตรวจ signature ของ webhook ด้วย channel secret ของ tenant นั้น
   * ถ้า tenant ยังไม่ตั้ง secret (ทั้ง DB และ ENV) → ข้ามการตรวจ (dev-friendly)
   */
  async verifySignature(tenantId: string, rawBody: Buffer, signature: string): Promise<boolean> {
    const creds = await this.channelIntegration.getLineCredentials(tenantId);
    const secret = creds?.channelSecret;
    if (!secret) {
      this.logger.warn(`LINE channel secret not set for tenant=${tenantId} — skipping signature check`);
      return true;
    }
    const expected = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64');
    return expected === signature;
  }

  // ─── Handle Incoming Webhook ──────────────────────────────────────────────────

  async handleWebhook(tenantId: string, body: LineWebhookBody): Promise<void> {
    const creds = await this.channelIntegration.getLineCredentials(tenantId);
    const accessToken = creds?.channelAccessToken ?? '';

    for (const event of body.events) {
      const msgType = event.message?.type;
      if (event.type === 'message' && msgType === 'text') {
        await this.handleTextMessage(tenantId, event, accessToken);
      } else if (event.type === 'message' && msgType === 'sticker') {
        await this.handleStickerMessage(tenantId, event, accessToken);
      } else if (
        event.type === 'message' &&
        (msgType === 'image' || msgType === 'video' || msgType === 'audio' || msgType === 'file')
      ) {
        await this.handleMediaMessage(tenantId, event, accessToken, msgType);
      } else if (event.type === 'message' && msgType === 'location') {
        await this.handleLocationMessage(tenantId, event, accessToken);
      } else if (event.type === 'message') {
        // ชนิดที่ยังไม่รองรับ — log ไว้กันเงียบหาย
        this.logger.warn(`[LINE] Unhandled message type="${msgType}" (msgId=${event.message?.id})`);
      } else if (event.type === 'follow') {
        await this.handleFollow(tenantId, event, accessToken);
      } else if (event.type === 'unfollow') {
        await this.handleUnfollow(tenantId, event);
      }
    }
  }

  private async handleTextMessage(
    tenantId: string,
    event: LineWebhookEvent,
    accessToken: string,
  ): Promise<void> {
    const userId = event.source.userId;
    const text = event.message?.text ?? '';
    const externalMsgId = event.message?.id ?? '';

    try {
      // 1. Upsert conversation
      const conversation = await this.upsertConversation(tenantId, userId, accessToken);

      // 2. Save inbound message
      const inbound = await this.prisma.message.create({
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

      // 4. push เข้า inbox ของ staff แบบ real-time (ไม่ต้องรีเฟรช)
      this.gateway.emitNewMessage(tenantId, {
        conversationId: conversation.id,
        message: inbound,
      });

      this.logger.log(`[LINE] Inbound from userId=${userId} conversationId=${conversation.id}`);

      // 5. Auto-reply check
      const replyText = await this.autoReplyService.findMatchingTemplate(tenantId, 'LINE', text);

      if (replyText && event.replyToken) {
        await this.replyMessage(accessToken, event.replyToken, replyText);
        // Save outbound auto-reply
        const autoMsg = await this.prisma.message.create({
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
        this.gateway.emitNewMessage(tenantId, {
          conversationId: conversation.id,
          message: autoMsg,
        });
      }
    } catch (err) {
      this.logger.error(`handleTextMessage error: ${(err as Error).message}`);
    }
  }

  /**
   * จัดการ sticker message จาก LINE
   * LINE ส่ง stickerId/packageId มา (ไม่มี text) → แปลงเป็น URL รูปสติกเกอร์จาก CDN
   * แล้วบันทึกเป็น message ชนิด "sticker" ให้ฝั่ง web เอา content ไป render เป็น <img>
   */
  private async handleStickerMessage(
    tenantId: string,
    event: LineWebhookEvent,
    accessToken: string,
  ): Promise<void> {
    const userId = event.source.userId;
    const stickerId = event.message?.stickerId ?? '';
    const externalMsgId = event.message?.id ?? '';

    if (!stickerId) {
      this.logger.warn(`[LINE] sticker event without stickerId — skipped (msgId=${externalMsgId})`);
      return;
    }

    // LINE sticker CDN — รูป static PNG ใช้ได้กับสติกเกอร์ทุกแบบ (animated จะได้เฟรมแรก)
    const stickerUrl = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker@2x.png`;

    try {
      const conversation = await this.upsertConversation(tenantId, userId, accessToken);

      const inbound = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          tenantId,
          channel: 'LINE',
          direction: 'INBOUND',
          messageType: 'sticker',
          content: stickerUrl,
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
        `[LINE] Inbound sticker from userId=${userId} stickerId=${stickerId} conversationId=${conversation.id}`,
      );
    } catch (err) {
      this.logger.error(`handleStickerMessage error: ${(err as Error).message}`);
    }
  }

  /**
   * จัดการ image message จาก LINE
   * LINE ไม่ส่ง URL รูปมา — ต้องเอา messageId ไปดาวน์โหลด binary จาก api-data.line.me
   * แล้วเซฟลง uploads/messaging/line/ เก็บ content เป็น path /uploads/... ให้ web โหลดได้
   */
  /**
   * จัดการ media message จาก LINE ที่ต้องดาวน์โหลด binary (image / video / audio / file)
   * ดาวน์โหลดผ่าน content API → เซฟลง uploads → เก็บ content เป็น path /uploads/...
   */
  private async handleMediaMessage(
    tenantId: string,
    event: LineWebhookEvent,
    accessToken: string,
    messageType: 'image' | 'video' | 'audio' | 'file',
  ): Promise<void> {
    const userId = event.source.userId;
    const messageId = event.message?.id ?? '';

    if (!messageId || !accessToken) {
      this.logger.warn(`[LINE] ${messageType} event missing messageId/accessToken — skipped (msgId=${messageId})`);
      return;
    }

    try {
      // 1. ดาวน์โหลด binary จาก LINE content API
      const { buffer, contentType } = await this.downloadLineContent(accessToken, messageId);

      // 2. ตั้งชื่อไฟล์ + เซฟลงโฟลเดอร์ uploads
      const dir = path.join(process.cwd(), 'uploads', LINE_UPLOAD_SUBDIR);
      await fs.promises.mkdir(dir, { recursive: true });

      let filename: string;
      if (messageType === 'file' && event.message?.fileName) {
        // ไฟล์เอกสาร: คงชื่อเดิมจาก LINE ไว้ (sanitize) เพื่อให้ปุ่มดาวน์โหลดแสดงชื่อจริง
        const safe = event.message.fileName.replace(/[^\w.\-ก-๙]/g, '_');
        filename = `${messageId}__${safe}`;
      } else {
        filename = `${messageId}.${this.extFromContentType(contentType, messageType)}`;
      }

      await fs.promises.writeFile(path.join(dir, filename), buffer);
      const publicUrl = `/uploads/messaging/line/${filename}`;

      // 3. บันทึก message (content = path ไฟล์)
      const conversation = await this.upsertConversation(tenantId, userId, accessToken);
      const inbound = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          tenantId,
          channel: 'LINE',
          direction: 'INBOUND',
          messageType,
          content: publicUrl,
          externalMsgId: messageId,
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
        `[LINE] Inbound ${messageType} from userId=${userId} saved=${publicUrl} (${buffer.length} bytes) conversationId=${conversation.id}`,
      );
    } catch (err) {
      this.logger.error(`handleMediaMessage(${messageType}) error: ${(err as Error).message}`);
    }
  }

  /**
   * จัดการ location message — ไม่มี binary ให้ดาวน์โหลด
   * เก็บเป็น content บรรยายตำแหน่ง + ลิงก์ Google Maps (web เอาไป render เป็นการ์ดแผนที่ได้)
   */
  private async handleLocationMessage(
    tenantId: string,
    event: LineWebhookEvent,
    accessToken: string,
  ): Promise<void> {
    const userId = event.source.userId;
    const m = event.message;
    const lat = m?.latitude;
    const lng = m?.longitude;

    try {
      const label = m?.title || m?.address || 'ตำแหน่งที่ตั้ง';
      const content =
        lat != null && lng != null
          ? `📍 ${label}\nhttps://www.google.com/maps?q=${lat},${lng}`
          : `📍 ${label}`;

      const conversation = await this.upsertConversation(tenantId, userId, accessToken);
      const inbound = await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          tenantId,
          channel: 'LINE',
          direction: 'INBOUND',
          messageType: 'location',
          content,
          externalMsgId: m?.id ?? '',
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
        `[LINE] Inbound location from userId=${userId} (${lat},${lng}) conversationId=${conversation.id}`,
      );
    } catch (err) {
      this.logger.error(`handleLocationMessage error: ${(err as Error).message}`);
    }
  }

  /** เดานามสกุลไฟล์จาก content-type header */
  private extFromContentType(contentType: string, fallbackType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/mpeg': 'mp3',
      'application/pdf': 'pdf',
    };
    const ct = contentType.split(';')[0].trim().toLowerCase();
    if (map[ct]) return map[ct];
    const sub = ct.split('/')[1];
    if (sub) return sub.replace(/[^a-z0-9]/g, '') || fallbackType;
    return fallbackType;
  }

  /** ดาวน์โหลด binary content (รูป/วิดีโอ/เสียง/ไฟล์) ของ message จาก LINE — มี size guard + timeout */
  private downloadLineContent(
    accessToken: string,
    messageId: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: LINE_CONTENT_HOST,
          path: `/v2/bot/message/${messageId}/content`,
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 30000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`LINE content API: ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_DOWNLOAD_BYTES) {
              res.destroy();
              reject(new Error(`LINE content exceeds ${MAX_DOWNLOAD_BYTES} bytes — aborted`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({
              buffer: Buffer.concat(chunks),
              contentType: res.headers['content-type'] ?? 'application/octet-stream',
            }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('LINE content API timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  private async handleFollow(
    tenantId: string,
    event: LineWebhookEvent,
    accessToken: string,
  ): Promise<void> {
    const userId = event.source.userId;
    await this.upsertConversation(tenantId, userId, accessToken);
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

    const creds = await this.channelIntegration.getLineCredentials(tenantId);
    if (!creds?.channelAccessToken) {
      throw new BadRequestException('ยังไม่ได้เชื่อมต่อ LINE OA — ตั้งค่าที่หน้าเชื่อมต่อช่องทาง');
    }

    // Push message via LINE API
    await this.pushMessage(creds.channelAccessToken, conversation.externalId, content);

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

  private async upsertConversation(tenantId: string, lineUserId: string, accessToken: string) {
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
      const profile = await this.getLineProfile(accessToken, lineUserId);
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

  private replyMessage(accessToken: string, replyToken: string, text: string): Promise<void> {
    const body = JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    });
    return this.linePost(accessToken, LINE_REPLY_URL, body);
  }

  private pushMessage(accessToken: string, to: string, text: string): Promise<void> {
    const body = JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    });
    return this.linePost(accessToken, LINE_PUSH_URL, body);
  }

  private getLineProfile(
    accessToken: string,
    userId: string,
  ): Promise<{ displayName: string; pictureUrl?: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${LINE_PROFILE_URL}/${userId}`);
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
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

  private linePost(accessToken: string, url: string, body: string): Promise<void> {
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
