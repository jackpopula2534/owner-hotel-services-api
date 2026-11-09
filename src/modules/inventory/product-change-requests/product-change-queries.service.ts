import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  ChangeRequestActor,
  REVIEWER_ROLES,
  VIEWER_ROLES,
  assertRole,
} from './product-change-access';
import {
  PROCUREMENT_FIELDS,
  ProcurementFieldDef,
  ProcurementSnapshot,
} from './product-change-fields';
import { DuplicateCandidate, ProductChangeApplyService } from './product-change-apply.service';
import {
  ITEM_BRIEF,
  OPEN_STATUSES,
  ProductRequestDetail,
  ProductRequestRow,
  ProductRequestSummary,
  REVIEW_SLA_HOURS,
  displayNameOf,
  isOpen,
  isOverdue,
  permissionsFor,
  readChanges,
} from './product-change-shared';
import type { NewItemProposalDto, SuggestedWarehouseDto } from './dto/create-product-request.dto';
import type { WarehouseDataDto } from './dto/review-product-request.dto';
import { QueryProductRequestDto } from './dto/query-product-request.dto';

export interface ItemProcurementSnapshot {
  item: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    isActive: boolean;
    minStock: number;
    maxStock: number | null;
    reorderPoint: number;
    isPerishable: boolean;
    requiresLotTracking: boolean;
    category: { id: string; name: string } | null;
  };
  procurement: ProcurementSnapshot;
  preferredSupplier: { id: string; name: string; code: string } | null;
  openRequest: { id: string; requestNumber: string; status: string } | null;
  stock: { onHand: number; openPoCount: number };
  history: Array<{
    id: string;
    requestNumber: string;
    type: string;
    status: string;
    changeSummary: string[];
    reviewedByName: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
  }>;
}

