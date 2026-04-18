import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Query,
  UseGuards,
  Request,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { EmailService } from './email.service';
import {
  SendEmailDto,
  SendBulkEmailDto,
  EmailHistoryQueryDto,
  ResendEmailDto,
  UpdateEmailPreferencesDto,
  EmailPreferencesResponseDto,
  UnsubscribeDto,
} from './dto/send-email.dto';

@ApiTags('Email Notifications')
@Controller('notifications/email')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send')
  @Roles('platform_admin', 'tenant_admin', 'manager')
  @ApiOperation({ summary: 'Send a single email' })
  @ApiResponse({ status: 200, description: 'Email queued successfully' })
  async sendEmail(@Body() dto: SendEmailDto, @Request() req: any) {
    const tenantId = dto.tenantId || req.user?.tenantId;
    return this.emailService.sendEmail({ ...dto, tenantId });
  }

  @Post('send-bulk')
  @Roles('platform_admin', 'tenant_admin', 'manager')
  @ApiOperation({ summary: 'Send bulk emails' })
  @ApiResponse({ status: 200, description: 'Emails queued successfully' })
  async sendBulkEmail(@Body() dto: SendBulkEmailDto, @Request() req: any) {
    const tenantId = dto.tenantId || req.user?.tenantId;
    return this.emailService.sendBulkEmail({ ...dto, tenantId });
  }

  @Get('history')
  @Roles('platform_admin', 'tenant_admin', 'manager')
  @ApiOperation({ summary: 'Get email history' })
  @ApiResponse({ status: 200, description: 'Email history retrieved' })
  async getEmailHistory(@Query() query: EmailHistoryQueryDto, @Request() req: any) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.emailService.getEmailHistory(query, tenantId);
  }

  @Get('templates')
  @Roles('platform_admin', 'tenant_admin', 'manager')
  @ApiOperation({ summary: 'Get available email templates' })
  @ApiResponse({ status: 200, description: 'Template list retrieved' })
  async getTemplates() {
    return this.emailService.getTemplateList();
  }

  @Post('resend')
  @Roles('platform_admin', 'tenant_admin', 'manager')
  @ApiOperation({ summary: 'Resend a failed email' })
  @ApiResponse({ status: 200, description: 'Email requeued successfully' })
  async resendEmail(@Body() dto: ResendEmailDto) {
    return this.emailService.resendEmail(dto.emailLogId);
  }

  @Post('test')
  @Roles('platform_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Send test email' })
  @ApiResponse({ status: 200, description: 'Test email sent' })
  async sendTestEmail(@Body() body: { email: string }, @Request() req: any) {
    return this.emailService.sendEmail({
      to: body.email,
      subject: 'Test Email - ทดสอบอีเมล',
      template: 'welcome' as any,
      context: {
        guestName: req.user?.firstName || 'Test User',
        loginLink: process.env.FRONTEND_URL || 'http://localhost:3000',
      },
      tenantId: req.user?.tenantId,
    });
  }

  // ==========================================
  // Email Preferences Endpoints
  // ==========================================

  @Get('preferences')
  @ApiOperation({ summary: 'Get email preferences for current user' })
  @ApiResponse({
    status: 200,
    description: 'Email preferences retrieved',
    type: EmailPreferencesResponseDto,
  })
  async getEmailPreferences(@Request() req: any) {
    const email = req.user?.email;
    const tenantId = req.user?.tenantId;
    return this.emailService.getEmailPreferences(email, tenantId);
  }

  @Get('preferences/:email')
  @Roles('platform_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Get email preferences for a specific email (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Email preferences retrieved',
    type: EmailPreferencesResponseDto,
  })
  async getEmailPreferencesByEmail(@Param('email') email: string, @Request() req: any) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.emailService.getEmailPreferences(email, tenantId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update email preferences for current user' })
  @ApiResponse({
    status: 200,
    description: 'Email preferences updated',
    type: EmailPreferencesResponseDto,
  })
  async updateEmailPreferences(@Body() dto: UpdateEmailPreferencesDto, @Request() req: any) {
    const email = req.user?.email;
    const tenantId = req.user?.tenantId;
    const guestId = req.user?.guestId;
    return this.emailService.updateEmailPreferences(email, dto, tenantId, guestId);
  }

  @Put('preferences/:email')
  @Roles('platform_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Update email preferences for a specific email (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Email preferences updated',
    type: EmailPreferencesResponseDto,
  })
  async updateEmailPreferencesByEmail(
    @Param('email') email: string,
    @Body() dto: UpdateEmailPreferencesDto,
    @Request() req: any,
  ) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.emailService.updateEmailPreferences(email, dto, tenantId);
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Unsubscribe from all emails' })
  @ApiResponse({ status: 200, description: 'Successfully unsubscribed' })
  async unsubscribe(@Body() dto: UnsubscribeDto, @Request() req: any) {
    const email = dto.email || req.user?.email;
    const tenantId = req.user?.tenantId;
    return this.emailService.unsubscribeFromEmails(email, tenantId);
  }

  @Post('resubscribe')
  @ApiOperation({ summary: 'Resubscribe to emails (reset to defaults)' })
  @ApiResponse({ status: 200, description: 'Successfully resubscribed' })
  async resubscribe(@Request() req: any) {
    const email = req.user?.email;
    const tenantId = req.user?.tenantId;
    return this.emailService.resubscribeToEmails(email, tenantId);
  }

  @Delete('preferences')
  @ApiOperation({ summary: 'Delete email preferences (unsubscribe)' })
  @ApiResponse({ status: 200, description: 'Preferences deleted and unsubscribed' })
  async deleteEmailPreferences(@Request() req: any) {
    const email = req.user?.email;
    const tenantId = req.user?.tenantId;
    return this.emailService.unsubscribeFromEmails(email, tenantId);
  }
}
