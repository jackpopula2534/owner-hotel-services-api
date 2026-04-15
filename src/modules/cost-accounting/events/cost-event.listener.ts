import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import {
  COST_EVENTS,
  StockMovementCreatedEvent,
  BookingCheckoutCompletedEvent,
} from './cost-accounting.events';

/**
 * Listens for events and auto-posts cost entries to the Cost Accounting module.
 * Only runs if tenant has COST_ACCOUNTING_MODULE addon active.
 *
 * Key mappings:
 * - Stock movement (housekeeping) → MATERIAL cost to ROOMS cost center
 * - Stock movement (maintenance) → MATERIAL cost to MAINTENANCE_DEPT cost center
 * - Stock movement (restaurant)  → MATERIAL cost to FOOD_BEVERAGE cost center
 * - Stock movement (other GI)    → MATERIAL cost mapped by warehouse type
 * - Booking checkout              → REVENUE to ROOMS cost center
 */
@Injectable()
export class CostEventListener {
  private readonly logger = new Logger(CostEventListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  /**
   * When a stock movement is created → post as material cost entry
   * Only GOODS_ISSUE movements create cost entries (they represent consumption)
   */
  @OnEvent(COST_EVENTS.STOCK_MOVEMENT_CREATED, { async: true })
  async handleStockMovement(event: StockMovementCreatedEvent): Promise<void> {
    try {
      const hasAddon = await this.addonService.hasActiveAddon(
        event.tenantId,
        'COST_ACCOUNTING_MODULE',
      );
      if (!hasAddon) return;

      // Only GOODS_ISSUE represents consumption (cost)
      if (event.type !== 'GOODS_ISSUE') return;

      if (event.totalCost <= 0) return;

      this.logger.log(
        `Auto-posting cost entry: movement=${event.movementId}, cost=${event.totalCost}`,
      );

      // Determine cost center based on reference type
      const costCenterCode = this.mapReferenceToCostCenter(event.referenceType);
      const costCenter = await this.prisma.costCenter.findFirst({
        where: {
          tenantId: event.tenantId,
          propertyId: event.propertyId,
          code: costCenterCode,
          isActive: true,
        },
        select: { id: true },
      });

      if (!costCenter) {
        this.logger.warn(
          `No cost center "${costCenterCode}" found for property ${event.propertyId} — skipping`,
        );
        return;
      }

      // Find MATERIAL cost type based on reference
      const costTypeCode = this.mapReferenceToCostType(event.referenceType);
      const costType = await this.prisma.costType.findFirst({
        where: {
          tenantId: event.tenantId,
          code: costTypeCode,
          isActive: true,
        },
        select: { id: true },
      });

      if (!costType) {
        this.logger.warn(
          `No cost type "${costTypeCode}" found for tenant ${event.tenantId} — skipping`,
        );
        return;
      }

      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      await this.prisma.costEntry.create({
        data: {
          tenantId: event.tenantId,
          propertyId: event.propertyId,
          costCenterId: costCenter.id,
          costTypeId: costType.id,
          amount: event.totalCost,
          period,
          entryDate: now,
          description: `Auto: ${event.itemName} x${event.quantity} (${event.referenceType || 'manual issue'})`,
          sourceType: 'stock_movement',
          sourceId: event.movementId,
          isAutoPosted: true,
          status: 'posted',
          createdBy: event.createdBy,
        },
      });

      this.logger.log(
        `Cost entry posted: ${event.totalCost} THB to ${costCenterCode}/${costTypeCode}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to auto-post cost entry: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * When booking checkout completes → post room revenue
   */
  @OnEvent(COST_EVENTS.BOOKING_CHECKOUT_COMPLETED, { async: true })
  async handleBookingCheckout(event: BookingCheckoutCompletedEvent): Promise<void> {
    try {
      const hasAddon = await this.addonService.hasActiveAddon(
        event.tenantId,
        'COST_ACCOUNTING_MODULE',
      );
      if (!hasAddon) return;

      if (event.totalPrice <= 0) return;

      this.logger.log(
        `Auto-posting revenue: booking=${event.bookingId}, amount=${event.totalPrice}`,
      );

      // Find ROOMS cost center
      const costCenter = await this.prisma.costCenter.findFirst({
        where: {
          tenantId: event.tenantId,
          propertyId: event.propertyId,
          code: 'CC-ROOMS',
          isActive: true,
        },
        select: { id: true },
      });

      // Find Room Revenue cost type
      const costType = await this.prisma.costType.findFirst({
        where: {
          tenantId: event.tenantId,
          code: 'CT-RREV',
          isActive: true,
        },
        select: { id: true },
      });

      if (!costCenter || !costType) {
        this.logger.warn('Missing ROOMS cost center or Room Revenue cost type — skipping');
        return;
      }

      const checkOut = new Date(event.checkOutDate);
      const period = `${checkOut.getFullYear()}-${String(checkOut.getMonth() + 1).padStart(2, '0')}`;

      await this.prisma.costEntry.create({
        data: {
          tenantId: event.tenantId,
          propertyId: event.propertyId,
          costCenterId: costCenter.id,
          costTypeId: costType.id,
          amount: event.totalPrice,
          period,
          entryDate: checkOut,
          description: `Room revenue: booking ${event.bookingId} (${event.roomType})`,
          sourceType: 'booking',
          sourceId: event.bookingId,
          isAutoPosted: true,
          status: 'posted',
          createdBy: 'system',
        },
      });

      this.logger.log(`Revenue posted: ${event.totalPrice} THB for booking ${event.bookingId}`);
    } catch (error) {
      this.logger.error(
        `Failed to post booking revenue: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Map reference type to USALI cost center code
   */
  private mapReferenceToCostCenter(referenceType?: string): string {
    switch (referenceType) {
      case 'housekeeping_task':
        return 'CC-ROOMS';
      case 'maintenance_task':
        return 'CC-MAINT';
      case 'restaurant_order':
        return 'CC-FB';
      default:
        return 'CC-ADMIN'; // fallback to admin/general
    }
  }

  /**
   * Map reference type to cost type code
   */
  private mapReferenceToCostType(referenceType?: string): string {
    switch (referenceType) {
      case 'housekeeping_task':
        return 'CT-AMEN'; // Room Amenities
      case 'maintenance_task':
        return 'CT-PARTS'; // Maintenance Parts
      case 'restaurant_order':
        return 'CT-INGR'; // F&B Ingredients
      default:
        return 'CT-CLEAN'; // Cleaning Supplies (general)
    }
  }
}
