import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PushNotificationsService } from './push-notifications.service';
import {
  RegisterDeviceDto,
  SendPushNotificationDto,
  SendBulkPushNotificationDto,
  SendTopicNotificationDto,
  UpdatePushPreferencesDto,
  DeviceInfoDto,
} from './dto/push-notification.dto';

@ApiTags('Push Notifications')
@Controller('push-notifications')
export class PushNotificationsController {
  constructor(private readonly pushNotificationsService: PushNotificationsService) {}

  /**
   * Check if push notifications are available
   */
  @Get('status')
  @ApiOperation({ summary: 'Check push notification service status' })
  @ApiResponse({ status: 200 })
  getStatus(): { available: boolean } {
    return { available: this.pushNotificationsService.isAvailable() };
  }

  /**
   * Register device for push notifications
   */
  @Post('devices/register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register device for push notifications' })
  @ApiResponse({ status: 201, type: DeviceInfoDto })
  async registerDevice(
    @CurrentUser() user: any,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceInfoDto> {
    return this.pushNotificationsService.registerDevice(user.id, user.tenantId, dto);
  }

  /**
   * Unregister device
   */
  @Delete('devices/:token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unregister device' })
  @ApiResponse({ status: 200 })
  async unregisterDevice(
    @CurrentUser() user: any,
    @Param('token') deviceToken: string,
  ): Promise<{ success: boolean }> {
    await this.pushNotificationsService.unregisterDevice(user.id, deviceToken);
    return { success: true };
  }

  /**
   * Get registered devices
   */
  @Get('devices')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get registered devices' })
  @ApiResponse({ status: 200, type: [DeviceInfoDto] })
  async getDevices(@CurrentUser() user: any): Promise<DeviceInfoDto[]> {
    return this.pushNotificationsService.getUserDevices(user.id);
  }

  /**
   * Get notification preferences
   */
  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get push notification preferences' })
  @ApiResponse({ status: 200 })
  async getPreferences(@CurrentUser() user: any) {
    return this.pushNotificationsService.getPreferences(user.id);
  }

  /**
   * Update notification preferences
   */
  @Post('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update push notification preferences' })
  @ApiResponse({ status: 200 })
  async updatePreferences(
    @CurrentUser() user: any,
    @Body() dto: UpdatePushPreferencesDto,
  ): Promise<{ success: boolean }> {
    await this.pushNotificationsService.updatePreferences(user.id, dto);
    return { success: true };
  }

  /**
   * Send push notification to a user (admin)
   */
  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send push notification to a user' })
  @ApiResponse({ status: 200 })
  async sendNotification(@Body() dto: SendPushNotificationDto) {
    return this.pushNotificationsService.sendToUser(dto);
  }

  /**
   * Send push notification to multiple users (admin)
   */
  @Post('send/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send push notification to multiple users' })
  @ApiResponse({ status: 200 })
  async sendBulkNotification(@Body() dto: SendBulkPushNotificationDto) {
    return this.pushNotificationsService.sendToUsers(dto);
  }

  /**
   * Send push notification to a topic (admin)
   */
  @Post('send/topic')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send push notification to a topic' })
  @ApiResponse({ status: 200 })
  async sendTopicNotification(@Body() dto: SendTopicNotificationDto) {
    return this.pushNotificationsService.sendToTopic(dto);
  }

  /**
   * Send test notification to current user
   */
  @Post('test')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send test push notification' })
  @ApiResponse({ status: 200 })
  async sendTestNotification(@CurrentUser() user: any) {
    return this.pushNotificationsService.sendToUser({
      userId: user.id,
      title: '🔔 Test Notification',
      body: 'Push notifications are working correctly!',
    });
  }
}
