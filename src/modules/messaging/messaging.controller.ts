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
  Res,
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
import { Request, Response } from 'express';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { LineMessagingService } from './line-messaging.service';
import { FacebookMessagingService, FbWebhookBody } from './facebook-messaging.service';
import { TiktokMessagingService, TtWebhookBody } from './tiktok-messaging.service';
import { MessagingService } from './messaging.service';
import { AutoReplyService } from './auto-reply.service';
import { ChannelIntegrationService, ChannelKind } from './channel-integration.service';
import {
  SendReplyDto,
  ConversationQueryDto,
  CreateAutoReplyTemplateDto,
  UpdateAutoReplyTemplateDto,
  LineWebhookBody,
  ConnectLineDto,
  ConnectFacebookDto,
  ConnectTiktokDto,
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
@Controller('messaging')
export class MessagingController {
  private readonly logger = new Logger(MessagingController.name);

  constructor(
    private readonly lineMessagingService: LineMessagingService,
    private readonly facebookMessagingService: FacebookMessagingService,
    private readonly tiktokMessagingService: TiktokMessagingService,
    private readonly messagingService: MessagingService,
    private readonly autoReplyService: AutoReplyService,
    private readonly channelIntegrationService: ChannelIntegrationService,
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
      const valid = await this.lineMessagingService.verifySignature(tenantId, rawBody, signature);
      if (!valid) {
        throw new BadRequestException('Invalid LINE signature');
      }
    }
    await this.lineMessagingService.handleWebhook(tenantId, body);
    return { success: true };
  }

  // ─── Facebook Webhook (public — no JWT) ──────────────────────────────────────
  //
  // Meta App = 1 callback URL สำหรับทุกเพจ → ตั้งครั้งเดียวใน Meta App dashboard:
  //   https://your-domain.com/api/v1/messaging/facebook/webhook
  //   (verify token = FB_VERIFY_TOKEN) — event ถูก map → tenant ด้วย pageId (entry.id)
  // route ที่มี :tenantId เก็บไว้เพื่อ backward-compat (single-tenant ENV เดิม)

  /** Facebook GET — verify webhook (single URL) */
  @Get('facebook/webhook')
  @ApiOperation({ summary: 'Facebook Webhook Verification — single URL (public)' })
  @ApiQuery({ name: 'hub.mode', required: false })
  @ApiQuery({ name: 'hub.verify_token', required: false })
  @ApiQuery({ name: 'hub.challenge', required: false })
  @ApiResponse({ status: 200, description: 'Challenge string returned for verification' })
  fbWebhookVerifyRoot(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    // Meta ต้องการ challenge เป็น "ข้อความดิบ" (text/plain) — ใช้ @Res ส่งตรง
    // ข้าม TransformInterceptor ที่ปกติห่อด้วย { success, data } (จะทำให้ verify ไม่ผ่าน)
    const result = this.facebookMessagingService.verifyWebhook(mode, token, challenge);
    res.status(HttpStatus.OK).type('text/plain').send(result);
  }

  /** Facebook POST — events for ALL pages (mapped to tenant by pageId) */
  @Post('facebook/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Facebook Messenger Webhook — single URL (public)' })
  @ApiResponse({ status: 200, description: 'OK' })
  async fbWebhookRoot(
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
    await this.facebookMessagingService.handleWebhook(body);
    return { success: true };
  }

  /** Facebook GET verify — legacy per-tenant URL (backward-compat) */
  @Get('facebook/webhook/:tenantId')
  @ApiOperation({ summary: 'Facebook Webhook Verification — legacy per-tenant (public)' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'Challenge string returned for verification' })
  fbWebhookVerify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const result = this.facebookMessagingService.verifyWebhook(mode, token, challenge);
    res.status(HttpStatus.OK).type('text/plain').send(result);
  }

  /** Facebook POST — legacy per-tenant URL (tenantId ใช้เป็น fallback ถ้า map pageId ไม่เจอ) */
  @Post('facebook/webhook/:tenantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Facebook Messenger Webhook — legacy per-tenant (public)' })
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
    await this.facebookMessagingService.handleWebhook(body, tenantId);
    return { success: true };
  }

  // ─── TikTok Webhook (public — no JWT) ────────────────────────────────────────
  //
  // TikTok App = 1 callback URL สำหรับทุกบัญชี → ตั้งครั้งเดียวใน TikTok Developer Portal:
  //   https://your-domain.com/api/v1/messaging/tiktok/webhook
  //   (verify token = TIKTOK_VERIFY_TOKEN) — event ถูก map → tenant ด้วย to_user_id (open_id)

  /** TikTok GET — verify webhook (single URL) */
  @Get('tiktok/webhook')
  @ApiOperation({ summary: 'TikTok Webhook Verification — single URL (public)' })
  @ApiQuery({ name: 'hub.mode', required: false })
  @ApiQuery({ name: 'hub.verify_token', required: false })
  @ApiQuery({ name: 'hub.challenge', required: false })
  @ApiResponse({ status: 200, description: 'Challenge string returned for verification' })
  ttWebhookVerify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    // ตอบ challenge เป็น text/plain ดิบ — ข้าม TransformInterceptor ที่ห่อ { success, data }
    const result = this.tiktokMessagingService.verifyWebhook(mode, token, challenge);
    res.status(HttpStatus.OK).type('text/plain').send(result);
  }

  /** TikTok POST — events for ALL connected accounts (mapped to tenant by to_user_id) */
  @Post('tiktok/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'TikTok Direct Message Webhook — single URL (public)' })
  @ApiResponse({ status: 200, description: 'OK' })
  async ttWebhook(
    @Headers('tiktok-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: TtWebhookBody,
  ) {
    const rawBody = req.rawBody;
    if (rawBody) {
      const valid = this.tiktokMessagingService.verifySignature(rawBody, signature);
      if (!valid) {
        throw new BadRequestException('Invalid TikTok signature');
      }
    }
    await this.tiktokMessagingService.handleWebhook(body);
    return { success: true };
  }

  // ─── Conversations ────────────────────────────────────────────────────────────

  @Get('conversations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ดู inbox รวมทุก conversation (LINE + Facebook)' })
  @ApiQuery({ name: 'channel', required: false, enum: ['LINE', 'FACEBOOK', 'TIKTOK', 'ALL'] })
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
      this.tiktokMessagingService,
    );

    return { success: true, message: 'Message sent' };
  }

  // ─── Channel Integrations (per-tenant connect) ────────────────────────────────

  @Get('integrations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ดูสถานะการเชื่อมต่อช่องทางทั้งหมดของ tenant (ไม่มี token ดิบ)' })
  @ApiResponse({ status: 200, description: 'List of channel integrations' })
  async getIntegrations(@Req() req: Request) {
    const tenantId = getTenantId(req as any);
    const data = await this.channelIntegrationService.list(tenantId);
    return { success: true, data };
  }

  @Post('integrations/line')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'เชื่อมต่อ LINE OA — validate token + ตั้ง webhook อัตโนมัติ' })
  @ApiResponse({ status: 201, description: 'Connected' })
  @ApiResponse({ status: 400, description: 'Invalid token' })
  async connectLine(@Req() req: Request, @Body() dto: ConnectLineDto) {
    const tenantId = getTenantId(req as any);
    const data = await this.channelIntegrationService.connectLine(tenantId, dto);
    return { success: true, data };
  }

  @Post('integrations/facebook')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'เชื่อมต่อ Facebook Page — validate token + subscribe เพจเข้า webhook' })
  @ApiResponse({ status: 201, description: 'Connected' })
  @ApiResponse({ status: 400, description: 'Invalid token' })
  async connectFacebook(@Req() req: Request, @Body() dto: ConnectFacebookDto) {
    const tenantId = getTenantId(req as any);
    const data = await this.channelIntegrationService.connectFacebook(tenantId, dto);
    return { success: true, data };
  }

  @Post('integrations/tiktok')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'เชื่อมต่อ TikTok — validate access token + ดึง account id อัตโนมัติ' })
  @ApiResponse({ status: 201, description: 'Connected' })
  @ApiResponse({ status: 400, description: 'Invalid token' })
  async connectTiktok(@Req() req: Request, @Body() dto: ConnectTiktokDto) {
    const tenantId = getTenantId(req as any);
    const data = await this.channelIntegrationService.connectTiktok(tenantId, dto);
    return { success: true, data };
  }

  @Post('integrations/:channel/test')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ทดสอบสุขภาพการเชื่อมต่อช่องทาง (re-validate)' })
  @ApiParam({ name: 'channel', enum: ['LINE', 'FACEBOOK', 'TIKTOK', 'INSTAGRAM'] })
  @ApiResponse({ status: 200, description: 'Connection status' })
  async testIntegration(@Req() req: Request, @Param('channel') channel: string) {
    const tenantId = getTenantId(req as any);
    const data = await this.channelIntegrationService.testConnection(
      tenantId,
      channel.toUpperCase() as ChannelKind,
    );
    return { success: true, data };
  }

  @Delete('integrations/:channel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ยกเลิกการเชื่อมต่อช่องทาง — ลบ credential' })
  @ApiParam({ name: 'channel', enum: ['LINE', 'FACEBOOK', 'TIKTOK', 'INSTAGRAM'] })
  @ApiResponse({ status: 204, description: 'Disconnected' })
  async disconnectIntegration(@Req() req: Request, @Param('channel') channel: string) {
    const tenantId = getTenantId(req as any);
    await this.channelIntegrationService.disconnect(
      tenantId,
      channel.toUpperCase() as ChannelKind,
    );
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
