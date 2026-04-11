import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { httpClient } from '@internal/http-client';
import {
  LineNotifyEventType,
  SendLineNotifyDto,
  LineNotifyPreferenceDto,
  LineNotifyStatusDto,
  LineNotifyTokenResponseDto,
  LineNotifyStatusResponseDto,
} from './dto/line-notify.dto';

@Injectable()
export class LineNotifyService {
  private readonly logger = new Logger(LineNotifyService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;
  private readonly notifyApiUrl = 'https://notify-api.line.me/api/notify';
  private readonly oauthUrl = 'https://notify-bot.line.me/oauth/authorize';
  private readonly tokenUrl = 'https://notify-bot.line.me/oauth/token';
  private readonly statusUrl = 'https://notify-api.line.me/api/status';
  private readonly revokeUrl = 'https://notify-api.line.me/api/revoke';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>('LINE_NOTIFY_CLIENT_ID', '');
    this.clientSecret = this.configService.get<string>('LINE_NOTIFY_CLIENT_SECRET', '');
    this.callbackUrl = this.configService.get<string>('LINE_NOTIFY_CALLBACK_URL', '');
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(tenantId: string, userId: string): string {
    const state = Buffer.from(JSON.stringify({ tenantId, userId })).toString('base64');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: 'notify',
      state,
    });
    return `${this.oauthUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<LineNotifyTokenResponseDto> {
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.callbackUrl,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      const response = await httpClient.post<LineNotifyTokenResponseDto>(this.tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        enforceHttps: true,
      });

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to exchange code for token: ${error.message}`);
      throw new BadRequestException('Failed to connect Line Notify');
    }
  }

  /**
   * Get token status from Line Notify
   */
  async getTokenStatus(accessToken: string): Promise<LineNotifyStatusResponseDto> {
    try {
      const response = await httpClient.get<LineNotifyStatusResponseDto>(this.statusUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        enforceHttps: true,
      });
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get token status: ${error.message}`);
      throw new BadRequestException('Invalid or expired token');
    }
  }

  /**
   * Save Line Notify token for tenant/user
   */
  async saveToken(
    tenantId: string,
    userId: string,
    accessToken: string,
    targetName: string,
    targetType: string,
  ): Promise<void> {
    await this.prisma.lineNotifyToken.upsert({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
      create: {
        tenantId,
        userId,
        accessToken,
        targetName,
        targetType,
        enabledEvents: Object.values(LineNotifyEventType),
        isActive: true,
      },
      update: {
        accessToken,
        targetName,
        targetType,
        isActive: true,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Line Notify connected for tenant ${tenantId}, user ${userId}`);
  }

  /**
   * Get connection status for a user
   */
  async getStatus(tenantId: string, userId: string): Promise<LineNotifyStatusDto> {
    const token = await this.prisma.lineNotifyToken.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
    });

    if (!token || !token.isActive) {
      return { isConnected: false };
    }

    return {
      isConnected: true,
      targetName: token.targetName,
      targetType: token.targetType,
      enabledEvents: token.enabledEvents as LineNotifyEventType[],
      connectedAt: token.createdAt,
    };
  }

  /**
   * Update notification preferences
   */
  async updatePreferences(
    tenantId: string,
    userId: string,
    preferences: LineNotifyPreferenceDto,
  ): Promise<void> {
    await this.prisma.lineNotifyToken.update({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
      data: {
        enabledEvents: preferences.enabledEvents,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Disconnect Line Notify
   */
  async disconnect(tenantId: string, userId: string): Promise<void> {
    const token = await this.prisma.lineNotifyToken.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
    });

    if (token) {
      // Revoke token on Line side
      try {
        await httpClient.post(this.revokeUrl, null, {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
          enforceHttps: true,
        });
      } catch (error) {
        this.logger.warn(`Failed to revoke Line Notify token: ${error.message}`);
      }

      // Mark as inactive in database
      await this.prisma.lineNotifyToken.update({
        where: { id: token.id },
        data: { isActive: false },
      });
    }

    this.logger.log(`Line Notify disconnected for tenant ${tenantId}, user ${userId}`);
  }

  /**
   * Send notification to a specific user
   */
  async sendNotification(
    tenantId: string,
    userId: string,
    dto: SendLineNotifyDto,
  ): Promise<boolean> {
    const token = await this.prisma.lineNotifyToken.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
    });

    if (!token || !token.isActive) {
      this.logger.warn(`No active Line Notify token for tenant ${tenantId}, user ${userId}`);
      return false;
    }

    return this.sendMessage(token.accessToken, dto);
  }

  /**
   * Send notification to all users of a tenant
   */
  async sendToTenant(tenantId: string, dto: SendLineNotifyDto): Promise<number> {
    const tokens = await this.prisma.lineNotifyToken.findMany({
      where: {
        tenantId,
        isActive: true,
      },
    });

    let successCount = 0;
    for (const token of tokens) {
      const sent = await this.sendMessage(token.accessToken, dto);
      if (sent) successCount++;
    }

    return successCount;
  }

  /**
   * Send event notification to users who have enabled it
   */
  async sendEventNotification(
    tenantId: string,
    eventType: LineNotifyEventType,
    message: string,
    imageUrl?: string,
  ): Promise<number> {
    // Fetch all active tokens for the tenant
    const allTokens = await this.prisma.lineNotifyToken.findMany({
      where: {
        tenantId,
        isActive: true,
      },
    });

    // Filter tokens that have the event type enabled
    const tokens = allTokens.filter((token) => {
      const enabledEvents = token.enabledEvents as LineNotifyEventType[] | null;
      return enabledEvents && enabledEvents.includes(eventType);
    });

    let successCount = 0;
    for (const token of tokens) {
      const sent = await this.sendMessage(token.accessToken, { message, imageUrl });
      if (sent) successCount++;
    }

    this.logger.log(
      `Event ${eventType} notification sent to ${successCount}/${tokens.length} users in tenant ${tenantId}`,
    );

    return successCount;
  }

  /**
   * Internal method to send message via Line Notify API
   */
  private async sendMessage(accessToken: string, dto: SendLineNotifyDto): Promise<boolean> {
    try {
      const params = new URLSearchParams();
      params.append('message', dto.message);

      if (dto.imageUrl) {
        params.append('imageFullsize', dto.imageUrl);
        params.append('imageThumbnail', dto.imageThumbnail || dto.imageUrl);
      }

      if (dto.stickerPackageId && dto.stickerId) {
        params.append('stickerPackageId', dto.stickerPackageId);
        params.append('stickerId', dto.stickerId);
      }

      await httpClient.post(this.notifyApiUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${accessToken}`,
        },
        enforceHttps: true,
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to send Line Notify message: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all active tokens for a tenant (admin use)
   */
  async getTenantTokens(tenantId: string) {
    return this.prisma.lineNotifyToken.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        userId: true,
        targetName: true,
        targetType: true,
        enabledEvents: true,
        createdAt: true,
      },
    });
  }
}
