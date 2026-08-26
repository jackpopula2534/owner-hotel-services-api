import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { QueryRetailProductDto } from './dto/query-retail-product.dto';
import { CreateMenuFromItemDto } from './dto/create-menu-from-item.dto';

export interface RetailProductStockRow {
  warehouseId: string;
  warehouseName: string;
  quantity: number;
}

export interface RetailProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  imageUrl: string | null;
  isActive: boolean;
  categoryId: string | null;
  categoryName: string | null;
  /** ต้นทุนเฉลี่ยถ่วงน้ำหนักข้ามคลัง — null เมื่อไม่มีของเหลือให้ถ่วง */
  avgCost: number | null;
  sellingPrice: number | null;
  /** กำไรต่อหน่วย = ราคาขาย − ต้นทุนเฉลี่ย (null เมื่อขาดข้างใดข้างหนึ่ง) */
  marginPerUnit: number | null;
  marginPercent: number | null;
  totalQty: number;
  stockValue: number;
  stockByWarehouse: RetailProductStockRow[];
  linkedMenuCount: number;
  linkedMenus: { id: string; name: string; restaurantId: string; price: number }[];
}

export interface RetailProductSummary {
  totalProducts: number;
  linkedProducts: number;
  unlinkedProducts: number;
  unpricedProducts: number;
  outOfStock: number;
  negativeStock: number;
  stockValue: number;
}

/**
 * "สินค้าหน้าร้าน" — มุมมองของสินค้าสำเร็จรูปที่ขายได้ ไม่ใช่ CRUD ตัวใหม่
 *
 * หน้าสินค้าเดิมตอบคำถาม "มีของอะไรอยู่เท่าไร" แต่คนที่ดูแลของขายหน้าร้าน
 * ถามอีกชุดหนึ่ง: ตัวไหนยังไม่ได้ตั้งราคา ตัวไหนยังไม่ได้ผูกเป็นเมนู ขายแล้วได้กำไรกี่บาท
 * จึงรวมยอดคลัง ราคาขาย และเมนูที่ผูกไว้มาอยู่ในแถวเดียวกัน
 */
