import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  AutoReplyTriggerType,
  CreateAutoReplyTemplateDto,
  UpdateAutoReplyTemplateDto,
} from './dto/messaging.dto';

@Injectable()
export class AutoReplyService {
  private readonly logger = new Logger(AutoReplyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── CRUD Templates ──────────────────────────────────────────────────────────

  async findAll(tenantId: string) {
    return this.prisma.autoReplyTemplate.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(tenantId: string, id: string) {
    const template = await this.prisma.autoReplyTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!template) {
      throw new NotFoundException(`Auto-reply template ${id} not found`);
    }
    return template;
  }

  async create(tenantId: string, dto: CreateAutoReplyTemplateDto) {
    return this.prisma.autoReplyTemplate.create({
      data: {
        tenantId,
        name: dto.name,
        channel: dto.channel ?? 'ALL',
        triggerType: dto.triggerType ?? AutoReplyTriggerType.KEYWORD,
        keywords: dto.keywords ?? [],
        replyText: dto.replyText,
        priority: dto.priority ?? 0,
        isActive: true,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAutoReplyTemplateDto) {
    await this.findOne(tenantId, id);
    return this.prisma.autoReplyTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.channel !== undefined && { channel: dto.channel }),
        ...(dto.triggerType !== undefined && { triggerType: dto.triggerType }),
        ...(dto.keywords !== undefined && { keywords: dto.keywords }),
        ...(dto.replyText !== undefined && { replyText: dto.replyText }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.autoReplyTemplate.delete({ where: { id } });
  }

  // ─── Matching Logic ───────────────────────────────────────────────────────────

  /**
   * หา template ที่เหมาะสมสำหรับข้อความที่เข้ามา
   * Priority order: KEYWORD match > GREETING > OUT_OF_HOURS > FALLBACK
   */
  async findMatchingTemplate(
    tenantId: string,
    channel: string,
    incomingText: string,
  ): Promise<string | null> {
    const templates = await this.prisma.autoReplyTemplate.findMany({
      where: {
        tenantId,
        isActive: true,
        channel: { in: ['ALL', channel] },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    const normalizedText = incomingText.toLowerCase().trim();

    // 1. Keyword match (highest priority)
    for (const tmpl of templates) {
      if (tmpl.triggerType !== AutoReplyTriggerType.KEYWORD) continue;
      const keywords = (tmpl.keywords as string[]) ?? [];
      const matched = keywords.some((kw) => normalizedText.includes(kw.toLowerCase()));
      if (matched) {
        this.logger.log(`Auto-reply matched KEYWORD template: ${tmpl.name}`);
        return tmpl.replyText;
      }
    }

    // 2. Greeting trigger
    const greetingWords = ['สวัสดี', 'hello', 'hi', 'หวัดดี', 'ดีครับ', 'ดีค่ะ'];
    const isGreeting = greetingWords.some((w) => normalizedText.includes(w));
    if (isGreeting) {
      const greetingTmpl = templates.find((t) => t.triggerType === AutoReplyTriggerType.GREETING);
      if (greetingTmpl) {
        this.logger.log(`Auto-reply matched GREETING template: ${greetingTmpl.name}`);
        return greetingTmpl.replyText;
      }
    }

    // 3. Out of hours
    const hour = new Date().getHours();
    const isOutOfHours = hour < 8 || hour >= 22;
    if (isOutOfHours) {
      const oohTmpl = templates.find((t) => t.triggerType === AutoReplyTriggerType.OUT_OF_HOURS);
      if (oohTmpl) {
        this.logger.log(`Auto-reply matched OUT_OF_HOURS template: ${oohTmpl.name}`);
        return oohTmpl.replyText;
      }
    }

    // 4. Fallback (ถ้าไม่ match อะไรเลย)
    const fallback = templates.find((t) => t.triggerType === AutoReplyTriggerType.FALLBACK);
    if (fallback) {
      this.logger.log(`Auto-reply matched FALLBACK template: ${fallback.name}`);
      return fallback.replyText;
    }

    return null;
  }
}
