import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FolioChargeType, Prisma, RetailPaymentMethod, RetailSaleChannel } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import {
  RetailSaleOrigin,
  RetailSalesService,
} from '@/modules/inventory/retail-sales/retail-sales.service';
import {
  CreateMinibarConsumptionDto,
  CreateMinibarConsumptionLineDto,
} from './dto/create-minibar-consumption.dto';
import {
  QueryMinibarConsumptionDto,
  QueryMinibarProductsDto,
  QueryMinibarRoomsDto,
} from './dto/query-minibar.dto';

/** คลังที่จะถูกตัดของ พร้อมบอกว่ามาจากคลังมินิบาร์จริงหรือคลังสำรอง */
export interface MinibarSource {
  warehouseId: string;
  warehouseName: string;
  warehouseType: string;
  propertyId: string;
  /** true = ไม่ได้แยกคลังมินิบาร์ไว้ กำลังตัดจากคลังอื่นของสาขา */
  isFallback: boolean;
}

export interface MinibarProductRow {
  itemId: string;
  sku: string;
  name: string;
  unit: string;
  imageUrl: string | null;
  categoryName: string | null;
  sellingPrice: number | null;
  /** ยอดที่หยิบได้จริง = คงเหลือ − ที่ถูกกันไว้ */
  available: number;
  quantity: number;
}

/**
 * มินิบาร์ในห้องพัก — ไม่ใช่ท่อขายตัวใหม่
 *
 * ของในตู้มินิบาร์คือสินค้าสำเร็จรูปถังเดียวกับที่ขายหน้าร้าน ต่างกันแค่หน้างาน:
 * ไม่มีใครกดขายตอนแขกหยิบ แม่บ้านมาพบทีหลังแล้วบันทึกย้อน แล้วเงินไปโผล่ในบิลห้อง
 * ไม่ใช่ลิ้นชักเงินสด
 *
 * จึงเรียก RetailSalesService ต่อทั้งดุ้น — ตัดสต๊อก FEFO ออกใบเสร็จ ลงโฟลิโอ ลงสมุดรายได้
 * ใช้ท่อเดิมทุกท่อ ที่นี่ทำแค่สามอย่างที่ท่อเดิมไม่รู้: ห้องอยู่สาขาไหน คลังมินิบาร์ใบไหน
 * และราคาต้องมาจากตัวสินค้าไม่ใช่จากหน้าจอ
 *
 * เขียนแยกเป็นท่อที่สองไม่ได้เด็ดขาด — ยอดจะไม่ไปโผล่ในรายงานร้านค้า/สมุดรายได้
 * แล้วของหายจากคลังโดยไม่มีใบเสร็จรองรับ
 */
@Injectable()
export class MinibarService {
  private readonly logger = new Logger(MinibarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly retailSales: RetailSalesService,
    private readonly folioPosting: FolioPostingService,
  ) {}

  /**
   * ห้องที่ชาร์จได้ — ดึงจาก FolioPostingService ที่เดียวกับหน้าจออื่น
   * ห้ามนิยามเองซ้ำ ไม่งั้นจอให้เลือกห้องที่ตัวโพสต์ไม่รับ
   */
  async listRooms(tenantId: string, query: QueryMinibarRoomsDto) {
    return this.folioPosting.listChargeableRooms({
      tenantId,
      propertyId: query.propertyId ?? null,
      search: query.search,
    });
  }

  /** ของในตู้ของสาขานั้น พร้อมยอดคงเหลือและราคาที่จะถูกคิดจริง */
  async listProducts(
    tenantId: string,
    query: QueryMinibarProductsDto,
  ): Promise<{ source: MinibarSource; data: MinibarProductRow[] }> {
    const propertyId = await this.resolvePropertyId(tenantId, query);
    const source = await this.resolveSource(tenantId, propertyId, query.warehouseId);

    const itemWhere: Prisma.InventoryItemWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
      itemType: 'FINISHED_GOOD',
    };
    const search = query.search?.trim();
    if (search) {
      itemWhere.OR = [{ name: { contains: search } }, { sku: { contains: search } }];
    }

