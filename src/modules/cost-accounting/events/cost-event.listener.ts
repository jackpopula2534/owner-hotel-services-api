import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import {
  COST_EVENTS,
  StockMovementCreatedEvent,
  BookingCheckoutCompletedEvent,
  RecruitmentBudgetReservedEvent,
  RecruitmentSalaryCommittedEvent,
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

      // Determine cost center: department-owned (HrDepartment.costCenterId) first,
      // then the static reference-type mapping
      const costCenter = await this.resolveCostCenter(
        event.tenantId,
        event.propertyId,
        event.referenceType,
        event.departmentId ?? null,
      );

      if (!costCenter) {
        this.logger.warn(
          `No cost center resolved for property ${event.propertyId} (ref: ${event.referenceType ?? '-'}) — skipping`,
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
        `Cost entry posted: ${event.totalCost} THB to ${costCenter.id}/${costTypeCode}`,
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
   * Stage 2: recruitment budget fully approved → reserve salary budget for the
   * requesting department (CostBudget upsert on CT-SAL for the current period)
   */
  @OnEvent(COST_EVENTS.RECRUITMENT_BUDGET_RESERVED, { async: true })
  async handleBudgetReserved(event: RecruitmentBudgetReservedEvent): Promise<void> {
    try {
      const hasAddon = await this.addonService.hasActiveAddon(
        event.tenantId,
        'COST_ACCOUNTING_MODULE',
      );
      if (!hasAddon) return;
      if (event.budgetTotal <= 0) return;

      const target = await this.resolveRecruitmentTarget(event.tenantId, event.propertyId, event.departmentId);
      if (!target) {
        this.logger.warn(`No cost center resolved for recruitment budget ${event.requestNo} — skipping`);
        return;
      }
      const costType = await this.prisma.costType.findFirst({
        where: { tenantId: event.tenantId, code: 'CT-SAL', isActive: true },
        select: { id: true },
      });
      if (!costType) {
        this.logger.warn(`No cost type "CT-SAL" found for tenant ${event.tenantId} — skipping`);
        return;
      }

      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      await this.prisma.costBudget.upsert({
        where: {
          tenantId_propertyId_costCenterId_costTypeId_period: {
            tenantId: event.tenantId,
            propertyId: target.propertyId,
            costCenterId: target.costCenterId,
            costTypeId: costType.id,
            period,
          },
        },
        create: {
          tenantId: event.tenantId,
          propertyId: target.propertyId,
          costCenterId: target.costCenterId,
          costTypeId: costType.id,
          period,
          budgetAmount: event.budgetTotal,
          notes: `Auto: recruitment budget reserved (${event.requestNo} — ${event.positionTitle} x${event.headcount})`,
          createdBy: event.createdBy,
        },
        update: { budgetAmount: { increment: event.budgetTotal } },
      });

      this.logger.log(`Recruitment budget reserved: ${event.budgetTotal} THB (${event.requestNo}, period ${period})`);
    } catch (error) {
      this.logger.error(
        `Failed to reserve recruitment budget: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Stage 5: candidate hired → post committed monthly salary as a LABOR cost
   * entry (CT-SAL) on the department's cost center, period = start month
   */
  @OnEvent(COST_EVENTS.RECRUITMENT_SALARY_COMMITTED, { async: true })
  async handleSalaryCommitted(event: RecruitmentSalaryCommittedEvent): Promise<void> {
    try {
      const hasAddon = await this.addonService.hasActiveAddon(
        event.tenantId,
        'COST_ACCOUNTING_MODULE',
      );
      if (!hasAddon) return;
      if (event.monthlySalary <= 0) return;

      const target = await this.resolveRecruitmentTarget(event.tenantId, event.propertyId, event.departmentId);
      if (!target) {
        this.logger.warn(`No cost center resolved for hire ${event.hireRecordId} — skipping`);
        return;
      }
      const costType = await this.prisma.costType.findFirst({
        where: { tenantId: event.tenantId, code: 'CT-SAL', isActive: true },
        select: { id: true },
      });
      if (!costType) {
        this.logger.warn(`No cost type "CT-SAL" found for tenant ${event.tenantId} — skipping`);
        return;
      }

      const startDate = new Date(event.startDate);
      const period = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;

      await this.prisma.costEntry.create({
        data: {
          tenantId: event.tenantId,
          propertyId: target.propertyId,
          costCenterId: target.costCenterId,
          costTypeId: costType.id,
          amount: event.monthlySalary,
          period,
          entryDate: startDate,
          description: `Auto: salary committed — ${event.positionTitle} (new hire)`,
          sourceType: 'hire_record',
          sourceId: event.hireRecordId,
          isAutoPosted: true,
          status: 'posted',
          createdBy: event.createdBy,
        },
      });

      this.logger.log(`Salary commitment posted: ${event.monthlySalary} THB/month (hire ${event.hireRecordId}, period ${period})`);
    } catch (error) {
      this.logger.error(
        `Failed to post salary commitment: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Resolve cost center for a stock movement: if the event carries the owning
   * department (equipment_issuance), use HrDepartment.costCenterId — falling
   * back to a same-code center under the event's property when the mapped
   * center belongs to another property — otherwise use the static mapping.
   */
  private async resolveCostCenter(
    tenantId: string,
    propertyId: string,
    referenceType?: string,
    departmentId?: string | null,
  ): Promise<{ id: string } | null> {
    if (departmentId) {
      const fromDept = await this.costCenterFromDepartment(tenantId, propertyId, departmentId);
      if (fromDept) return { id: fromDept.costCenterId };
    }
    const costCenterCode = this.mapReferenceToCostCenter(referenceType);
    return this.prisma.costCenter.findFirst({
      where: { tenantId, propertyId, code: costCenterCode, isActive: true },
      select: { id: true },
    });
  }

  /**
   * Resolve cost center + property for recruitment events (propertyId may be
   * null on tenant-wide requests): department mapping → CC-ADMIN fallback.
   */
  private async resolveRecruitmentTarget(
    tenantId: string,
    propertyId: string | null,
    departmentId: string | null,
  ): Promise<{ costCenterId: string; propertyId: string } | null> {
    if (departmentId) {
      const fromDept = await this.costCenterFromDepartment(tenantId, propertyId, departmentId);
      if (fromDept) return fromDept;
    }
    // fallback: CC-ADMIN ใต้ property ของ event (หรือ property แรกของ tenant)
    const admin = await this.prisma.costCenter.findFirst({
      where: {
        tenantId,
        ...(propertyId ? { propertyId } : {}),
        code: 'CC-ADMIN',
        isActive: true,
      },
      select: { id: true, propertyId: true },
    });
    return admin ? { costCenterId: admin.id, propertyId: admin.propertyId } : null;
  }

  /** HrDepartment.costCenterId → cost center (เลือกตัวที่ตรง property ของ event ก่อน) */
  private async costCenterFromDepartment(
    tenantId: string,
    propertyId: string | null,
    departmentId: string,
  ): Promise<{ costCenterId: string; propertyId: string } | null> {
    const department = await (this.prisma as any).hrDepartment.findFirst({
      where: { id: departmentId, tenantId },
      include: { costCenter: { select: { id: true, code: true, propertyId: true, isActive: true } } },
    });
    const mapped = department?.costCenter;
    if (!mapped?.isActive) return null;
    if (!propertyId || mapped.propertyId === propertyId) {
      return { costCenterId: mapped.id, propertyId: mapped.propertyId };
    }
    // cost center อยู่คนละ property → ใช้ center โค้ดเดียวกันใต้ property ของ event
    const sameCode = await this.prisma.costCenter.findFirst({
      where: { tenantId, propertyId, code: mapped.code, isActive: true },
      select: { id: true, propertyId: true },
    });
    return sameCode ? { costCenterId: sameCode.id, propertyId: sameCode.propertyId } : null;
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
      case 'equipment_issuance':
        return 'CT-EQUIP'; // Staff Equipment (first-day issuance)
      default:
        return 'CT-CLEAN'; // Cleaning Supplies (general)
    }
  }
}
