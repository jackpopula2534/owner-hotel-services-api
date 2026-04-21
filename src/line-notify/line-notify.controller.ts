import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LineNotifyService } from './line-notify.service';
import {
  ConnectLineNotifyDto,
  SendLineNotifyDto,
  LineNotifyPreferenceDto,
  LineNotifyStatusDto,
  LineNotifyEventType,
} from './dto/line-notify.dto';

@ApiTags('Line Notify')
@Controller('line-notify')
export class LineNotifyController {
  constructor(private readonly lineNotifyService: LineNotifyService) {}

  /**
   * Get Line Notify authorization URL
   */
  @Get('connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Line Notify authorization URL' })
  @ApiResponse({ status: 200, description: 'Returns authorization URL' })
  getAuthUrl(@CurrentUser() user: any): { authUrl: string } {
    const authUrl = this.lineNotifyService.getAuthorizationUrl(user.tenantId, user.id);
    return { authUrl };
  }

  /**
   * OAuth callback endpoint
   */
  @Get('callback')
  @ApiOperation({ summary: 'Line Notify OAuth callback' })
  @ApiResponse({ status: 302, description: 'Redirects after processing' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      // Decode state to get tenantId and userId
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      const { tenantId, userId } = stateData;

      // Exchange code for token
      const tokenResponse = await this.lineNotifyService.exchangeCodeForToken(code);

      // Get token status to verify and get target info
      const status = await this.lineNotifyService.getTokenStatus(tokenResponse.access_token);

      // Save token
      await this.lineNotifyService.saveToken(
        tenantId,
        userId,
        tokenResponse.access_token,
        status.target || 'Unknown',
        status.targetType || 'USER',
      );

      // Redirect to success page
      res.redirect('/line-notify/success?connected=true');
    } catch (error) {
      res.redirect('/line-notify/error?message=' + encodeURIComponent(error.message));
    }
  }

  /**
   * Get connection status
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Line Notify connection status' })
  @ApiResponse({ status: 200, type: LineNotifyStatusDto })
  async getStatus(@CurrentUser() user: any): Promise<LineNotifyStatusDto> {
    return this.lineNotifyService.getStatus(user.tenantId, user.id);
  }

  /**
   * Update notification preferences
   */
  @Post('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update notification preferences' })
  @ApiResponse({ status: 200, description: 'Preferences updated' })
  async updatePreferences(
    @CurrentUser() user: any,
    @Body() dto: LineNotifyPreferenceDto,
  ): Promise<{ success: boolean }> {
    await this.lineNotifyService.updatePreferences(user.tenantId, user.id, dto);
    return { success: true };
  }

  /**
   * Get available event types
   */
  @Get('event-types')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get available notification event types' })
  @ApiResponse({ status: 200, description: 'Returns list of event types' })
  getEventTypes(): { eventTypes: { key: string; label: string; labelTh: string }[] } {
    const eventTypes = [
      { key: LineNotifyEventType.BOOKING_CREATED, label: 'New Booking', labelTh: 'การจองใหม่' },
      {
        key: LineNotifyEventType.BOOKING_CONFIRMED,
        label: 'Booking Confirmed',
        labelTh: 'ยืนยันการจอง',
      },
      {
        key: LineNotifyEventType.BOOKING_CANCELLED,
        label: 'Booking Cancelled',
        labelTh: 'ยกเลิกการจอง',
      },
      { key: LineNotifyEventType.BOOKING_CHECKIN, label: 'Check-in', labelTh: 'เช็คอิน' },
      { key: LineNotifyEventType.BOOKING_CHECKOUT, label: 'Check-out', labelTh: 'เช็คเอาท์' },
      {
        key: LineNotifyEventType.PAYMENT_RECEIVED,
        label: 'Payment Received',
        labelTh: 'ได้รับชำระเงิน',
      },
      {
        key: LineNotifyEventType.PAYMENT_FAILED,
        label: 'Payment Failed',
        labelTh: 'ชำระเงินไม่สำเร็จ',
      },
      { key: LineNotifyEventType.DAILY_SUMMARY, label: 'Daily Summary', labelTh: 'สรุปประจำวัน' },
      { key: LineNotifyEventType.NEW_REVIEW, label: 'New Review', labelTh: 'รีวิวใหม่' },
      { key: LineNotifyEventType.SYSTEM_ALERT, label: 'System Alert', labelTh: 'การแจ้งเตือนระบบ' },
    ];
    return { eventTypes };
  }

  /**
   * Disconnect Line Notify
   */
  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect Line Notify' })
  @ApiResponse({ status: 200, description: 'Disconnected successfully' })
  async disconnect(@CurrentUser() user: any): Promise<{ success: boolean }> {
    await this.lineNotifyService.disconnect(user.tenantId, user.id);
    return { success: true };
  }

  /**
   * Send test notification
   */
  @Post('test')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send test notification' })
  @ApiResponse({ status: 200, description: 'Test notification sent' })
  async sendTest(@CurrentUser() user: any): Promise<{ success: boolean; message: string }> {
    const sent = await this.lineNotifyService.sendNotification(user.tenantId, user.id, {
      message: '🔔 ทดสอบการแจ้งเตือน / Test Notification\n\nLine Notify เชื่อมต่อสำเร็จแล้ว! ✅',
    });

    return {
      success: sent,
      message: sent ? 'Test notification sent' : 'Failed to send notification',
    };
  }

  /**
   * Send custom notification (admin only)
   */
  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send custom notification to all connected users' })
  @ApiResponse({ status: 200, description: 'Notification sent' })
  async sendNotification(
    @CurrentUser() user: any,
    @Body() dto: SendLineNotifyDto,
  ): Promise<{ success: boolean; sentCount: number }> {
    const sentCount = await this.lineNotifyService.sendToTenant(user.tenantId, dto);
    return { success: sentCount > 0, sentCount };
  }

  /**
   * Get all connected users for tenant (admin only)
   */
  @Get('users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all connected Line Notify users for tenant' })
  @ApiResponse({ status: 200, description: 'Returns connected users' })
  async getConnectedUsers(@CurrentUser() user: any) {
    return this.lineNotifyService.getTenantTokens(user.tenantId);
  }

  /**
   * Success page (simple HTML response)
   */
  @Get('success')
  @ApiOperation({ summary: 'Success page after Line Notify connection' })
  success(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html');
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Line Notify Connected</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .success { color: #28a745; }
            h1 { font-size: 24px; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <h1 class="success">✅ เชื่อมต่อ Line Notify สำเร็จ!</h1>
          <p>Line Notify Connected Successfully!</p>
          <p>คุณสามารถปิดหน้านี้และกลับไปยังแอปพลิเคชันได้</p>
          <p>You can close this window and return to the application.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'LINE_NOTIFY_CONNECTED' }, '*');
              setTimeout(() => window.close(), 3000);
            }
          </script>
        </body>
      </html>
    `);
  }

  /**
   * Error page
   */
  @Get('error')
  @ApiOperation({ summary: 'Error page for Line Notify connection failure' })
  error(@Query('message') message: string, @Res() res: Response): void {
    res.setHeader('Content-Type', 'text/html');
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Line Notify Error</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #dc3545; }
            h1 { font-size: 24px; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <h1 class="error">❌ เชื่อมต่อ Line Notify ไม่สำเร็จ</h1>
          <p>Failed to connect Line Notify</p>
          <p>${message || 'Unknown error occurred'}</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'LINE_NOTIFY_ERROR', message: '${message}' }, '*');
              setTimeout(() => window.close(), 5000);
            }
          </script>
        </body>
      </html>
    `);
  }
}