@Injectable()
export class RetailProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: QueryRetailProductDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.InventoryItemWhereInput = {
      tenantId,
      deletedAt: null,
      itemType: 'FINISHED_GOOD',
    };

    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [{ name: { contains: search } }, { sku: { contains: search } }];
    }
    if (query.unlinkedOnly === 'true') {
      where.menuItems = { none: {} };
    }
    if (query.unpricedOnly === 'true') {
      where.sellingPrice = null;
    }

    const [total, items] = await Promise.all([
      this.prisma.inventoryItem.count({ where }),
      this.prisma.inventoryItem.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          imageUrl: true,
          isActive: true,
          categoryId: true,
          sellingPrice: true,
          category: { select: { name: true } },
          warehouseStocks: {
            where: query.warehouseId ? { warehouseId: query.warehouseId } : undefined,
            select: {
              warehouseId: true,
              quantity: true,
              avgCost: true,
              warehouse: { select: { name: true } },
            },
          },
          menuItems: {
            select: { id: true, name: true, restaurantId: true, price: true },
          },
        },
      }),
    ]);

    return {
      data: items.map((item) => this.toRow(item)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async summary(tenantId: string): Promise<RetailProductSummary> {
    const items = await this.prisma.inventoryItem.findMany({
      where: { tenantId, deletedAt: null, itemType: 'FINISHED_GOOD' },
      select: {
        sellingPrice: true,
        warehouseStocks: { select: { quantity: true, avgCost: true } },
        _count: { select: { menuItems: true } },
      },
    });

    let linked = 0;
    let unpriced = 0;
    let outOfStock = 0;
    let negativeStock = 0;
    let stockValue = 0;

    for (const item of items) {
      if (item._count.menuItems > 0) linked += 1;
      if (item.sellingPrice === null) unpriced += 1;

      const totalQty = item.warehouseStocks.reduce((sum, s) => sum + s.quantity, 0);
      if (totalQty === 0) outOfStock += 1;
      // ติดลบ = ขายไปแล้วแต่ไม่มีของรองรับ ต้องเด้งขึ้นมาให้เห็นแยกจาก "หมด"
      if (totalQty < 0) negativeStock += 1;
      stockValue += item.warehouseStocks.reduce(
        (sum, s) => sum + s.quantity * Number(s.avgCost),
        0,
      );
    }

    return {
      totalProducts: items.length,
      linkedProducts: linked,
      unlinkedProducts: items.length - linked,
      unpricedProducts: unpriced,
      outOfStock,
      negativeStock,
      stockValue: Math.round(stockValue * 100) / 100,
    };
  }

  /**
   * สร้างเมนูจากสินค้าในคลัง — ผูก 1:1 ทันที ยอดคงเหลืออยู่ที่คลังตัวเดียว
   * ห้ามเปิด trackStock เด็ดขาด ไม่งั้นได้สองแหล่งความจริง
   */
  async createMenuItem(tenantId: string, itemId: string, dto: CreateMenuFromItemDto) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        itemType: true,
        sellingPrice: true,
        warehouseStocks: { select: { quantity: true, avgCost: true } },
      },
    });
    if (!item) throw new NotFoundException('ไม่พบสินค้าในคลัง');
    if (item.itemType !== 'FINISHED_GOOD') {
      throw new BadRequestException(
        'สินค้านี้เป็นวัตถุดิบ — เปลี่ยนชนิดเป็น "สินค้าสำเร็จรูป" ก่อนจึงจะผูกเป็นเมนูได้',
      );
    }

    const category = await this.prisma.menuCategory.findFirst({
      where: { id: dto.categoryId, restaurantId: dto.restaurantId, tenantId },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('ไม่พบหมวดเมนูในร้านที่เลือก');

    const price = dto.price ?? (item.sellingPrice !== null ? Number(item.sellingPrice) : null);
    if (price === null) {
      throw new BadRequestException('สินค้านี้ยังไม่มีราคาขาย — ตั้งราคาก่อนหรือส่งราคามาด้วย');
    }

    const duplicate = await this.prisma.menuItem.findFirst({
      where: { restaurantId: dto.restaurantId, tenantId, inventoryItemId: itemId },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('ร้านนี้มีเมนูที่ผูกกับสินค้าตัวนี้อยู่แล้ว');
    }

    const last = await this.prisma.menuItem.findFirst({
      where: { categoryId: dto.categoryId, tenantId },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });

    // ต้นทุนติดไปกับเมนูตั้งแต่แรก ไม่งั้นรายงานกำไรอ่านเมนูใหม่เป็นกำไร 100%
    // (ยอดจริงยังตัดจากคลังตามต้นทุนถัวเฉลี่ยตอนขาย ค่านี้เป็นตัวตั้งของรายงานเท่านั้น)
    const stockedQty = item.warehouseStocks.reduce((sum, w) => sum + w.quantity, 0);
    const cost =
      stockedQty > 0
        ? Math.round(
            (item.warehouseStocks.reduce((sum, w) => sum + w.quantity * Number(w.avgCost), 0) /
              stockedQty) *
              100,
          ) / 100
        : null;

    return this.prisma.menuItem.create({
      data: {
        tenantId,
        restaurantId: dto.restaurantId,
        categoryId: dto.categoryId,
        name: dto.name?.trim() || item.name,
        price,
        cost,
        itemKind: 'READY_MADE',
        inventoryItemId: itemId,
        trackStock: false,
        displayOrder: (last?.displayOrder ?? -1) + 1,
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toRow(item: any): RetailProductRow {
    const stockByWarehouse: RetailProductStockRow[] = item.warehouseStocks.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => ({
        warehouseId: s.warehouseId,
        warehouseName: s.warehouse?.name ?? '',
        quantity: s.quantity,
      }),
    );

    const totalQty = stockByWarehouse.reduce((sum, s) => sum + s.quantity, 0);
    const stockValue = item.warehouseStocks.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sum: number, s: any) => sum + s.quantity * Number(s.avgCost),
      0,
    );

    // ต้นทุนเฉลี่ยถ่วงตามจำนวน ไม่ใช่ค่าเฉลี่ยของค่าเฉลี่ย — คลังที่มีของ 1 ชิ้น
    // ต้องไม่ถ่วงเท่ากับคลังที่มี 500 ชิ้น
    const avgCost = totalQty > 0 ? stockValue / totalQty : null;
    const sellingPrice = item.sellingPrice !== null ? Number(item.sellingPrice) : null;
    const marginPerUnit =
      sellingPrice !== null && avgCost !== null
        ? Math.round((sellingPrice - avgCost) * 100) / 100
        : null;

    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      imageUrl: item.imageUrl,
      isActive: item.isActive,
      categoryId: item.categoryId,
      categoryName: item.category?.name ?? null,
      avgCost: avgCost === null ? null : Math.round(avgCost * 100) / 100,
      sellingPrice,
      marginPerUnit,
      marginPercent:
        marginPerUnit !== null && sellingPrice
          ? Math.round((marginPerUnit / sellingPrice) * 1000) / 10
          : null,
      totalQty,
      stockValue: Math.round(stockValue * 100) / 100,
      stockByWarehouse,
      linkedMenuCount: item.menuItems.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkedMenus: item.menuItems.map((m: any) => ({
        id: m.id,
        name: m.name,
        restaurantId: m.restaurantId,
        price: Number(m.price),
      })),
    };
  }
}
