import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Headers,
  RawBodyRequest,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { LineMessagingService } from './line-messaging.service';
import { FacebookMessagingService, FbWebhookBody } from './facebook-messaging.service';
import { MessagingService } from './messaging.service';
import { AutoReplyService } from './auto-reply.service';
import {
  SendReplyDto,
  ConversationQueryDto,
  CreateAutoReplyTemplateDto,
  UpdateAutoReplyTemplateDto,
  LineWebhookBody,
} from './dto/messaging.dto';

interface JwtUser {
  sub: string; // userId
  email: string;
  role: string;
  tenantId: string | null;
}

function getTenantId(req: Request & { user?: JwtUser }): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) throw new BadRequestException('tenantId not found in token');
  return tenantId;
}

function getStaffId(req: Request & { user?: JwtUser }): string {
  return req.user?.sub ?? 'unknown';
}

@ApiTags('Messaging')
@Controller('api/v1/messaging')
export class MessagingController {
  private readonly logger = new Logger(MessagingController.name);

  constructor(
    private readonly lineMessagingService: LineMessagingService,
    private readonly facebookMessagingService: FacebookMessagingService,
    private readonly messagingService: MessagingService,
    private readonly autoReplyService: AutoReplyService,
  ) {}

  // ─── LINE Webhook (public — no JWT) ──────────────────────────────────────────

  /**
   * LINE Platform calls this endpoint when customers send messages.
   * Configure in LINE Developers Console:
   *   https://your-domain.com/api/v1/messaging/line/webhook/{tenantId}
   */
  @Post('line/webhook/:tenantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'LINE Messaging API Webhook (public)' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'OK' })
  async lineWebhook(
    @Param('tenantId') tenantId: string,
    @Headers('x-line-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: LineWebhookBody,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && signature) {
      const valid = this.lineMessagingService.verifySignature(rawBody, signature);
      if (!valid) {
        throw new BadRequestException('Invalid LINE signature');
      }
    }
    await this.lineMessagingService.handleWebhook(tenantId, body);
    return { success: true };
  }

  // ─── Facebook Webhook (public — no JWT) ──────────────────────────────────────

  /**
   * Facebook calls GET to verify the webhook URL when setting up.
   * Configure in Meta for Developers:
   *   https://your-domain.com/api/v1/messaging/facebook/webhook/{tenantId}
   */
  @Get('facebook/webhook/:tenantId')
  @ApiOperation({ summary: 'Facebook Webhook Verification (public)' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiQuery({ name: 'hub.mode', required: false })
  @ApiQuery({ name: 'hub.verify_token', required: false })
  @ApiQuery({ name: 'hub.challenge', required: false })
  @ApiResponse({ status: 200, description: 'Challenge string returned for verification' })
  fbWebhookVerify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.facebookMessagingService.verifyWebhook(mode, token, challenge);
  }

  /**
   * Facebook calls POST when customers send messages to the Page.
   */
  @Post('facebook/webhook/:tenantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Facebook Messenger Webhook (public)' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'OK' })
  async fbWebhook(
    @Param('tenantId') tenantId: string,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: FbWebhookBody,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && signature) {
      const valid = this.facebookMessagingService.verifySignature(rawBody, signature);
      if (!valid) {
        throw new BadRequestException('Invalid Facebook signature');
      }
    }
    await this.facebookMessagingService.handleWebhook(tenantId, body);
    return { success: true };
  }

  // ─── Conversations ────────────────────────────────────────────────────────────

  @Get('conversations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ดู inbox รวมทุก conversation (LINE + Facebook)' })
  @ApiQuery({ name: 'channel', required: false, enum: ['LINE', 'FACEBOOK', 'ALL'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of conversations' })
  async getConversations(@Req() req: Request, @Query() query: ConversationQueryDto) {
    const tenantId = getTenantId(req as any);
    return this.messagingService.getConversations(tenantId, query);
  }

  @Get('conversations/:conversationId/messages')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ดูประวัติแชทใน conversation' })
  @ApiParam({ name: 'conversationId' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Messages in conversation' })
  async getMessages(
    @Req() req: Request,
    @Param('conversationId') conversationId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const tenantId = getTenantId(req as any);
    return this.messagingService.getMessages(tenantId, conversationId, +page, +limit);
  }

  // ─── Reply (Staff → Customer) ─────────────────────────────────────────────────

  /**
   * Staff ตอบลูกค้า — ระบบจะส่งผ่าน channel ที่ถูกต้องโดยอัตโนมัติ (LINE / Facebook)
   */
  @Post('reply')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Staff ส่งข้อความตอบลูกค้า (LINE หรือ Facebook)' })
  @ApiResponse({ status: 201, description: 'Message sent' })
  async sendReply(@Req() req: Request, @Body() dto: SendReplyDto) {
    const tenantId = getTenantId(req as any);
    const staffId = getStaffId(req as any);

    // ดึง channel จาก conversation แล้ว route ไปถูก service
    await this.messagingService.routeReply(
      tenantId,
      dto.conversationId,
      dto.content,
      staffId,
      this.lineMessagingService,
      this.facebookMessagingService,
    );

    return { success: true, message: 'Message sent' };
  }

  // ─── Auto-Reply Templates ─────────────────────────────────────────────────────

  @Get('auto-reply-templates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ดู template auto-reply ทั้งหมด' })
  @ApiResponse({ status: 200, description: 'List of templates' })
  async getTemplates(@Req() req: Request) {
    const tenantId = getTenantId(req as any);
    const templates = await this.autoReplyService.findAll(tenantId);
    return { success: true, data: templates };
  }

  @Get('auto-reply-templates/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ดู template by ID' })
  @ApiResponse({ status: 200, description: 'Template detail' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getTemplate(@Req() req: Request, @Param('id') id: string) {
    const tenantId = getTenantId(req as any);
    const template = await this.autoReplyService.findOne(tenantId, id);
    return { success: true, data: template };
  }

  @Post('auto-reply-templates')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'สร้าง template auto-reply ใหม่' })
  @ApiResponse({ status: 201, description: 'Created' })
  async createTemplate(@Req() req: Request, @Body() dto: CreateAutoReplyTemplateDto) {
    const tenantId = getTenantId(req as any);
    const template = await this.autoReplyService.create(tenantId, dto);
    return { success: true, data: template };
  }

  @Patch('auto-reply-templates/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'แก้ไข template auto-reply' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async updateTemplate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateAutoReplyTemplateDto,
  ) {
    const tenantId = getTenantId(req as any);
    const template = await this.autoReplyService.update(tenantId, id, dto);
    return { success: true, data: template };
  }

  @Delete('auto-reply-templates/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบ template auto-reply' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteTemplate(@Req() req: Request, @Param('id') id: string) {
    const tenantId = getTenantId(req as any);
    await this.autoReplyService.remove(tenantId, id);
  }
}
