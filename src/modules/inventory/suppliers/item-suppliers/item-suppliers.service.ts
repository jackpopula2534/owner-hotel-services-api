import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateItemSupplierDto } from './dto/create-item-supplier.dto';
import { UpdateItemSupplierDto } from './dto/update-item-supplier.dto';
import { ItemSupplier } from '@prisma/client';

@Injectable()
export class ItemSuppliersService {
  private readonly logger = new Logger(ItemSuppliersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByItem(itemId: string, tenantId: string): Promise<any[]> {
    // Verify item belongs to tenant
    const item = await this.prisma.inventoryItem.findFirst({
      where: {
        id: itemId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!item) {
      throw new NotFoundException(`Inventory item ${itemId} not found for tenant ${tenantId}`);
    }

    const itemSuppliers = await this.prisma.itemSupplier.findMany({
      where: {
        itemId,
      },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            leadTimeDays: true,
          },
        },
      },
      orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
    });

    return itemSuppliers;
  }

  async findBySupplier(supplierId: string, tenantId: string): Promise<any[]> {
    // Verify supplier belongs to tenant
    const supplier = await this.prisma.supplier.findFirst({
      where: {
        id: supplierId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier ${supplierId} not found for tenant ${tenantId}`);
    }

    const itemSuppliers = await this.prisma.itemSupplier.findMany({
      where: {
        supplierId,
      },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            sku: true,
            category: true,
            unit: true,
          },
        },
      },
      orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
    });

    return itemSuppliers;
  }

  async create(dto: CreateItemSupplierDto, tenantId: string): Promise<ItemSupplier> {
    // Validate item exists and belongs to tenant
    const item = await this.prisma.inventoryItem.findFirst({
      where: {
        id: dto.itemId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!item) {
      throw new BadRequestException(
        `Inventory item ${dto.itemId} not found or does not belong to this tenant`,
      );
    }

    // Validate supplier exists and belongs to tenant
    const supplier = await this.prisma.supplier.findFirst({
      where: {
        id: dto.supplierId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!supplier) {
      throw new BadRequestException(
        `Supplier ${dto.supplierId} not found or does not belong to this tenant`,
      );
    }

    // Check for duplicate (unique constraint: itemId + supplierId)
    const existing = await this.prisma.itemSupplier.findFirst({
      where: {
        itemId: dto.itemId,
        supplierId: dto.supplierId,
      },
    });

    if (existing) {
      throw new BadRequestException(`This supplier is already linked to this item`);
    }

    try {
      const { tenantId: _tenantId, ...createData } = dto as any;
      const itemSupplier = await this.prisma.itemSupplier.create({
        data: createData,
      });

      this.logger.log(
        `Created item-supplier link: item ${dto.itemId} <-> supplier ${dto.supplierId} for tenant ${tenantId}`,
      );

      return itemSupplier;
    } catch (error) {
      this.logger.error(`Failed to create item-supplier link for tenant ${tenantId}`, error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateItemSupplierDto, tenantId: string): Promise<ItemSupplier> {
    // Verify record exists by checking item belongs to tenant
    const itemSupplier = await this.prisma.itemSupplier.findFirst({
      where: { id },
      include: { item: { select: { tenantId: true } } },
    });

    if (!itemSupplier || itemSupplier.item.tenantId !== tenantId) {
      throw new NotFoundException(`Item-supplier link ${id} not found for tenant ${tenantId}`);
    }

    try {
      const updated = await this.prisma.itemSupplier.update({
        where: { id },
        data: dto,
      });

      this.logger.log(`Updated item-supplier link ${id} for tenant ${tenantId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Failed to update item-supplier link ${id}`, error);
      throw error;
    }
  }

  async remove(id: string, tenantId: string): Promise<void> {
    // Verify record exists by checking item belongs to tenant
    const itemSupplier = await this.prisma.itemSupplier.findFirst({
      where: { id },
      include: { item: { select: { tenantId: true } } },
    });

    if (!itemSupplier || itemSupplier.item.tenantId !== tenantId) {
      throw new NotFoundException(`Item-supplier link ${id} not found for tenant ${tenantId}`);
    }

    try {
      await this.prisma.itemSupplier.delete({
        where: { id },
      });

      this.logger.log(`Deleted item-supplier link ${id} for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(`Failed to delete item-supplier link ${id}`, error);
      throw error;
    }
  }

  async setPreferred(itemId: string, supplierId: string, tenantId: string): Promise<ItemSupplier> {
    // Verify item belongs to tenant
    const item = await this.prisma.inventoryItem.findFirst({
      where: {
        id: itemId,
        tenantId,
        deletedAt: null,
      },
    });

    if (!item) {
      throw new BadRequestException(
        `Inventory item ${itemId} not found or does not belong to this tenant`,
      );
    }

    // Verify the link exists
    const itemSupplier = await this.prisma.itemSupplier.findFirst({
      where: {
        itemId,
        supplierId,
      },
    });

    if (!itemSupplier) {
      throw new NotFoundException(
        `Item-supplier link not found for item ${itemId} and supplier ${supplierId}`,
      );
    }

    try {
      // Use transaction to unset other preferred suppliers and set this one
      const result = await this.prisma.$transaction([
        // Unset all other preferred suppliers for this item
        this.prisma.itemSupplier.updateMany({
          where: {
            itemId,
            supplierId: { not: supplierId },
          },
          data: {
            isPreferred: false,
          },
        }),
        // Set this supplier as preferred
        this.prisma.itemSupplier.update({
          where: { id: itemSupplier.id },
          data: {
            isPreferred: true,
          },
        }),
      ]);

      this.logger.log(
        `Set supplier ${supplierId} as preferred for item ${itemId} (tenant ${tenantId})`,
      );

      return result[1] as ItemSupplier;
    } catch (error) {
      this.logger.error(`Failed to set preferred supplier for item ${itemId}`, error);
      throw error;
    }
  }
}