/** ฝั่งอ่านของคำขอสินค้า — รายการ, สรุป, รายละเอียด, ค่าปัจจุบันของสินค้า */
@Injectable()
export class ProductChangeQueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applier: ProductChangeApplyService,
  ) {}

  async findAll(
    actor: ChangeRequestActor,
    query: QueryProductRequestDto,
  ): Promise<{
    data: ProductRequestRow[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    assertRole(actor, VIEWER_ROLES, 'ดูคำขอสินค้า');
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const statusFilter: Prisma.ProductChangeRequestWhereInput = query.done
      ? { status: { in: ['APPROVED', 'ACKNOWLEDGED'] } }
      : query.status
        ? { status: query.status }
        : {};

    const where: Prisma.ProductChangeRequestWhereInput = {
      tenantId: actor.tenantId,
      ...statusFilter,
      ...(query.type ? { type: query.type } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.mine ? { requestedById: actor.userId } : {}),
      ...(search
        ? {
            OR: [
              { requestNumber: { contains: search } },
              { item: { name: { contains: search } } },
              { item: { sku: { contains: search } } },
              { proposed: { path: '$.name', string_contains: search } },
            ],
          }
        : {}),
    };

    // คิวงานที่ยังเปิด: รอนานสุดขึ้นก่อน · ประวัติ: ใหม่สุดขึ้นก่อน
    const oldestFirst = !!query.status && isOpen(query.status);
    const [rows, total] = await Promise.all([
      this.prisma.productChangeRequest.findMany({
        where,
        include: { item: { select: { id: true, sku: true, name: true } } },
        orderBy: { createdAt: oldestFirst ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productChangeRequest.count({ where }),
    ]);

    const itemIds = [...new Set(rows.map((r) => r.itemId).filter((v): v is string => !!v))];
    const brief = await this.applier.stockBrief(actor.tenantId, itemIds);
    const now = Date.now();

    return {
      data: rows.map((r) => {
        const changes = readChanges(r.changes);
        return {
          id: r.id,
          requestNumber: r.requestNumber,
          type: r.type,
          status: r.status,
          level: r.level,
          displayName: displayNameOf(r, r.item),
          item: r.item,
          changeSummary: changes.map((c) => c.label),
          changeCount: changes.length,
          requestedById: r.requestedById,
          requestedByName: r.requestedByName,
          reviewedByName: r.reviewedByName,
          createdAt: r.createdAt,
          reviewedAt: r.reviewedAt,
          effectiveDate: r.effectiveDate,
          appliedAt: r.appliedAt,
          isOverdue: isOverdue(r, now),
          stock: r.itemId ? (brief.get(r.itemId) ?? null) : null,
        };
      }),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async summary(actor: ChangeRequestActor): Promise<ProductRequestSummary> {
    assertRole(actor, VIEWER_ROLES, 'ดูคำขอสินค้า');
    const tenantId = actor.tenantId;
    const overdueBefore = new Date(Date.now() - REVIEW_SLA_HOURS * 3600_000);
    const count = (where: Prisma.ProductChangeRequestWhereInput): Promise<number> =>
      this.prisma.productChangeRequest.count({ where: { tenantId, ...where } });
    const [pending, needsInfo, pendingCreate, pendingApproval, overdue, done, rejected] =
      await Promise.all([
        count({ status: 'PENDING' }),
        count({ status: 'NEEDS_INFO' }),
        count({ status: 'PENDING', type: 'CREATE' }),
        count({ status: 'PENDING', level: 'APPROVAL' }),
        count({ status: 'PENDING', createdAt: { lt: overdueBefore } }),
        count({ status: { in: ['APPROVED', 'ACKNOWLEDGED'] } }),
        count({ status: 'REJECTED' }),
      ]);
    return {
      pending,
      needsInfo,
      pendingCreate,
      pendingUpdate: pending - pendingCreate,
      pendingApproval,
      pendingAcknowledge: pending - pendingApproval,
      overdue,
      done,
      rejected,
    };
  }

  async findOne(actor: ChangeRequestActor, id: string): Promise<ProductRequestDetail> {
    assertRole(actor, VIEWER_ROLES, 'ดูคำขอสินค้า');
    const request = await this.prisma.productChangeRequest.findFirst({
      where: { id, tenantId: actor.tenantId },
      include: { item: ITEM_BRIEF, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!request) throw new NotFoundException(`ไม่พบคำขอ ${id}`);

    const changes = readChanges(request.changes);
    const proposal = (request.proposed ?? {}) as Partial<NewItemProposalDto>;
    const suggested = (request.suggestedWarehouse ?? {}) as Partial<SuggestedWarehouseDto>;
    const warehouseData = (request.warehouseData ?? {}) as Partial<WarehouseDataDto>;
    const isOpenCreate = request.type === 'CREATE' && isOpen(request.status);

    const supplierIds = [
      ...changes
        .filter((c) => c.field === 'preferredSupplierId')
        .flatMap((c) => [c.from, c.to])
        .filter((v): v is string => typeof v === 'string'),
      ...(typeof proposal.supplierId === 'string' ? [proposal.supplierId] : []),
    ];
    const categoryIds = [suggested.categoryId, warehouseData.categoryId].filter(
      (v): v is string => !!v,
    );

    const [impact, duplicates, suggestedSku, suppliers, categories] = await Promise.all([
      request.itemId
        ? this.applier.stockImpact(actor.tenantId, request.itemId)
        : Promise.resolve(null),
      isOpenCreate
        ? this.applier.findDuplicates(actor.tenantId, proposal.name, proposal.barcode)
        : Promise.resolve([] as DuplicateCandidate[]),
      isOpenCreate
        ? this.applier.suggestSku(actor.tenantId, suggested.categoryId)
        : Promise.resolve(null),
      supplierIds.length
        ? this.prisma.supplier.findMany({
            where: { id: { in: supplierIds }, tenantId: actor.tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      categoryIds.length
        ? this.prisma.itemCategory.findMany({
            where: { id: { in: categoryIds }, tenantId: actor.tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);

    return {
      ...request,
      changes,
      displayName: displayNameOf(request, request.item),
      impact,
      duplicates,
      suggestedSku,
      supplierNames: Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
      categoryNames: Object.fromEntries(categories.map((c) => [c.id, c.name])),
      isOverdue: isOverdue(request),
      permissions: permissionsFor(actor, request),
    };
  }

  /** ค่าปัจจุบันของสินค้า + คำขอที่ค้างอยู่ — ใช้เปิดฟอร์ม "ขอแก้ไข" ฝั่งจัดซื้อ */
  async itemSnapshot(actor: ChangeRequestActor, itemId: string): Promise<ItemProcurementSnapshot> {
    assertRole(actor, VIEWER_ROLES, 'ดูคำขอสินค้า');
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId: actor.tenantId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        isActive: true,
        minStock: true,
        maxStock: true,
        reorderPoint: true,
        isPerishable: true,
        requiresLotTracking: true,
        category: { select: { id: true, name: true } },
      },
    });
    if (!item) throw new NotFoundException(`ไม่พบสินค้า ${itemId}`);

    const [procurement, openRequest, history, brief] = await Promise.all([
      this.applier.readSnapshot(actor.tenantId, itemId),
      this.prisma.productChangeRequest.findFirst({
        where: {
          tenantId: actor.tenantId,
          itemId,
          type: 'UPDATE',
          status: { in: [...OPEN_STATUSES] },
        },
        select: { id: true, requestNumber: true, status: true },
      }),
      this.prisma.productChangeRequest.findMany({
        where: { tenantId: actor.tenantId, itemId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          requestNumber: true,
          type: true,
          status: true,
          changes: true,
          reviewedByName: true,
          reviewedAt: true,
          createdAt: true,
        },
      }),
      this.applier.stockBrief(actor.tenantId, [itemId]),
    ]);

    const preferredSupplier =
      typeof procurement.preferredSupplierId === 'string'
        ? await this.prisma.supplier.findFirst({
            where: { id: procurement.preferredSupplierId, tenantId: actor.tenantId },
            select: { id: true, name: true, code: true },
          })
        : null;

    return {
      item,
      procurement,
      preferredSupplier,
      openRequest,
      stock: brief.get(itemId) ?? { onHand: 0, openPoCount: 0 },
      history: history.map(({ changes, ...h }) => ({
        ...h,
        changeSummary: readChanges(changes).map((c) => c.label),
      })),
    };
  }

  fieldCatalog(): readonly ProcurementFieldDef[] {
    return PROCUREMENT_FIELDS;
  }

  async duplicateCheck(
    actor: ChangeRequestActor,
    name?: string,
    barcode?: string,
  ): Promise<DuplicateCandidate[]> {
    assertRole(actor, VIEWER_ROLES, 'ดูคำขอสินค้า');
    return this.applier.findDuplicates(actor.tenantId, name, barcode);
  }

  async suggestSku(actor: ChangeRequestActor, categoryId?: string): Promise<string> {
    assertRole(actor, REVIEWER_ROLES, 'กำหนด SKU');
    return this.applier.suggestSku(actor.tenantId, categoryId);
  }
}
