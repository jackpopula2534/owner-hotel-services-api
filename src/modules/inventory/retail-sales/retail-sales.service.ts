import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FolioChargeType,
  Prisma,
  RetailPaymentMethod,
  RetailSaleChannel,
  RetailSaleStatus,
  RevenueSourceModule,
  WarehouseType,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { isVisibleOnChannel } from '../warehouses/warehouse-channel';
import { daysOfMonth, shiftDate, toBangkokDate } from '@/common/utils/bangkok-day.util';
import {
  RevenueDocument,
  RevenueFilter,
  RevenueQueryService,
} from '@/modules/revenue/revenue-query.service';
import { settlementOf } from '@/modules/revenue/sources/settlement.util';
import {
  FolioPostingService,
  FOLIO_SOURCE_TYPE,
} from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import {
  RevenuePostingService,
  hasPostableRevenue,
} from '@/modules/revenue/revenue-posting.service';
import { buildRetailSaleRevenueInput } from '@/modules/revenue/sources/retail-sale-revenue.source';
import { CreateRetailSaleDto } from './dto/create-retail-sale.dto';
import { QueryRetailSaleDto } from './dto/query-retail-sale.dto';
import { DashboardRetailSaleDto, RetailDashboardPeriod } from './dto/dashboard-retail-sale.dto';
import { RetailPromotionsService } from '../retail-promotions/retail-promotions.service';
import { RetailPromotionHealthService } from '../retail-promotions/retail-promotion-health.service';
import { RetailPromotionCheckoutService } from '../retail-promotions/retail-promotion-checkout.service';
import { promoError } from '../retail-promotions/promotion-engine';
import { LoyaltyService } from '@/loyalty/loyalty.service';
import { issueGiftLine, issueStockForLine } from './retail-stock-issue';
import { emitRetailSaleCompleted } from './retail-sale-events';

const MONTHS_TH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** Round to 2 decimal places (THB). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * ช่องทางที่เรียกใช้ท่อขายนี้ — ตัดสต๊อก ออกใบเสร็จ ลงโฟลิโอ ลงสมุดรายได้ ใช้ของเดิมทั้งหมด
 * ต่างกันแค่ป้ายบนใบเสร็จกับประเภทค่าใช้จ่ายที่ไปโผล่ในบิลแขก
 *
 * ตั้งใจไม่ให้มาจาก DTO — ฝั่งหน้าจอ POS ประกาศเองไม่ได้ว่า "ใบนี้เป็นมินิบาร์"
 * ไม่งั้นยอดถูกย้ายข้ามช่องทางได้ด้วยการแก้ payload
 */
export interface RetailSaleOrigin {
  channel: RetailSaleChannel;
  /** ประเภทค่าใช้จ่ายที่จะไปขึ้นในโฟลิโอแขก */
  folioChargeType: FolioChargeType;
  /** คำอธิบายบนรายการในโฟลิโอ — แขกต้องอ่านออกว่าโดนคิดค่าอะไร */
  describe: (receiptNo: string, roomNumber?: string | null) => string;
  roomId?: string | null;
}

export const SHOP_ORIGIN: RetailSaleOrigin = {
  channel: RetailSaleChannel.SHOP,
  folioChargeType: FolioChargeType.OTHER,
  describe: (receiptNo) => `ร้านค้า — ใบเสร็จ ${receiptNo}`,
};

