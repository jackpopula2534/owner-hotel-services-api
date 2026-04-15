import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

export interface LowStockAlert {
  itemId: string;
  itemName: string;
  sku: string;
  categoryName: string | null;
  warehouseId: string;
  warehouseName: string;
  propertyId: string;
  currentQty: number;
  reorderPoint: number;
  reorderQty: number;
  deficit: number; // reorderPoint - currentQty
  preferredSupplier: {
    id: string;
    name: string;
    unitPrice: number;
    leadDays: number | null;
  } | null;
  estimatedCost: number; // reorderQty * preferredSupplier.unitPrice
}

export interface ReorderSummary {
  totalAlerts: number;
  criticalCount: number; // qty = 0 (out of stock)
  warningCount: number; // 0 < qty < reorderPoint
  estimatedTotalCost: number;
  alertsByWarehouse: Record<string, number>;
  alertsByCategory: Record<string, number>;
}

@Injectable()
export class ReorderAlertsService {
  private readonly logger = new Logger(ReorderAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all items that are below their reorder point across all warehouses.
   * Optionally filter by propertyId or warehouseId.
   */
  async getLowStockAlerts(
    tenantId: string,
    options?: { propertyId?: string; warehouseId?: string },
  ): Promise<LowStockAlert[]> {
    try {
      const warehouseFilter: Record<string, unknown> = {};
      if (options?.warehouseId) {
        warehouseFilter.id = options.warehouseId;
      }
      if (options?.propertyId) {
        warehouseFilter.propertyId = options.propertyId;
      }

      // Get all active items with their warehouse stocks
      const items = await this.prisma.inventoryItem.findMany({
        where: {
          tenantId,
          isActive: true,
          deletedAt: null,
          reorderPoint: { gt: 0 }, // Only items with reorder point set
        },
        include: {
          category: { select: { name: true } },
          warehouseStocks: {
            include: {
              warehouse: {
                select: {
                  id: true,
                  name: true,
                  propertyId: true,
                  deletedAt: true,
                },
              },
            },
          },
          itemSuppliers: {
            where: { isPreferred: true },
            include: {
              supplier: {
                select: { id: true, name: true },
              },
            },
            take: 1,
          },
        },
      });

      const alerts: LowStockAlert[] = [];

      for (const item of items) {
        for (const stock of item.warehouseStocks) {
          // Skip deleted warehouses
          if (stock.warehouse.deletedAt) continue;

          // Apply warehouse/property filters
          if (options?.warehouseId && stock.warehouse.id !== options.warehouseId) continue;
          if (options?.propertyId && stock.warehouse.propertyId !== options.propertyId) continue;

          // Check if below reorder point
          if (stock.quantity < item.reorderPoint) {
            const preferredSupplier = item.itemSuppliers[0] || null;
            const unitPrice = preferredSupplier ? Number(preferredSupplier.unitPrice) : 0;

            alerts.push({
              itemId: item.id,
              itemName: item.name,
              sku: item.sku,
              categoryName: item.category?.name || null,
              warehouseId: stock.warehouse.id,
              warehouseName: stock.warehouse.name,
              propertyId: stock.warehouse.propertyId,
              currentQty: stock.quantity,
              reorderPoint: item.reorderPoint,
              reorderQty: item.reorderQty,
              deficit: item.reorderPoint - stock.quantity,
              preferredSupplier: preferredSupplier
                ? {
                    id: preferredSupplier.supplier.id,
                    name: preferredSupplier.supplier.name,
                    unitPrice,
                    leadDays: preferredSupplier.leadDays,
                  }
                : null,
              estimatedCost: item.reorderQty * unitPrice,
            });
          }
        }

        // Also check items that have NO stock at all in any warehouse
        if (item.warehouseStocks.length === 0) {
          const preferredSupplier = item.itemSuppliers[0] || null;
          const unitPrice = preferredSupplier ? Number(preferredSupplier.unitPrice) : 0;

          alerts.push({
            itemId: item.id,
            itemName: item.name,
            sku: item.sku,
            categoryName: item.category?.name || null,
            warehouseId: '',
            warehouseName: 'No warehouse',
            propertyId: '',
            currentQty: 0,
            reorderPoint: item.reorderPoint,
            reorderQty: item.reorderQty,
            deficit: item.reorderPoint,
            preferredSupplier: preferredSupplier
              ? {
                  id: preferredSupplier.supplier.id,
                  name: preferredSupplier.supplier.name,
                  unitPrice,
                  leadDays: preferredSupplier.leadDays,
                }
              : null,
            estimatedCost: item.reorderQty * unitPrice,
          });
        }
      }

      // Sort: out of stock first, then by deficit descending
      return alerts.sort((a, b) => {
        if (a.currentQty === 0 && b.currentQty !== 0) return -1;
        if (a.currentQty !== 0 && b.currentQty === 0) return 1;
        return b.deficit - a.deficit;
      });
    } catch (error) {
      this.logger.error(
        `Error getting low stock alerts: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Get a summary of reorder alerts.
   */
  async getReorderSummary(
    tenantId: string,
    options?: { propertyId?: string },
  ): Promise<ReorderSummary> {
    try {
      const alerts = await this.getLowStockAlerts(tenantId, options);

      const alertsByWarehouse: Record<string, number> = {};
      const alertsByCategory: Record<string, number> = {};
      let criticalCount = 0;
      let warningCount = 0;
      let estimatedTotalCost = 0;

      for (const alert of alerts) {
        // Count by severity
        if (alert.currentQty === 0) {
          criticalCount++;
        } else {
          warningCount++;
        }

        // Aggregate by warehouse
        const whKey = alert.warehouseName || 'Unknown';
        alertsByWarehouse[whKey] = (alertsByWarehouse[whKey] || 0) + 1;

        // Aggregate by category
        const catKey = alert.categoryName || 'Uncategorized';
        alertsByCategory[catKey] = (alertsByCategory[catKey] || 0) + 1;

        // Sum cost
        estimatedTotalCost += alert.estimatedCost;
      }

      return {
        totalAlerts: alerts.length,
        criticalCount,
        warningCount,
        estimatedTotalCost: Number(estimatedTotalCost.toFixed(2)),
        alertsByWarehouse,
        alertsByCategory,
      };
    } catch (error) {
      this.logger.error(
        `Error getting reorder summary: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  /**
   * Generate auto purchase order suggestions based on low stock alerts.
   * Groups items by preferred supplier for efficient ordering.
   */
  async generatePOSuggestions(
    tenantId: string,
    warehouseId: string,
  ): Promise<
    Array<{
      supplierId: string;
      supplierName: string;
      items: Array<{
        itemId: string;
        itemName: string;
        sku: string;
        suggestedQty: number;
        unitPrice: number;
        lineTotal: number;
      }>;
      totalAmount: number;
    }>
  > {
    try {
      const alerts = await this.getLowStockAlerts(tenantId, { warehouseId });

      // Group by preferred supplier
      const supplierMap = new Map<
        string,
        {
          supplierId: string;
          supplierName: string;
          items: Array<{
            itemId: string;
            itemName: string;
            sku: string;
            suggestedQty: number;
            unitPrice: number;
            lineTotal: number;
          }>;
        }
      >();

      for (const alert of alerts) {
        if (!alert.preferredSupplier) continue;

        const key = alert.preferredSupplier.id;
        if (!supplierMap.has(key)) {
          supplierMap.set(key, {
            supplierId: alert.preferredSupplier.id,
            supplierName: alert.preferredSupplier.name,
            items: [],
          });
        }

        const suggestedQty = Math.max(alert.reorderQty, alert.deficit);
        const lineTotal = suggestedQty * alert.preferredSupplier.unitPrice;

        supplierMap.get(key)!.items.push({
          itemId: alert.itemId,
          itemName: alert.itemName,
          sku: alert.sku,
          suggestedQty,
          unitPrice: alert.preferredSupplier.unitPrice,
          lineTotal: Number(lineTotal.toFixed(2)),
        });
      }

      return Array.from(supplierMap.values()).map((group) => ({
        ...group,
        totalAmount: Number(group.items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)),
      }));
    } catch (error) {
      this.logger.error(
        `Error generating PO suggestions: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}