    const rows = await this.prisma.warehouseStock.findMany({
      where: {
        warehouseId: source.warehouseId,
        ...(query.includeOutOfStock === 'true' ? {} : { quantity: { gt: 0 } }),
        item: itemWhere,
      },
      select: {
        quantity: true,
        reservedQty: true,
        item: {
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
            imageUrl: true,
            sellingPrice: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { item: { name: 'asc' } },
    });

    return {
      source,
      data: rows.map((row) => ({
        itemId: row.item.id,
        sku: row.item.sku,
        name: row.item.name,
        unit: row.item.unit,
        imageUrl: row.item.imageUrl,
        categoryName: row.item.category?.name ?? null,
        sellingPrice: row.item.sellingPrice === null ? null : Number(row.item.sellingPrice),
        quantity: Number(row.quantity),
        available: Math.max(Number(row.quantity) - Number(row.reservedQty ?? 0), 0),
      })),
    };
  }

  /**
   * บันทึกของที่หายไปจากตู้ → ตัดสต๊อก + ขึ้นเป็นค่ามินิบาร์ในบิลห้อง
   *
   * ราคาอ่านจาก inventoryItem.sellingPrice ฝั่งเซิร์ฟเวอร์เสมอ ของที่ยังไม่ตั้งราคา
   * ต้องปฏิเสธไปเลย ปล่อยผ่านเป็นศูนย์เท่ากับแจกของฟรีแบบเงียบ ๆ
   */
  async recordConsumption(dto: CreateMinibarConsumptionDto, userId: string, tenantId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: dto.bookingId, tenantId },
      select: {
        id: true,
        propertyId: true,
        guestFirstName: true,
        guestLastName: true,
        guest: { select: { firstName: true, lastName: true } },
        room: { select: { id: true, number: true, propertyId: true } },
      },
    });
    if (!booking) throw new NotFoundException('ไม่พบการจองนี้ในองค์กรของคุณ');
    if (!booking.room) {
      throw new BadRequestException('การจองนี้ยังไม่ได้ผูกห้องพัก จึงบันทึกมินิบาร์ไม่ได้');
    }

    const source = await this.resolveSource(
      tenantId,
      booking.room.propertyId ?? booking.propertyId,
      dto.warehouseId,
    );
    const lines = await this.priceLines(tenantId, dto.lines);

    const roomNumber = booking.room.number;
    const origin: RetailSaleOrigin = {
      channel: RetailSaleChannel.MINIBAR,
      folioChargeType: FolioChargeType.MINIBAR,
      describe: (receiptNo) => `มินิบาร์ ห้อง ${roomNumber} — ใบเสร็จ ${receiptNo}`,
      roomId: booking.room.id,
    };

    const guestName =
      [booking.guest?.firstName ?? booking.guestFirstName, booking.guest?.lastName ?? booking.guestLastName]
        .filter(Boolean)
        .join(' ')
        .trim() || undefined;

    const sale = await this.retailSales.create(
      {
        warehouseId: source.warehouseId,
        paymentMethod: RetailPaymentMethod.ROOM_CHARGE,
        bookingId: booking.id,
        roomNumber,
        guestName,
        vatRate: dto.vatRate,
        notes: dto.notes,
        lines,
      },
      userId,
      tenantId,
      origin,
    );

    this.logger.log(
      `Minibar consumption recorded for room ${roomNumber} (booking ${booking.id}) from warehouse ${source.warehouseId}`,
    );
    return { ...sale, source };
  }

  /** ประวัติการหยิบของ — ช่องทาง MINIBAR เท่านั้น ใช้ตัวอ่านเดียวกับประวัติร้านค้า */
  async listConsumption(tenantId: string, query: QueryMinibarConsumptionDto) {
    return this.retailSales.findAll(tenantId, {
      ...query,
      channel: RetailSaleChannel.MINIBAR,
    });
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async resolvePropertyId(
    tenantId: string,
    query: QueryMinibarProductsDto,
  ): Promise<string> {
    if (query.propertyId) return query.propertyId;
    if (query.bookingId) {
      const booking = await this.prisma.booking.findFirst({
        where: { id: query.bookingId, tenantId },
        select: { propertyId: true, room: { select: { propertyId: true } } },
      });
      if (!booking) throw new NotFoundException('ไม่พบการจองนี้ในองค์กรของคุณ');
      return booking.room?.propertyId ?? booking.propertyId;
    }
    if (query.warehouseId) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { id: query.warehouseId, tenantId, deletedAt: null },
        select: { propertyId: true },
      });
      if (!warehouse) throw new BadRequestException('ไม่พบคลังที่เลือก หรือคลังถูกลบไปแล้ว');
      return warehouse.propertyId;
    }
    throw new BadRequestException('ต้องระบุสาขา (propertyId) หรือการจอง (bookingId)');
  }

  /**
   * คลังต้นทางของตู้มินิบาร์: คลังที่ระบุมาเอง → คลังประเภท MINIBAR ของสาขา
   * → คลังตั้งต้นของสาขา → คลังไหนก็ได้ในสาขา
   *
   * โรงแรมส่วนใหญ่ยังไม่ได้แยกคลังมินิบาร์ออกมา ถ้าเด้งเป็น error ตั้งแต่ไม่มีคลัง
   * ก็ใช้ฟีเจอร์ไม่ได้เลยทั้งที่ของอยู่ในคลังกลางครบ — แต่ตกไปใช้คลังสำรองแบบเงียบ ๆ
   * ก็อันตรายพอกัน จึงติดธง isFallback กลับไปให้หน้าจอบอกว่ากำลังตัดจากคลังไหน
   */
  private async resolveSource(
    tenantId: string,
    propertyId: string,
    explicitWarehouseId?: string,
  ): Promise<MinibarSource> {
    const base = { tenantId, isActive: true, deletedAt: null };

    if (explicitWarehouseId) {
      const chosen = await this.prisma.warehouse.findFirst({
        where: { ...base, id: explicitWarehouseId },
        select: { id: true, name: true, type: true, propertyId: true },
      });
      if (!chosen) {
        throw new BadRequestException('ไม่พบคลังที่เลือก หรือคลังถูกปิดใช้งานแล้ว');
      }
      return {
        warehouseId: chosen.id,
        warehouseName: chosen.name,
        warehouseType: chosen.type,
        propertyId: chosen.propertyId,
        isFallback: chosen.type !== 'MINIBAR',
      };
    }

    const candidates: Prisma.WarehouseWhereInput[] = [
      { propertyId, type: 'MINIBAR' },
      // ไม่มีคลังมินิบาร์ → ไปหาคลังที่มีของสำเร็จรูปอยู่จริงก่อน
      // ตกไปคลังตั้งต้นทันทีจะเจอจอเปล่า เพราะคลังตั้งต้นมักเก็บวัตถุดิบ ไม่ใช่ของขาย
      ...(await this.stockedWarehouseCandidate(tenantId, propertyId)),
      { propertyId, isDefault: true },
      { propertyId },
    ];
    for (const candidate of candidates) {
      const found = await this.prisma.warehouse.findFirst({
        where: { ...base, ...candidate },
        select: { id: true, name: true, type: true, propertyId: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!found) continue;
      if (found.type !== 'MINIBAR') {
        this.logger.warn(
          `Property ${propertyId} has no MINIBAR warehouse — minibar will deduct from ${found.id} (${found.type})`,
        );
      }
      return {
        warehouseId: found.id,
        warehouseName: found.name,
        warehouseType: found.type,
        propertyId: found.propertyId,
        isFallback: found.type !== 'MINIBAR',
      };
    }

    throw new BadRequestException('สาขานี้ยังไม่มีคลังสินค้าที่เปิดใช้งาน จึงตัดของมินิบาร์ไม่ได้');
  }

  /**
   * คลังในสาขาที่กองของสำเร็จรูปไว้มากที่สุด — คืนเป็น list เพื่อเสียบต่อในลำดับสำรอง
   * ว่าง = ไม่มีคลังไหนในสาขามีของขายเลย ก็ให้ไล่ลำดับต่อไปตามเดิม
   */
  private async stockedWarehouseCandidate(
    tenantId: string,
    propertyId: string,
  ): Promise<Prisma.WarehouseWhereInput[]> {
    const grouped = await this.prisma.warehouseStock.groupBy({
      by: ['warehouseId'],
      where: {
        quantity: { gt: 0 },
        item: { tenantId, deletedAt: null, isActive: true, itemType: 'FINISHED_GOOD' },
        warehouse: { tenantId, propertyId, isActive: true, deletedAt: null },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 1,
    });
    return grouped.length ? [{ id: grouped[0].warehouseId }] : [];
  }

  /** เติมราคาขายจากฝั่งเซิร์ฟเวอร์ และรวมบรรทัดที่ซ้ำสินค้าเดียวกัน */
  private async priceLines(tenantId: string, lines: CreateMinibarConsumptionLineDto[]) {
    const merged = new Map<string, number>();
    for (const line of lines) {
      merged.set(line.itemId, (merged.get(line.itemId) ?? 0) + line.quantity);
    }

    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: [...merged.keys()] }, tenantId, deletedAt: null },
      select: { id: true, name: true, sellingPrice: true },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));

    return [...merged.entries()].map(([itemId, quantity]) => {
      const item = itemMap.get(itemId);
      if (!item) {
        throw new BadRequestException(`ไม่พบสินค้า (itemId: ${itemId}) ในองค์กรของคุณ`);
      }
      const price = item.sellingPrice === null ? null : Number(item.sellingPrice);
      if (price === null || price <= 0) {
        throw new BadRequestException(
          `"${item.name}" ยังไม่ได้ตั้งราคาขาย จึงคิดค่ามินิบาร์ไม่ได้ — ตั้งราคาที่หน้าสินค้าหน้าร้านก่อน`,
        );
      }
      return { itemId, quantity, unitPrice: price };
    });
  }
}
