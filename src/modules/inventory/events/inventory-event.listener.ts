import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import {
  INVENTORY_EVENTS,
  HousekeepingTaskCompletedEvent,
  MaintenanceTaskCompletedEvent,
  RestaurantOrderCompletedEvent,
} from './inventory.events';

/**
 * Listens for events from other modules and creates stock movements.
 * ONLY processes if tenant has INVENTORY_MODULE addon active.
 * This is the key loose-coupling mechanism — other modules emit events
 * without knowing about inventory, and this listener handles deductions.
 */
@Injectable()
export class InventoryEventListener {
  private readonly logger = new Logger(InventoryEventListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  /**
   * When housekeeping task completes → deduct amenities based on room type template.
   */
  @OnEvent(INVENTORY_EVENTS.HOUSEKEEPING_TASK_COMPLETED, { async: true })
  async handleHousekeepingCompleted(event: HousekeepingTaskCompletedEvent): Promise<void> {
    try {
      // Check if tenant has inventory addon
      const hasAddon = await this.addonService.hasActiveAddon(event.tenantId, 'INVENTORY_MODULE');
      if (!hasAddon) return; // silently skip — inventory not enabled

      this.logger.log(
        `Processing housekeeping completion: task=${event.taskId}, room=${event.roomId}, type=${event.taskType}`,
      );

      // Get amenity templates for this room type + task type
      const templates = await this.prisma.roomTypeAmenityTemplate.findMany({
        where: {
          tenantId: event.tenantId,
          roomType: event.roomType,
          taskType: event.taskType,
          isActive: true,
        },
        include: {
          item: { select: { id: true, name: true, sku: true } },
        },
      });

      if (templates.length === 0) {
        this.logger.debug(`No amenity templates found for ${event.roomType}/${event.taskType}`);
        return;
      }

      // Find default warehouse for the property (type=HOUSEKEEPING preferred, else GENERAL)
      const warehouse = await this.findWarehouse(event.tenantId, event.propertyId, 'HOUSEKEEPING');
      if (!warehouse) {
        this.logger.warn(
          `No warehouse found for property ${event.propertyId} — skipping deduction`,
        );
        return;
      }

      // Deduct each item in a transaction
      await this.prisma.$transaction(async (tx) => {
        for (const template of templates) {
          const warehouseId = template.warehouseId || warehouse.id;

          // Get current stock
          const stock = await tx.warehouseStock.findUnique({
            where: { warehouseId_itemId: { warehouseId, itemId: template.itemId } },
          });

          const currentQty = stock?.quantity || 0;
          const deductQty = Math.min(template.quantity, currentQty); // Don't go negative

          if (deductQty <= 0) {
            this.logger.warn(
              `Insufficient stock for ${template.item.sku} in warehouse ${warehouseId} — skipping`,
            );
            continue;
          }

          const avgCost = stock ? Number(stock.avgCost) : 0;

          // Create GOODS_ISSUE movement
          await tx.stockMovement.create({
            data: {
              tenantId: event.tenantId,
              warehouseId,
              itemId: template.itemId,
              type: 'GOODS_ISSUE',
              quantity: deductQty,
              unitCost: avgCost,
              totalCost: deductQty * avgCost,
              referenceType: 'housekeeping_task',
              referenceId: event.taskId,
              notes: `Auto-deduct: ${template.item.name} x${deductQty} for ${event.taskType} (room ${event.roomId})`,
              createdBy: event.completedBy,
            },
          });

          // Update warehouse stock
          const newQty = currentQty - deductQty;
          await tx.warehouseStock.update({
            where: { warehouseId_itemId: { warehouseId, itemId: template.itemId } },
            data: {
              quantity: newQty,
              totalValue: newQty * avgCost,
            },
          });
        }
      });

      this.logger.log(
        `Deducted ${templates.length} amenity items for housekeeping task ${event.taskId}`,
      );
    } catch (error) {
      // Log but don't throw — event listeners should not crash the emitter
      this.logger.error(
        `Failed to process housekeeping deduction: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * When maintenance task completes → deduct parts used.
   */
  @OnEvent(INVENTORY_EVENTS.MAINTENANCE_TASK_COMPLETED, { async: true })
  async handleMaintenanceCompleted(event: MaintenanceTaskCompletedEvent): Promise<void> {
    try {
      const hasAddon = await this.addonService.hasActiveAddon(event.tenantId, 'INVENTORY_MODULE');
      if (!hasAddon) return;

      if (!event.partsUsed || event.partsUsed.length === 0) return;

      this.logger.log(
        `Processing maintenance completion: task=${event.taskId}, parts=${event.partsUsed.length}`,
      );

      // Find warehouse
      const warehouseId = event.warehouseId;
      let warehouse: { id: string } | null = null;

      if (warehouseId) {
        warehouse = await this.prisma.warehouse.findFirst({
          where: { id: warehouseId, tenantId: event.tenantId, deletedAt: null },
          select: { id: true },
        });
      }

      if (!warehouse) {
        warehouse = await this.findWarehouse(event.tenantId, event.propertyId, 'MAINTENANCE');
      }

      if (!warehouse) {
        this.logger.warn(`No warehouse found for maintenance deduction — skipping`);
        return;
      }

      await this.prisma.$transaction(async (tx) => {
        for (const part of event.partsUsed) {
          const stock = await tx.warehouseStock.findUnique({
            where: { warehouseId_itemId: { warehouseId: warehouse.id, itemId: part.itemId } },
          });

          const currentQty = stock?.quantity || 0;
          const deductQty = Math.min(part.quantity, currentQty);

          if (deductQty <= 0) continue;

          const avgCost = stock ? Number(stock.avgCost) : 0;

          await tx.stockMovement.create({
            data: {
              tenantId: event.tenantId,
              warehouseId: warehouse.id,
              itemId: part.itemId,
              type: 'GOODS_ISSUE',
              quantity: deductQty,
              unitCost: avgCost,
              totalCost: deductQty * avgCost,
              referenceType: 'maintenance_task',
              referenceId: event.taskId,
              notes: `Auto-deduct: maintenance parts for task ${event.taskId}`,
              createdBy: event.completedBy,
            },
          });

          const newQty = currentQty - deductQty;
          await tx.warehouseStock.upsert({
            where: { warehouseId_itemId: { warehouseId: warehouse.id, itemId: part.itemId } },
            create: {
              warehouseId: warehouse.id,
              itemId: part.itemId,
              quantity: 0,
              avgCost: 0,
              totalValue: 0,
            },
            update: {
              quantity: newQty,
              totalValue: newQty * avgCost,
            },
          });
        }
      });

      this.logger.log(
        `Deducted ${event.partsUsed.length} parts for maintenance task ${event.taskId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process maintenance deduction: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * When restaurant order completes → deduct ingredients based on recipe/BOM.
   */
  @OnEvent(INVENTORY_EVENTS.RESTAURANT_ORDER_COMPLETED, { async: true })
  async handleRestaurantOrderCompleted(event: RestaurantOrderCompletedEvent): Promise<void> {
    try {
      const hasAddon = await this.addonService.hasActiveAddon(event.tenantId, 'INVENTORY_MODULE');
      if (!hasAddon) return;

      if (!event.items || event.items.length === 0) return;

      this.logger.log(
        `Processing restaurant order: order=${event.orderId}, items=${event.items.length}`,
      );

      // Find kitchen warehouse
      const warehouse = await this.findWarehouse(event.tenantId, event.propertyId, 'KITCHEN');
      if (!warehouse) {
        this.logger.warn(`No kitchen warehouse found — skipping ingredient deduction`);
        return;
      }

      // Get recipes for all menu items in the order
      const menuItemIds = event.items.map((i) => i.menuItemId);
      const recipes = await this.prisma.inventoryRecipe.findMany({
        where: {
          tenantId: event.tenantId,
          menuItemId: { in: menuItemIds },
          isActive: true,
        },
        include: {
          ingredients: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      });

      if (recipes.length === 0) {
        this.logger.debug(`No recipes found for ordered menu items — no deduction`);
        return;
      }

      const recipeMap = new Map(recipes.map((r) => [r.menuItemId, r]));

      await this.prisma.$transaction(async (tx) => {
        for (const orderItem of event.items) {
          const recipe = recipeMap.get(orderItem.menuItemId);
          if (!recipe) continue;

          for (const ingredient of recipe.ingredients) {
            // Calculate quantity: (ingredient qty per serving) * order quantity * (1 + wastage%)
            const wastageMultiplier = 1 + Number(ingredient.wastagePercent) / 100;
            const totalQty = Math.ceil(
              Number(ingredient.quantity) * orderItem.quantity * wastageMultiplier,
            );

            const stock = await tx.warehouseStock.findUnique({
              where: {
                warehouseId_itemId: { warehouseId: warehouse.id, itemId: ingredient.itemId },
              },
            });

            const currentQty = stock?.quantity || 0;
            const deductQty = Math.min(totalQty, currentQty);

            if (deductQty <= 0) continue;

            const avgCost = stock ? Number(stock.avgCost) : 0;

            await tx.stockMovement.create({
              data: {
                tenantId: event.tenantId,
                warehouseId: warehouse.id,
                itemId: ingredient.itemId,
                type: 'GOODS_ISSUE',
                quantity: deductQty,
                unitCost: avgCost,
                totalCost: deductQty * avgCost,
                referenceType: 'restaurant_order',
                referenceId: event.orderId,
                notes: `Auto-deduct: ${ingredient.item.name} x${deductQty} for order ${event.orderId}`,
                createdBy: event.completedBy,
              },
            });

            const newQty = currentQty - deductQty;
            await tx.warehouseStock.update({
              where: {
                warehouseId_itemId: { warehouseId: warehouse.id, itemId: ingredient.itemId },
              },
              data: {
                quantity: newQty,
                totalValue: newQty * avgCost,
              },
            });
          }
        }
      });

      this.logger.log(`Deducted ingredients for restaurant order ${event.orderId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process restaurant deduction: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Find the best warehouse for a property by type preference.
   * Falls back to default warehouse or first GENERAL warehouse.
   */
  private async findWarehouse(
    tenantId: string,
    propertyId: string,
    preferredType: string,
  ): Promise<{ id: string } | null> {
    // Try preferred type first
    let warehouse = await this.prisma.warehouse.findFirst({
      where: { tenantId, propertyId, type: preferredType as any, isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (warehouse) return warehouse;

    // Try default warehouse
    warehouse = await this.prisma.warehouse.findFirst({
      where: { tenantId, propertyId, isDefault: true, isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (warehouse) return warehouse;

    // Fall back to any active warehouse
    return this.prisma.warehouse.findFirst({
      where: { tenantId, propertyId, isActive: true, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
