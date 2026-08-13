import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Supplier } from '@prisma/client';

/** แปลง tags array → JSON string สำหรับเก็บใน DB */
function serializeTags(tags?: string[]): string | undefined {
  if (!tags) return undefined;
  return JSON.stringify(tags);
}

/** แปลง JSON string → tags array สำหรับส่งออก */
function deserializeSupplier<T extends { tags?: string | null }>(
  supplier: T,
): Omit<T, 'tags'> & { tags: string[] } {
  let tags: string[] = [];
  if (typeof supplier.tags === 'string') {
    try {
      tags = JSON.parse(supplier.tags);
    } catch {
      tags = [];
    }
  }
  return { ...supplier, tags };
}

function maskTaxId(taxId?: string | null): string | null | undefined {
  if (!taxId) return taxId;
  const visible = taxId.replace(/\D/g, '').slice(-4);
  return visible ? `***-***-${visible}` : '***';
}

function maskSupplierTaxId<T extends { taxId?: string | null }>(supplier: T): T {
  return {
    ...supplier,
    taxId: maskTaxId(supplier.taxId),
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    search?: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponse<any>> {
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      deletedAt: null,
      // mode: 'insensitive' is not supported by Prisma v5 + MySQL
      ...(search && {
        OR: [{ name: { contains: search } }, { code: { contains: search } }],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              purchaseOrders: true,
              itemSuppliers: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return {
      data: data.map((supplier) => maskSupplierTaxId(deserializeSupplier(supplier))),
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  async findOne(id: string, tenantId: string): Promise<any> {
    const supplier = await this.prisma.supplier.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      include: {
        itemSuppliers: {
          include: {
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
              },
            },
          },
        },
        purchaseOrders: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
          },
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${id} not found for tenant ${tenantId}`);
    }

    return maskSupplierTaxId(deserializeSupplier(supplier));
  }

  /**
   * Next free SUP-#### for the tenant.
   *
   * Soft-deleted rows still hold their code — the unique index covers every row,
   * deleted or not — so the scan deliberately ignores `deletedAt`. Reusing a
   * dead supplier's code would collide at the database and, worse, silently
   * attach old purchase history to a different vendor.
   */
  private async allocateSupplierCode(tenantId: string): Promise<string> {
    const taken = await this.prisma.supplier.findMany({
      where: { tenantId, code: { startsWith: 'SUP-' } },
      select: { code: true },
    });

    let highest = 0;
    for (const { code } of taken) {
      const n = Number(code.slice(4));
      if (Number.isInteger(n) && n > highest) highest = n;
    }

    return `SUP-${String(highest + 1).padStart(4, '0')}`;
  }

  async create(dto: CreateSupplierDto, tenantId: string): Promise<Supplier> {
    const { code: requestedCode, ...rest } = dto;

    // An explicit code is the caller's to own — a clash is their mistake and
    // must be reported. An allocated one is ours, so a clash (two people adding
    // a vendor in the same second) is ours to retry through.
    if (requestedCode) {
      const existing = await this.prisma.supplier.findFirst({
        where: { code: requestedCode, tenantId, deletedAt: null },
      });

      if (existing) {
        throw new ConflictException(
          `Supplier with code ${requestedCode} already exists for this tenant`,
        );
      }
    }

    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; ; attempt++) {
      const code = requestedCode ?? (await this.allocateSupplierCode(tenantId));
      try {
        const supplier = await this.prisma.supplier.create({
          data: {
            ...rest,
            code,
            tags: serializeTags(dto.tags),
            tenantId,
          },
        });

        this.logger.log(
          `Created supplier ${supplier.id} (code: ${supplier.code}) for tenant ${tenantId}`,
        );

        return maskSupplierTaxId(deserializeSupplier(supplier)) as unknown as Supplier;
      } catch (error) {
        const raced =
          !requestedCode &&
          (error as { code?: string }).code === 'P2002' &&
          attempt < MAX_ATTEMPTS;
        if (raced) {
          this.logger.warn(`Supplier code ${code} was taken mid-flight — reallocating`);
          continue;
        }
        this.logger.error(`Failed to create supplier for tenant ${tenantId}`, error);
        throw error;
      }
    }
  }

  async update(id: string, dto: UpdateSupplierDto, tenantId: string): Promise<Supplier> {
    // Verify supplier exists
    const supplier = await this.prisma.supplier.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${id} not found`);
    }

    // Validate code uniqueness if code is being updated
    if (dto.code && dto.code !== supplier.code) {
      const existing = await this.prisma.supplier.findFirst({
        where: {
          code: dto.code,
          tenantId,
          deletedAt: null,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Supplier with code ${dto.code} already exists for this tenant`,
        );
      }
    }

    try {
      const updated = await this.prisma.supplier.update({
        where: { id },
        data: {
          ...dto,
          tags: serializeTags(dto.tags),
        },
      });

      this.logger.log(`Updated supplier ${id} for tenant ${tenantId}`);

      return maskSupplierTaxId(deserializeSupplier(updated)) as unknown as Supplier;
    } catch (error) {
      this.logger.error(`Failed to update supplier ${id}`, error);
      throw error;
    }
  }

  async remove(id: string, tenantId: string): Promise<void> {
    // Verify supplier exists
    const supplier = await this.prisma.supplier.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID ${id} not found`);
    }

    // Check for open purchase orders
    const openPOs = await this.prisma.purchaseOrder.count({
      where: {
        supplierId: id,
        status: {
          in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'],
        },
      },
    });

    if (openPOs > 0) {
      throw new BadRequestException(
        `Cannot delete supplier with ${openPOs} open purchase order(s)`,
      );
    }

    try {
      await this.prisma.supplier.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });

      this.logger.log(`Soft-deleted supplier ${id} for tenant ${tenantId}`);
    } catch (error) {
      this.logger.error(`Failed to delete supplier ${id}`, error);
      throw error;
    }
  }
}
