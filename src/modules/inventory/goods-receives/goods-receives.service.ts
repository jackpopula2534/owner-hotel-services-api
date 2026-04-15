import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateGoodsReceiveDto } from './dto/create-goods-receive.dto';
import { QueryGoodsReceiveDto } from './dto/query-goods-receive.dto';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface GoodsReceiveDetail {
  id: string;
  tenantId: string;
  grNumber: string;
  purchaseOrderId?: string;
  poNumber?: string;
  warehouseId: string;
  warehouseName?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  status: string;
  itemCount: number;
  totalReceivedQty: number;
  totalRejectedQty: number;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  inspectedBy?: string;
  inspectedAt?: Date;
  items?: any[];
}

@Injectable()
export class GoodsReceivesService {
  private readonly logger = new Logger(GoodsReceivesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate Goods Receive document number (GR-YYYYMM-NNNN)
   */
  private async generateGRNumber(tenantId: string, tx: any): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const seq = await tx.documentSequence.upsert({
      where: {
        tenantId_docType_yearMonth: {
          tenantId,
          docType: 'GOODS_RECEIVE',
          yearMonth,
        },
      },
      create: {
        tenantId,
        docType: 'GOODS_RECEIVE',
        prefix: 'GR',
        yearMonth,
        lastNumber: 1,
      },
      update: { lastNumber: { increment: 1 } },
    });

    return `GR-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }

  /**
   * Find all goods receives with pagination and filters
   */
  async findAll(
    tenantId: string,
    query: QueryGoodsReceiveDto,
  ): Promise<PaginatedResponse<GoodsReceiveDetail>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const sort = query.sort || 'createdAt';
    const order = query.order || 'desc';

    const where: Record<string, any> = { tenantId };

    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }

    if (query.purchaseOrderId) {
      where.purchaseOrderId = query.purchaseOrderId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const [receives, total] = await Promise.all([
      this.prisma.goodsReceive.findMany({
        where,
        include: {
          warehouse: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, poNumber: true } },
          items: true,
        },
        orderBy: { [sort]: order },
        skip,
        take: limit,
      }),
      this.prisma.goodsReceive.count({ where }),
    ]);

    const data = receives.map((gr) => this.mapToDetail(gr));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find a single goods receive by ID with full details
   */
  async findOne(id: string, tenantId: string): Promise<GoodsReceiveDetail> {
    const receive = await this.prisma.goodsReceive.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        items: {
          include: {
            item: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    if (!receive) {
      throw new NotFoundException(`Goods receive with ID ${id} not found`);
    }

    if (receive.tenantId !== tenantId) {
      throw new NotFoundException(`Goods receive with ID ${id} not found`);
    }

    return this.mapToDetail(receive);
  }

  /**
   * Create goods receive with full transaction handling
   * Core method: generates GR number, handles PO updates, creates stock movements
   */
  async create(
    dto: CreateGoodsReceiveDto,
    userId: string,
    tenantId: string,
  ): Promise<GoodsReceiveDetail> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Validate warehouse
      const warehouse = await tx.warehouse.findUnique({
        where: { id: dto.warehouseId },
      });

      if (!warehouse) {
        throw new NotFoundException(`Warehouse with ID ${dto.warehouseId} not found`);
      }

      if (warehouse.tenantId !== tenantId) {
        throw new NotFoundException(`Warehouse with ID ${dto.warehouseId} not found`);
      }

      // 2. Validate PO if provided
      let po: any = null;
      if (dto.purchaseOrderId) {
        po = await tx.purchaseOrder.findUnique({
          where: { id: dto.purchaseOrderId },
          include: { items: true },
        });

        if (!po) {
          throw new NotFoundException(`Purchase Order with ID ${dto.purchaseOrderId} not found`);
        }

        if (po.tenantId !== tenantId) {
          throw new NotFoundException(`Purchase Order with ID ${dto.purchaseOrderId} not found`);
        }

        if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
          throw new ConflictException(
            `Purchase Order must be in APPROVED or PARTIALLY_RECEIVED status`,
          );
        }
      }

      // 3. Generate GR number
      const grNumber = await this.generateGRNumber(tenantId, tx);

      // 4. Create GoodsReceive record
      const goodsReceive = await tx.goodsReceive.create({
        data: {
          tenantId,
          grNumber,
          purchaseOrderId: dto.purchaseOrderId,
          warehouseId: dto.warehouseId,
          invoiceNumber: dto.invoiceNumber,
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
          status: 'ACCEPTED',
          notes: dto.notes,
          receivedBy: userId,
        },
      });

      // 5. Validate items and create GoodsReceiveItems, StockMovements
      const totalReceivedQty = dto.items.reduce((sum, item) => sum + item.receivedQty, 0);
      const totalRejectedQty = dto.items.reduce((sum, item) => sum + (item.rejectedQty || 0), 0);

      const grItems: any[] = [];

      for (const item of dto.items) {
        // Validate item exists
        const invItem = await tx.inventoryItem.findUnique({
          where: { id: item.itemId },
        });

        if (!invItem) {
          throw new NotFoundException(`Inventory item with ID ${item.itemId} not found`);
        }

        // Create GoodsReceiveItem
        const acceptedQtyForCost = item.receivedQty - (item.rejectedQty || 0);
        const grItem = await tx.goodsReceiveItem.create({
          data: {
            goodsReceiveId: goodsReceive.id,
            itemId: item.itemId,
            receivedQty: item.receivedQty,
            rejectedQty: item.rejectedQty || 0,
            unitCost: item.unitCost,
            totalCost: acceptedQtyForCost * item.unitCost,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
            rejectReason: item.rejectReason,
            notes: item.notes,
          },
        });

        grItems.push(grItem);

        // Create StockMovement for accepted quantity
        const acceptedQty = item.receivedQty - (item.rejectedQty || 0);
        if (acceptedQty > 0) {
          await tx.stockMovement.create({
            data: {
              tenantId,
              warehouse: { connect: { id: dto.warehouseId } },
              item: { connect: { id: item.itemId } },
              type: 'GOODS_RECEIVE',
              quantity: acceptedQty,
              unitCost: item.unitCost,
              totalCost: acceptedQty * item.unitCost,
              referenceType: 'GOODS_RECEIVE',
              referenceId: goodsReceive.id,
              batchNumber: item.batchNumber,
              expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
              notes: item.notes,
              createdBy: userId,
            },
          });

          // Update or create WarehouseStock
          const existingStock = await tx.warehouseStock.findUnique({
            where: {
              warehouseId_itemId: {
                warehouseId: dto.warehouseId,
                itemId: item.itemId,
              },
            },
          });

          if (existingStock) {
            // Calculate new weighted average cost
            const newTotalQty = existingStock.quantity + acceptedQty;
            const newAvgCost =
              (existingStock.quantity * Number(existingStock.avgCost) +
                acceptedQty * item.unitCost) /
              newTotalQty;

            await tx.warehouseStock.update({
              where: {
                warehouseId_itemId: {
                  warehouseId: dto.warehouseId,
                  itemId: item.itemId,
                },
              },
              data: {
                quantity: newTotalQty,
                avgCost: newAvgCost,
                totalValue: newTotalQty * newAvgCost,
              },
            });
          } else {
            // Create new warehouse stock
            await tx.warehouseStock.create({
              data: {
                warehouseId: dto.warehouseId,
                itemId: item.itemId,
                quantity: acceptedQty,
                avgCost: item.unitCost,
                totalValue: acceptedQty * item.unitCost,
              },
            });
          }
        }

        // Update PO item if PO provided
        if (po) {
          const poItem = po.items.find((pi: any) => pi.itemId === item.itemId);
          if (poItem) {
            const newReceivedQty = (poItem.receivedQty || 0) + acceptedQty;
            await tx.purchaseOrderItem.update({
              where: { id: poItem.id },
              data: { receivedQty: newReceivedQty },
            });
          }
        }
      }

      // 6. Update PO status if all items received
      if (po) {
        const poItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: po.id },
        });

        const allFullyReceived = poItems.every((pi: any) => pi.receivedQty >= pi.quantity);
        const anyPartiallyReceived = poItems.some(
          (pi: any) => pi.receivedQty > 0 && pi.receivedQty < pi.quantity,
        );

        const newPoStatus = allFullyReceived
          ? 'FULLY_RECEIVED'
          : anyPartiallyReceived
            ? 'PARTIALLY_RECEIVED'
            : po.status;

        if (newPoStatus !== po.status) {
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { status: newPoStatus },
          });
        }
      }

      // 7. Return full details
      return this.mapToDetail({
        ...goodsReceive,
        warehouse: { id: warehouse.id, name: warehouse.name },
        purchaseOrder: po ? { id: po.id, poNumber: po.poNumber } : null,
        items: grItems,
      });
    });
  }

  /**
   * Mark goods receive as inspected
   */
  async inspect(
    id: string,
    userId: string,
    tenantId: string,
    status: 'INSPECTING' | 'REJECTED',
  ): Promise<GoodsReceiveDetail> {
    const receive = await this.prisma.goodsReceive.findUnique({
      where: { id },
    });

    if (!receive) {
      throw new NotFoundException(`Goods receive with ID ${id} not found`);
    }

    if (receive.tenantId !== tenantId) {
      throw new NotFoundException(`Goods receive with ID ${id} not found`);
    }

    if (receive.status !== 'ACCEPTED') {
      throw new ConflictException('Goods receive must be in ACCEPTED status to inspect');
    }

    const updated = await this.prisma.goodsReceive.update({
      where: { id },
      data: {
        status,
        inspectedBy: userId,
        inspectedAt: new Date(),
      },
      include: {
        warehouse: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        items: {
          include: {
            item: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    return this.mapToDetail(updated);
  }

  /**
   * Map raw database record to response DTO
   */
  private mapToDetail(receive: any): GoodsReceiveDetail {
    const items = receive.items || [];
    const totalReceivedQty = items.reduce((sum: number, item: any) => sum + item.receivedQty, 0);
    const totalRejectedQty = items.reduce(
      (sum: number, item: any) => sum + (item.rejectedQty || 0),
      0,
    );

    return {
      id: receive.id,
      tenantId: receive.tenantId,
      grNumber: receive.grNumber,
      purchaseOrderId: receive.purchaseOrderId,
      poNumber: receive.purchaseOrder?.poNumber,
      warehouseId: receive.warehouseId,
      warehouseName: receive.warehouse?.name,
      invoiceNumber: receive.invoiceNumber,
      invoiceDate: receive.invoiceDate?.toISOString(),
      status: receive.status,
      itemCount: items.length,
      totalReceivedQty,
      totalRejectedQty,
      notes: receive.notes,
      createdBy: receive.receivedBy,
      createdAt: receive.createdAt,
      updatedAt: receive.updatedAt,
      inspectedBy: receive.inspectedBy,
      inspectedAt: receive.inspectedAt,
      items:
        items.length > 0
          ? items.map((item: any) => ({
              id: item.id,
              itemId: item.itemId,
              itemName: item.item?.name,
              itemSku: item.item?.sku,
              receivedQty: item.receivedQty,
              rejectedQty: item.rejectedQty || 0,
              unitCost: item.unitCost,
              batchNumber: item.batchNumber,
              expiryDate: item.expiryDate?.toISOString(),
              rejectReason: item.rejectReason,
              notes: item.notes,
            }))
          : undefined,
    };
  }
}