@Injectable()
export class RetailSalesService {
  private readonly logger = new Logger(RetailSalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly folioPosting: FolioPostingService,
    private readonly revenuePosting: RevenuePostingService,
    private readonly revenue: RevenueQueryService,
    private readonly promotions: RetailPromotionsService,
    private readonly promotionHealth: RetailPromotionHealthService,
    private readonly promoCheckout: RetailPromotionCheckoutService,
    private readonly loyalty: LoyaltyService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Record a retail (POS) sale.
   *
   * Everything happens inside ONE transaction so the whole cart is atomic:
   *   1. generate the receipt number (DocumentSequence)
   *   2. for each line — deduct WarehouseStock and (for lot-tracked items) the
   *      FEFO InventoryLot remainingQty, writing a GOODS_ISSUE StockMovement
   *      (referenceType RETAIL_SALE) that the stock-balance report reads
   *   3. promotions — one code (optional) + automatic gift promotions under the
   *      stacking rules, re-priced on this transaction's snapshot; gifts issued
   *      from each promotion's gift warehouse (referenceType PROMO_GIFT), quotas
   *      consumed race-safely, one redemption row per promotion
   *   4. create the RetailSale header + snapshotted line items
   *   5. member earns loyalty points on the grand total (after every discount)
   *
   * Money totals are recomputed server-side; the client's numbers are never trusted.
   */
  async create(
    dto: CreateRetailSaleDto,
    userId: string,
    tenantId: string,
    channel: RetailSaleOrigin = SHOP_ORIGIN,
  ) {
    // Validate the store/warehouse belongs to this tenant.
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId },
      include: { group: { select: { channels: true, isActive: true } } },
    });
    if (!warehouse) {
      throw new BadRequestException('ไม่พบคลัง/ร้านค้านี้ หรือไม่ได้อยู่ในองค์กรของคุณ');
    }
    // คลังของแถมกันไว้แจกในโปรโมชั่นเท่านั้น — ขายตรงจากคลังนี้ = ของแถมหมดโดยไม่ผ่านโควตาโปร
    if (warehouse.type === WarehouseType.PROMOTION) {
      throw promoError('GIFT_WAREHOUSE_NOT_SELLABLE', 'คลังของแถมใช้ขายไม่ได้ — เลือกคลังร้านค้า');
    }
    // กลุ่มคลังปิดไม่ให้ POS เห็น (เช่น คลังช่างซ่อม/ครัว) — กันยิง API ขายตรงจากคลังนั้น
    if (!isVisibleOnChannel(warehouse.group, 'POS')) {
      throw new BadRequestException('คลังนี้ไม่ได้เปิดให้ขายผ่าน POS — ตั้งค่าได้ที่กลุ่มคลัง');
    }

    const isRoomCharge = dto.paymentMethod === RetailPaymentMethod.ROOM_CHARGE;
    if (isRoomCharge && !dto.bookingId && !dto.roomNumber?.trim()) {
      throw new BadRequestException('ต้องเลือกห้องพัก (การจอง) สำหรับการชาร์จเข้าห้อง');
    }

    // Load every item up front (tenant-scoped) so we can validate + snapshot fields.
    const itemIds = [...new Set(dto.lines.map((l) => l.itemId))];
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, tenantId, deletedAt: null },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    for (const line of dto.lines) {
      if (!itemMap.has(line.itemId)) {
        throw new BadRequestException(`ไม่พบสินค้า (itemId: ${line.itemId}) ในองค์กรของคุณ`);
      }
    }

    if (dto.promoCode?.trim() && !dto.memberGuestId) {
      throw promoError('PROMO_MEMBER_REQUIRED', 'ต้องเลือกสมาชิกก่อนใช้โค้ดโปรโมชั่น');
    }

    const saleId = randomUUID();
    const vatRate = dto.vatRate ?? 7;
    const billDiscount = dto.billDiscount ?? 0;

    const sale = await this.prisma.$transaction(async (tx) => {
      const receiptNo = await this.generateReceiptNo(tx, tenantId);

      const lineRows: Prisma.RetailSaleItemCreateManySaleInput[] = [];
      let subtotal = 0;
      let itemDiscountTotal = 0;
      let costTotal = 0;

      for (const line of dto.lines) {
        const item = itemMap.get(line.itemId)!;
        const lineDiscount = round2(line.lineDiscount ?? 0);

        // Authoritative balance + average cost for this store/item.
        const stock = await tx.warehouseStock.findFirst({
          where: { warehouseId: dto.warehouseId, itemId: line.itemId },
        });
        if (!stock) {
          throw new BadRequestException(`ไม่มีสต็อกสินค้า "${item.name}" ในคลังนี้`);
        }
        const currentQty = Number(stock.quantity);
        if (currentQty < line.quantity) {
          throw new BadRequestException(
            `สต็อก "${item.name}" ไม่เพียงพอ: คลังมี ${currentQty} ${item.unit} แต่ต้องการ ${line.quantity}`,
          );
        }
        const avgCost = Number(stock.avgCost) || 0;

        // Deduct stock + write GOODS_ISSUE movement(s). Lot-tracked items deduct
        // FEFO across one or more lots; plain items deduct a single movement.
        await issueStockForLine(tx, this.logger, {
          tenantId,
          userId,
          saleId,
          warehouseId: dto.warehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          avgCost,
          needsLot: item.isPerishable || item.requiresLotTracking,
        });

        // Decrement the authoritative WarehouseStock balance.
        const newQty = currentQty - line.quantity;
        await tx.warehouseStock.update({
          where: { id: stock.id },
          data: {
            quantity: newQty,
            totalValue: round2(newQty * avgCost),
            updatedAt: new Date(),
          },
        });

        const gross = line.quantity * line.unitPrice;
        const lineTotal = round2(Math.max(gross - lineDiscount, 0));
        const lineCost = round2(line.quantity * avgCost);

        subtotal += gross;
        itemDiscountTotal += lineDiscount;
        costTotal += lineCost;

        lineRows.push({
          id: randomUUID(),
          itemId: line.itemId,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          quantity: line.quantity,
          unitPrice: round2(line.unitPrice),
          lineDiscount,
          lineTotal,
          unitCost: round2(avgCost),
          lineCost,
        });
      }

      // ── สมาชิก + โปรโมชั่น ── คิดใหม่บน snapshot ของ transaction นี้ ไม่เชื่อตัวเลข preview
      const priced = await this.promoCheckout.priceBill(tx, tenantId, {
        code: dto.promoCode,
        guestId: dto.memberGuestId,
        lines: dto.lines,
        mode: 'sale',
        acceptWithoutGift: dto.acceptWithoutGift ?? false,
      });
      const member = priced.member;
      const giftCostByPromo = new Map<string, number>();
      for (const applied of priced.applied) {
        let giftCost = 0;
        for (const gift of applied.grantedGifts) {
          const row = await issueGiftLine(tx, this.logger, {
            tenantId,
            userId,
            saleId,
            promotionId: applied.promotion.id,
            warehouseId: applied.promotion.giftWarehouseId!,
            gift,
          });
          giftCost += Number(row.lineCost);
          lineRows.push(row);
        }
        giftCostByPromo.set(applied.promotion.id, round2(giftCost));
      }
      const promoGiftCost = round2([...giftCostByPromo.values()].reduce((sum, c) => sum + c, 0));
      const codePromo = priced.applied.find((a) => a.code) ?? null;
      const contactId = member ? await this.promotions.ensureContact(tx, tenantId, member.guestId) : null;

      subtotal = round2(subtotal);
      // ส่วนลดโปรใช้ได้เท่าที่ยังเหลือยอดหลังส่วนลดรายบรรทัด + ส่วนลดท้ายบิล
      // (โปรอัตโนมัติเป็นของแถมล้วน ส่วนลดเงินมีแค่จากโค้ด)
      const promoDiscount = codePromo
        ? round2(Math.min(codePromo.discount, Math.max(subtotal - itemDiscountTotal - billDiscount, 0)))
        : 0;
      const discountTotal = round2(Math.min(subtotal, itemDiscountTotal + billDiscount + promoDiscount));
      const taxable = Math.max(subtotal - discountTotal, 0);
      const vatAmount = round2((taxable * vatRate) / 100);
      const grandTotal = round2(taxable + vatAmount);
      costTotal = round2(costTotal);
      // ต้นทุนของแถมเป็นค่าใช้จ่ายส่งเสริมการขาย — แยกจาก costTotal แต่หักจากกำไรของบิล
      const profitTotal = round2(taxable - costTotal - promoGiftCost);

      // Room charges join this transaction: if the room cannot take the charge,
      // the stock issue rolls back with it rather than leaving a sale nobody bills.
      const posted = isRoomCharge
        ? await this.folioPosting.postChargeWithin(tx, {
            tenantId,
            bookingId: dto.bookingId,
            roomNumber: dto.roomNumber,
            propertyId: warehouse.propertyId,
            chargeType: channel.folioChargeType,
            description: channel.describe(receiptNo, dto.roomNumber),
            netAmount: round2(taxable),
            vatRate,
            vatAmount,
            totalAmount: grandTotal,
            sourceType: FOLIO_SOURCE_TYPE.RETAIL_SALE,
            sourceId: saleId,
            postedBy: userId,
          })
        : null;

      // แต้มสะสม 1 แต้ม/100฿ ของยอดสุทธิหลังหักทุกส่วนลด — เฉพาะบิลที่ผูกสมาชิก (void แล้วหักคืน)
      const pointsEarned = member
        ? await this.loyalty.earnForRetailSaleWithin(tx, {
            tenantId,
            guestId: member.guestId,
            saleId,
            amount: grandTotal,
            contactId,
          })
        : 0;

      const created = await tx.retailSale.create({
        data: {
          id: saleId,
          tenantId,
          receiptNo,
          warehouseId: dto.warehouseId,
          channel: channel.channel,
          paymentMethod: dto.paymentMethod,
          roomId: channel.roomId ?? null,
          roomNumber: dto.roomNumber?.trim() || null,
          guestName: dto.guestName?.trim() || null,
          bookingId: posted?.bookingId ?? dto.bookingId ?? null,
          folioId: posted?.folioId ?? null,
          folioChargeId: posted?.chargeId ?? null,
          subtotal,
          discountTotal,
          vatRate,
          vatAmount,
          grandTotal,
          costTotal,
          profitTotal,
          notes: dto.notes?.trim() || null,
          soldBy: userId,
          memberGuestId: member?.guestId ?? null,
          memberContactId: contactId,
          // โปรหลักของบิล = โปรของโค้ด ไม่มีโค้ดใช้โปรอัตโนมัติตัวแรก (ครบทุกตัวอยู่ใน redemptions)
          promotionId: (codePromo ?? priced.applied[0])?.promotion.id ?? null,
          promoCode: codePromo?.code?.code ?? null,
          promoDiscount,
          promoGiftCost,
          pointsEarned,
          items: { createMany: { data: lineRows } },
        },
        include: { items: true },
      });

      if (priced.applied.length) {
        await this.promoCheckout.recordRedemptionsWithin(tx, {
          tenantId,
          userId,
          saleId,
          member,
          contactId,
          applied: priced.applied.map((a) => ({
            ...a,
            discount: a.code ? promoDiscount : a.discount,
            giftCost: giftCostByPromo.get(a.promotion.id) ?? 0,
          })),
        });
        // บิลนี้แจกของแถมชิ้นสุดท้าย และโปรไม่มีส่วนลด → หยุดโปร (ทรานแซกชันเดียวกับการตัดสต็อก)
        for (const applied of priced.applied) {
          if (applied.grantedGifts.length) {
            await this.promotionHealth.autoPauseIfExhaustedWithin(tx, tenantId, applied.promotion.id);
          }
        }
      }

      // ลงสมุดรายได้กลางในทรานแซกชันเดียวกับการตัดสต็อกและออกใบเสร็จ — ใบเสร็จที่
      // ออกสำเร็จแต่รายได้ไม่ถูกบันทึกคือยอดขายที่หายไปจากทุกรายงานแบบเงียบ ๆ
      // (ใบเสร็จยอดศูนย์ — แจกของ/ตัดสต็อกเปล่า — ข้ามไป ไม่ใช่ขายไม่ได้)
      const revenue = buildRetailSaleRevenueInput(created, {
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        propertyId: warehouse.propertyId,
      });
      if (hasPostableRevenue(revenue)) {
        await this.revenuePosting.postWithin(tx, revenue);
      }

      const appliedPromotions = priced.applied.map((a) => ({
        promotionId: a.promotion.id,
        name: a.promotion.name,
        code: a.code?.code ?? null,
        autoApplied: a.autoApplied,
        discount: a.code ? promoDiscount : a.discount,
        giftCost: giftCostByPromo.get(a.promotion.id) ?? 0,
        giftSkipped: a.giftSkipped,
      }));
      return { ...created, appliedPromotions, skippedAutoPromotions: priced.skipped };
    });

    this.logger.log(`Retail sale ${sale.receiptNo} created (tenant ${tenantId}, total ${sale.grandTotal})`);
    emitRetailSaleCompleted(this.events, sale);
    return {
      ...this.toDetail(sale),
      appliedPromotions: sale.appliedPromotions,
      skippedAutoPromotions: sale.skippedAutoPromotions,
    };
  }

  /** Sales history (ประวัติการขาย) — paginated + filterable, newest first, with range totals. */
  async findAll(tenantId: string, query: QueryRetailSaleDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const where: Prisma.RetailSaleWhereInput = { tenantId };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    // ไม่กรองช่องทางโดยปริยาย — ประวัติที่ตัดยอดมินิบาร์ทิ้งเงียบ ๆ คือยอดที่หายไปจากหน้าจอ
    // ให้ผู้เรียกระบุเองว่าจะดูช่องทางไหน แล้วทุกแถวติดป้ายช่องทางมาให้เห็น
    if (query.channel) where.channel = query.channel;
    if (query.bookingId) where.bookingId = query.bookingId;
    if (query.roomId) where.roomId = query.roomId;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.soldAt = {};
      if (query.from) where.soldAt.gte = new Date(query.from);
      if (query.to) where.soldAt.lte = new Date(query.to);
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [{ receiptNo: { contains: term } }, { guestName: { contains: term } }];
    }

    const [rows, total, agg] = await Promise.all([
      this.prisma.retailSale.findMany({
        where,
        include: { items: true },
        orderBy: { soldAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.retailSale.count({ where }),
      // ใบที่ถูกยกเลิกยังแสดงในตาราง (ติดป้าย) แต่ไม่นับเข้ายอดสรุป — เว้นแต่ผู้ใช้กรองสถานะเอง
      this.prisma.retailSale.aggregate({
        where: query.status ? where : { ...where, status: RetailSaleStatus.COMPLETED },
        _count: { _all: true },
        _sum: { grandTotal: true, profitTotal: true, costTotal: true, promoGiftCost: true },
      }),
    ]);

    return {
      data: rows.map((r) => this.toDetail(r)),
      meta: { page, limit, total },
      // ผลรวมของ "ใบที่ตรงตัวกรองนี้" ไม่ใช่ยอดขายทางบัญชี — ตัวกรองของหน้าประวัติ
      // เลือกได้ถึงใบที่ถูกยกเลิก ตัวเลขรายได้จริงอยู่ที่ getDashboard ซึ่งอ่านจากสมุด
      summary: {
        count: agg._count._all,
        totalSales: Number(agg._sum.grandTotal ?? 0),
        totalCost: Number(agg._sum.costTotal ?? 0),
        totalProfit: Number(agg._sum.profitTotal ?? 0),
        // costTotal = ต้นทุนสินค้าที่ขาย, ของแถมตัดจากคลังของแถมแยกไว้ — กำไร = ยอด − ทั้งสองก้อน
        totalGiftCost: Number(agg._sum.promoGiftCost ?? 0),
      },
    };
  }

  /**
   * ห้องที่หน้าร้านค้าเอาไปทำตัวเลือก "ชาร์จเข้าห้อง"
   *
   * มาจากตัวเดียวกับที่ลงรายการหนี้จริง ร้านค้าจึงเสนอได้เฉพาะห้องที่ระบบยอมรับ
   * (ไม่ระบุ propertyId เพราะร้านค้าปลีกไม่ได้ผูกกับโรงแรมสาขาใดสาขาหนึ่ง)
   */
  async listChargeableRooms(tenantId: string, search?: string) {
    return this.folioPosting.listChargeableRooms({ tenantId, search });
  }

  /** Single receipt detail. */
  async findOne(id: string, tenantId: string) {
    const sale = await this.prisma.retailSale.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!sale) {
      throw new NotFoundException('ไม่พบรายการขายนี้');
    }
    return this.toDetail(sale);
  }

  /**
   * Sales dashboard summary (สรุปยอดขาย) for a week / month / year window.
   *
   * **ยอดขายมาจากสมุดรายได้** ไม่ได้บวก `grandTotal` เองอีกแล้ว หน้านี้เคยนับเฉพาะ
   * ใบ `COMPLETED` ตามเวลาเครื่อง ส่วนรายงานรายได้นับตามวันธุรกิจไทยและหักใบที่ถูก
   * กลับรายการข้ามวันให้ด้วย ตัวเลขสองหน้าจึงไม่เคยตรงกัน
   *
   * **ต้นทุนกับกำไรยังมาจากใบเสร็จ** เพราะสมุดรายได้เก็บแต่ฝั่งรายได้ ไม่มีต้นทุน
   * (ฝั่งต้นทุนเป็นงานของ Phase 4) จึงต่อ `sourceId` กลับไปอ่านใบที่สมุดชี้มา
   * — ชุดใบเดียวกับที่ทำยอดขาย เปอร์เซ็นต์กำไรจึงหารด้วยตัวหารเดียวกันเสมอ
   */
  async getDashboard(tenantId: string, query: DashboardRetailSaleDto) {
    const period: RetailDashboardPeriod = query.period ?? 'week';
    const anchor = toBangkokDate(query.date ? new Date(query.date) : new Date());
    const range = this.resolveRange(period, anchor);

    const filter: RevenueFilter = {
      tenantId,
      sourceModule: RevenueSourceModule.RETAIL,
      ...(query.warehouseId ? { outletId: query.warehouseId } : {}),
      ...range,
    };

    const [totals, documents] = await Promise.all([
      this.revenue.totals(filter),
      this.revenue.documents(filter),
    ]);

    // ใบเดียวโผล่ได้หลายแถวถ้าถูกกลับรายการคนละวัน — นับใบจาก sourceId ที่ไม่ซ้ำ
    const saleIds = [...new Set(documents.map((doc) => doc.sourceId))];
    const sales = saleIds.length
      ? await this.prisma.retailSale.findMany({
          where: { id: { in: saleIds }, tenantId },
          include: { items: true },
        })
      : [];

    const buckets = this.makeBuckets(period, range);
    const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
    const paymentMap = new Map<string, { count: number; total: number }>();
    const itemMap = new Map<
      string,
      { itemId: string; name: string; sku: string; quantity: number; sales: number }
    >();

    // ยอดขายลงถังตามวันที่สมุดรับรู้ ใบที่กลับรายการวันหลังจึงหักออกจากถังของวันนั้น
    for (const doc of documents) {
      const bucket = bucketByKey.get(this.bucketKeyOf(period, doc.businessDate));
      if (bucket) bucket.sales += doc.total;
    }

    // วันที่รับรู้ของใบหนึ่ง = วันแรกที่มันโผล่ในสมุด — ต้นทุน/กำไรของใบเกาะวันนั้น
    // ทั้งก้อน (สมุดไม่ได้เก็บต้นทุน จึงเฉลี่ยตามแถวไม่ได้)
    const recognizedOn = new Map<string, string>();
    for (const doc of documents) {
      const current = recognizedOn.get(doc.sourceId);
      if (!current || doc.businessDate < current) recognizedOn.set(doc.sourceId, doc.businessDate);
    }

    let totalProfit = 0;
    let totalCost = 0;
    let itemsSold = 0;

    for (const sale of sales) {
      const profit = Number(sale.profitTotal);
      totalProfit += profit;
      totalCost += Number(sale.costTotal);

      // ช่องทางรับเงินใช้คำเดียวกับสมุด (QR ของร้านค้า = TRANSFER) ไม่งั้นรายงาน
      // กระทบยอดเงินสดจะนับ QR ของโมดูลนี้เป็นเงินสดแต่ไม่นับของโมดูลอื่น
      const method = settlementOf(sale.paymentMethod);
      const pm = paymentMap.get(method) ?? { count: 0, total: 0 };
      pm.count += 1;
      pm.total += this.ledgerTotalOf(documents, sale.id);
      paymentMap.set(method, pm);

      const day = recognizedOn.get(sale.id);
      const bucket = day ? bucketByKey.get(this.bucketKeyOf(period, day)) : undefined;
      if (bucket) {
        bucket.profit += profit;
        bucket.count += 1;
      }

      for (const it of sale.items) {
        if (it.isGift) continue; // ของแถมไม่ใช่ยอดขาย
        itemsSold += it.quantity;
        const cur =
          itemMap.get(it.itemId) ??
          { itemId: it.itemId, name: it.name, sku: it.sku, quantity: 0, sales: 0 };
        cur.quantity += it.quantity;
        cur.sales += Number(it.lineTotal);
        itemMap.set(it.itemId, cur);
      }
    }

    const totalSales = totals.total;
    const salesCount = saleIds.length;
    const topItems = [...itemMap.values()]
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5)
      .map((t) => ({ ...t, sales: round2(t.sales) }));

    return {
      period,
      range: { from: range.from, to: range.to },
      kpis: {
        totalSales: round2(totalSales),
        /** gross − ส่วนลด (ไม่รวม VAT) — ตัวเดียวที่เรียกว่ารายได้ทางบัญชีได้ */
        netSales: round2(totals.net),
        totalProfit: round2(totalProfit),
        totalCost: round2(totalCost),
        salesCount,
        itemsSold,
        avgSale: salesCount ? round2(totalSales / salesCount) : 0,
        marginPct: totalSales ? round2((totalProfit / totalSales) * 100) : 0,
      },
      series: buckets.map((b) => ({
        key: b.key,
        label: b.label,
        sales: round2(b.sales),
        profit: round2(b.profit),
        count: b.count,
      })),
      paymentBreakdown: [...paymentMap.entries()].map(([method, v]) => ({
        method,
        count: v.count,
        total: round2(v.total),
      })),
      topItems,
    };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /** ยอดที่สมุดรับรู้ให้ใบนี้ตลอดช่วง (รวมแถวกลับรายการที่ติดลบ) */
  private ledgerTotalOf(documents: RevenueDocument[], sourceId: string): number {
    return documents
      .filter((doc) => doc.sourceId === sourceId)
      .reduce((sum, doc) => sum + doc.total, 0);
  }

  /** ถังที่วันธุรกิจหนึ่งตกลงไป — รายเดือนสำหรับช่วงปี รายวันสำหรับที่เหลือ */
  private bucketKeyOf(period: RetailDashboardPeriod, businessDate: string): string {
    return period === 'year' ? businessDate.slice(0, 7) : businessDate;
  }

  /**
   * ช่วงของแดชบอร์ดเป็นวันธุรกิจไทยแบบรวมปลายทั้งสองข้าง
   *
   * คิดเลขบนสตริง 'YYYY-MM-DD' ล้วน ๆ ไม่ผ่านนาฬิกาของเครื่อง — เซิร์ฟเวอร์ที่ตั้ง
   * เขตเวลาอื่นเคยทำให้ขอบสัปดาห์/เดือนเลื่อนไปหนึ่งวันแบบเงียบ ๆ
   */
  private resolveRange(
    period: RetailDashboardPeriod,
    anchor: string,
  ): { from: string; to: string } {
    if (period === 'week') {
      // สัปดาห์เริ่มวันจันทร์
      const dow = new Date(`${anchor}T00:00:00.000Z`).getUTCDay();
      const from = shiftDate(anchor, -((dow + 6) % 7));
      return { from, to: shiftDate(from, 6) };
    }
    if (period === 'year') {
      const year = anchor.slice(0, 4);
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    const days = daysOfMonth(anchor.slice(0, 7));
    return { from: days[0], to: days[days.length - 1] };
  }

  /** Build the ordered, zero-filled series buckets for a period window. */
  private makeBuckets(
    period: RetailDashboardPeriod,
    range: { from: string; to: string },
  ): Array<{ key: string; label: string; sales: number; profit: number; count: number }> {
    const buckets: Array<{ key: string; label: string; sales: number; profit: number; count: number }> = [];
    if (period === 'year') {
      const year = range.from.slice(0, 4);
      for (let m = 0; m < 12; m++) {
        buckets.push({
          key: `${year}-${String(m + 1).padStart(2, '0')}`,
          label: MONTHS_TH_SHORT[m],
          sales: 0,
          profit: 0,
          count: 0,
        });
      }
      return buckets;
    }
    for (let day = range.from; day <= range.to; day = shiftDate(day, 1)) {
      buckets.push({ key: day, label: String(Number(day.slice(8, 10))), sales: 0, profit: 0, count: 0 });
    }
    return buckets;
  }

  /** Generate a per-tenant, per-month receipt number, e.g. RCP-202606-0001. */
  private async generateReceiptNo(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await tx.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'RETAIL_SALE', yearMonth } },
      create: { tenantId, docType: 'RETAIL_SALE', prefix: 'RCP', yearMonth, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return `RCP-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }

  /** Map a Prisma RetailSale (+items) to a number-normalized API shape. */
  private toDetail(sale: {
    id: string;
    receiptNo: string;
    warehouseId: string;
    status: string;
    channel?: string;
    paymentMethod: string;
    roomId?: string | null;
    roomNumber: string | null;
    guestName: string | null;
    bookingId: string | null;
    folioId: string | null;
    folioChargeId: string | null;
    subtotal: Prisma.Decimal;
    discountTotal: Prisma.Decimal;
    vatRate: Prisma.Decimal;
    vatAmount: Prisma.Decimal;
    grandTotal: Prisma.Decimal;
    costTotal: Prisma.Decimal;
    profitTotal: Prisma.Decimal;
    memberGuestId?: string | null;
    memberContactId?: string | null;
    promotionId?: string | null;
    promoCode?: string | null;
    promoDiscount?: Prisma.Decimal;
    promoGiftCost?: Prisma.Decimal;
    pointsEarned?: number;
    voidedBy?: string | null;
    voidedAt?: Date | null;
    voidReason?: string | null;
    notes: string | null;
    soldBy: string;
    soldAt: Date;
    createdAt: Date;
    items: Array<{
      id: string;
      itemId: string;
      sku: string;
      name: string;
      unit: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      lineDiscount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      lineCost: Prisma.Decimal;
      isGift?: boolean;
      promotionId?: string | null;
      sourceWarehouseId?: string | null;
    }>;
  }) {
    return {
      id: sale.id,
      receiptNo: sale.receiptNo,
      warehouseId: sale.warehouseId,
      status: sale.status,
      channel: sale.channel ?? RetailSaleChannel.SHOP,
      roomId: sale.roomId ?? null,
      paymentMethod: sale.paymentMethod,
      roomNumber: sale.roomNumber,
      guestName: sale.guestName,
      bookingId: sale.bookingId,
      folioId: sale.folioId,
      folioChargeId: sale.folioChargeId,
      subtotal: Number(sale.subtotal),
      discountTotal: Number(sale.discountTotal),
      vatRate: Number(sale.vatRate),
      vatAmount: Number(sale.vatAmount),
      grandTotal: Number(sale.grandTotal),
      costTotal: Number(sale.costTotal),
      profitTotal: Number(sale.profitTotal),
      memberGuestId: sale.memberGuestId ?? null,
      memberContactId: sale.memberContactId ?? null,
      promotionId: sale.promotionId ?? null,
      promoCode: sale.promoCode ?? null,
      promoDiscount: Number(sale.promoDiscount ?? 0),
      promoGiftCost: Number(sale.promoGiftCost ?? 0),
      pointsEarned: sale.pointsEarned ?? 0,
      voidedBy: sale.voidedBy ?? null,
      voidedAt: sale.voidedAt ?? null,
      voidReason: sale.voidReason ?? null,
      notes: sale.notes,
      soldBy: sale.soldBy,
      soldAt: sale.soldAt,
      createdAt: sale.createdAt,
      items: sale.items.map((it) => ({
        id: it.id,
        itemId: it.itemId,
        sku: it.sku,
        name: it.name,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        lineDiscount: Number(it.lineDiscount),
        lineTotal: Number(it.lineTotal),
        unitCost: Number(it.unitCost),
        lineCost: Number(it.lineCost),
        isGift: it.isGift ?? false,
        promotionId: it.promotionId ?? null,
        sourceWarehouseId: it.sourceWarehouseId ?? null,
      })),
    };
  }
}
