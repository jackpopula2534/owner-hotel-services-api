import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateTimeSettingsDto } from './dto/update-time-settings.dto';

export interface PropertyTimeSettings {
  standardCheckInTime: string;
  standardCheckOutTime: string;
  cleaningBufferMinutes: number;
  earlyCheckInEnabled: boolean;
  lateCheckOutEnabled: boolean;
  earlyCheckInFeeType: string | null;
  earlyCheckInFeeAmount: number | null;
  lateCheckOutFeeType: string | null;
  lateCheckOutFeeAmount: number | null;
  timezone: string;
}

@Injectable()
export class PropertyTimeSettingsService {
  private readonly logger = new Logger(PropertyTimeSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get time & cleaning settings for a specific property.
   * Returns only the time-related fields (not full property data).
   */
  async getTimeSettings(propertyId: string, tenantId: string): Promise<PropertyTimeSettings> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, tenantId, deletedAt: null },
      select: {
        standardCheckInTime: true,
        standardCheckOutTime: true,
        cleaningBufferMinutes: true,
        earlyCheckInEnabled: true,
        lateCheckOutEnabled: true,
        earlyCheckInFeeType: true,
        earlyCheckInFeeAmount: true,
        lateCheckOutFeeType: true,
        lateCheckOutFeeAmount: true,
        timezone: true,
      },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID ${propertyId} not found`);
    }

    return {
      ...property,
      earlyCheckInFeeAmount: property.earlyCheckInFeeAmount
        ? Number(property.earlyCheckInFeeAmount)
        : null,
      lateCheckOutFeeAmount: property.lateCheckOutFeeAmount
        ? Number(property.lateCheckOutFeeAmount)
        : null,
    };
  }

  /**
   * Update time & cleaning settings for a specific property.
   * Validates that earlyCheckInEnabled/lateCheckOutEnabled fee configs are consistent.
   */
  async updateTimeSettings(
    propertyId: string,
    tenantId: string,
    dto: UpdateTimeSettingsDto,
  ): Promise<PropertyTimeSettings> {
    // Verify property exists and belongs to tenant
    const existing = await this.prisma.property.findFirst({
      where: { id: propertyId, tenantId, deletedAt: null },
    });

    if (!existing) {
      throw new NotFoundException(`Property with ID ${propertyId} not found`);
    }

    // Validate: if enabling early check-in, fee config must be present
    const willEnableEarlyCheckIn = dto.earlyCheckInEnabled ?? existing.earlyCheckInEnabled;
    const hasEarlyFeeAmount =
      dto.earlyCheckInFeeAmount !== undefined
        ? dto.earlyCheckInFeeAmount > 0
        : Number(existing.earlyCheckInFeeAmount ?? 0) > 0;

    if (willEnableEarlyCheckIn && !hasEarlyFeeAmount) {
      throw new BadRequestException(
        'earlyCheckInFeeAmount must be set and greater than 0 when earlyCheckInEnabled is true',
      );
    }

    // Validate: if enabling late check-out, fee config must be present
    const willEnableLateCheckOut = dto.lateCheckOutEnabled ?? existing.lateCheckOutEnabled;
    const hasLateFeeAmount =
      dto.lateCheckOutFeeAmount !== undefined
        ? dto.lateCheckOutFeeAmount > 0
        : Number(existing.lateCheckOutFeeAmount ?? 0) > 0;

    if (willEnableLateCheckOut && !hasLateFeeAmount) {
      throw new BadRequestException(
        'lateCheckOutFeeAmount must be set and greater than 0 when lateCheckOutEnabled is true',
      );
    }

    this.logger.log(`Updating time settings for property ${propertyId} (tenant ${tenantId})`);

    const updated = await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        ...(dto.standardCheckInTime !== undefined && {
          standardCheckInTime: dto.standardCheckInTime,
        }),
        ...(dto.standardCheckOutTime !== undefined && {
          standardCheckOutTime: dto.standardCheckOutTime,
        }),
        ...(dto.cleaningBufferMinutes !== undefined && {
          cleaningBufferMinutes: dto.cleaningBufferMinutes,
        }),
        ...(dto.earlyCheckInEnabled !== undefined && {
          earlyCheckInEnabled: dto.earlyCheckInEnabled,
        }),
        ...(dto.lateCheckOutEnabled !== undefined && {
          lateCheckOutEnabled: dto.lateCheckOutEnabled,
        }),
        ...(dto.earlyCheckInFeeType !== undefined && {
          earlyCheckInFeeType: dto.earlyCheckInFeeType,
        }),
        ...(dto.earlyCheckInFeeAmount !== undefined && {
          earlyCheckInFeeAmount: dto.earlyCheckInFeeAmount,
        }),
        ...(dto.lateCheckOutFeeType !== undefined && {
          lateCheckOutFeeType: dto.lateCheckOutFeeType,
        }),
        ...(dto.lateCheckOutFeeAmount !== undefined && {
          lateCheckOutFeeAmount: dto.lateCheckOutFeeAmount,
        }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      },
      select: {
        standardCheckInTime: true,
        standardCheckOutTime: true,
        cleaningBufferMinutes: true,
        earlyCheckInEnabled: true,
        lateCheckOutEnabled: true,
        earlyCheckInFeeType: true,
        earlyCheckInFeeAmount: true,
        lateCheckOutFeeType: true,
        lateCheckOutFeeAmount: true,
        timezone: true,
      },
    });

    return {
      ...updated,
      earlyCheckInFeeAmount: updated.earlyCheckInFeeAmount
        ? Number(updated.earlyCheckInFeeAmount)
        : null,
      lateCheckOutFeeAmount: updated.lateCheckOutFeeAmount
        ? Number(updated.lateCheckOutFeeAmount)
        : null,
    };
  }

  /**
   * Helper: get time settings by propertyId for use in other services
   * (e.g. BookingsService to compute scheduledCheckIn/Out).
   * Returns null if property not found instead of throwing.
   */
  async getTimeSettingsSafe(
    propertyId: string,
    tenantId: string,
  ): Promise<PropertyTimeSettings | null> {
    try {
      return await this.getTimeSettings(propertyId, tenantId);
    } catch {
      return null;
    }
  }
}
