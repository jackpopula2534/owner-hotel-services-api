import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FolioChargeType,
  RetailSaleChannel,
  RevenueSourceModule,
  RevenueSourceType,
  RevenueType,
  SettlementType,
} from '@prisma/client';
import { RetailSalesService } from '../retail-sales.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';
import {
  buildRevenuePostingStub,
  postedRevenueInput,
  type RevenuePostingStub,
} from '@/modules/revenue/__tests__/revenue-posting.stub';
import {
  buildRevenueQueryStub,
  ledgerFiltersOf,
  type LedgerRow,
  type RevenueQueryStub,
} from '@/modules/revenue/__tests__/revenue-query.stub';

const TENANT = 'tenant-1';
const USER = 'user-1';
const WH = 'wh-1';

/**
 * Build a fresh mock Prisma. `$transaction` runs the callback against the same
 * mock object so all tx.* calls are observable on the returned mock.
 */
function buildPrisma() {
  const mock: any = {
    warehouse: { findFirst: jest.fn() },
    inventoryItem: { findMany: jest.fn() },
    warehouseStock: { findFirst: jest.fn(), update: jest.fn() },
    inventoryLot: { findMany: jest.fn(), update: jest.fn() },
    stockMovement: { create: jest.fn() },
    documentSequence: { upsert: jest.fn() },
    retailSale: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
  };
  mock.$transaction = jest.fn((cb: any) => cb(mock));
  // Default happy stubs
  mock.warehouse.findFirst.mockResolvedValue({ id: WH, tenantId: TENANT });
  mock.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
  mock.warehouseStock.update.mockResolvedValue({});
  mock.stockMovement.create.mockResolvedValue({});
  mock.inventoryLot.update.mockResolvedValue({});
  // Echo the created sale back so toDetail can map it.
  mock.retailSale.create.mockImplementation(({ data }: any) => ({
    ...data,
    status: 'COMPLETED',
    createdAt: new Date(),
    soldAt: new Date(),
    items: data.items.createMany.data,
  }));
  return mock;
}

/**
 * Stand-in for the folio poster. Only `postChargeWithin` is used by `create`,
 * and it is guarded against the real signature below so a rename in the service
 * cannot leave this suite passing against a method that no longer exists.
 */
function buildFolioPosting() {
  const real = FolioPostingService.prototype as unknown as Record<string, unknown>;
  expect(typeof real.postChargeWithin).toBe('function');
  return {
    postChargeWithin: jest.fn().mockResolvedValue({
      folioId: 'folio-1',
      chargeId: 'charge-1',
      bookingId: 'booking-1',
      guestId: 'guest-1',
      propertyId: 'prop-1',
      alreadyPosted: false,
    }),
  };
}

async function makeService(
  prisma: any,
  folioPosting: any = buildFolioPosting(),
  revenuePosting: RevenuePostingStub = buildRevenuePostingStub(),
  revenueQuery: RevenueQueryStub = buildRevenueQueryStub(),
): Promise<RetailSalesService> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      RetailSalesService,
      { provide: PrismaService, useValue: prisma },
      { provide: FolioPostingService, useValue: folioPosting },
      { provide: RevenuePostingService, useValue: revenuePosting },
      { provide: RevenueQueryService, useValue: revenueQuery },
    ],
  }).compile();
  return moduleRef.get(RetailSalesService);
}

/** Same service, with a handle on the revenue book the dashboard reads from. */
async function makeServiceReadingLedger(prisma: any, rows: LedgerRow[] = []) {
  const revenueQuery = buildRevenueQueryStub(rows);
  const service = await makeService(prisma, buildFolioPosting(), buildRevenuePostingStub(), revenueQuery);
  return { service, revenueQuery };
}

/** หนึ่งบรรทัดขายของร้านค้าในสมุด (ร้านค้ามีบรรทัดเดียวต่อใบเสมอ) */
const retailRow = (
  businessDate: string,
  sourceId: string,
  amount: number,
  extra: Partial<LedgerRow> = {},
): LedgerRow => ({
  businessDate,
  sourceId,
  amount,
  sourceType: RevenueSourceType.RETAIL_SALE,
  sourceModule: RevenueSourceModule.RETAIL,
  revenueType: RevenueType.RETAIL_GOODS,
  settlement: SettlementType.CASH,
  outletId: WH,
  ...extra,
});

/** Same service, with a handle on the revenue book it writes to. */
async function makeServiceWithRevenue(prisma: any, folioPosting: any = buildFolioPosting()) {
  const revenuePosting = buildRevenuePostingStub();
  const service = await makeService(prisma, folioPosting, revenuePosting);
  return { service, revenuePosting };
}

describe('RetailSalesService', () => {
  describe('create', () => {
    it('deducts WarehouseStock, writes GOODS_ISSUE/RETAIL_SALE movement, computes totals', async () => {
      const prisma = buildPrisma();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
        { id: 'i2', tenantId: TENANT, sku: 'B', name: 'Water', unit: 'BOTTLE', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst
        .mockResolvedValueOnce({ id: 's1', quantity: 10, avgCost: 60 })
        .mockResolvedValueOnce({ id: 's2', quantity: 5, avgCost: 30 });

      const service = await makeService(prisma);
      const result = await service.create(
        {
          warehouseId: WH,
          paymentMethod: 'CASH' as any,
          lines: [
            { itemId: 'i1', quantity: 2, unitPrice: 100 },
            { itemId: 'i2', quantity: 1, unitPrice: 50 },
          ],
        },
        USER,
        TENANT,
      );

      // Receipt number
      expect(result.receiptNo).toBe('RCP-' + `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}` + '-0001');
      // Totals: subtotal 250, vat 7% = 17.5, grand 267.5
      expect(result.subtotal).toBe(250);
      expect(result.vatAmount).toBe(17.5);
      expect(result.grandTotal).toBe(267.5);
      // COGS: 2*60 + 1*30 = 150, profit = 250 - 150 = 100
      expect(result.costTotal).toBe(150);
      expect(result.profitTotal).toBe(100);
      // Two GOODS_ISSUE movements created with RETAIL_SALE reference
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
      const mv = prisma.stockMovement.create.mock.calls[0][0].data;
      expect(mv.type).toBe('GOODS_ISSUE');
      expect(mv.referenceType).toBe('RETAIL_SALE');
      expect(mv.quantity).toBe(2);
      // Stock decremented (10 - 2 = 8)
      expect(prisma.warehouseStock.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ quantity: 8 }) }),
      );
      expect(result.items).toHaveLength(2);
    });

    it('consumes FEFO lots for a lot-tracked item (earliest expiry first)', async () => {
      const prisma = buildPrisma();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'M', name: 'Milk', unit: 'BOTTLE', isPerishable: true, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 10, avgCost: 20 });
      prisma.inventoryLot.findMany.mockResolvedValue([
        { id: 'lotA', remainingQty: 2, unitCost: 18, status: 'ACTIVE' },
        { id: 'lotB', remainingQty: 5, unitCost: 22, status: 'ACTIVE' },
      ]);

      const service = await makeService(prisma);
      await service.create(
        { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 3, unitPrice: 40 }] },
        USER,
        TENANT,
      );

      // lotA fully consumed (2) -> EXHAUSTED; lotB partially (1)
      expect(prisma.inventoryLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lotA' }, data: expect.objectContaining({ remainingQty: 0, status: 'EXHAUSTED' }) }),
      );
      expect(prisma.inventoryLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lotB' }, data: expect.objectContaining({ remainingQty: 4 }) }),
      );
      // One movement per consumed lot
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
    });

    it('throws when warehouse stock is insufficient', async () => {
      const prisma = buildPrisma();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 1, avgCost: 60 });

      const service = await makeService(prisma);
      await expect(
        service.create(
          { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 5, unitPrice: 100 }] },
          USER,
          TENANT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when ROOM_CHARGE names neither a booking nor a room', async () => {
      const prisma = buildPrisma();
      const service = await makeService(prisma);
      await expect(
        service.create(
          { warehouseId: WH, paymentMethod: 'ROOM_CHARGE' as any, lines: [{ itemId: 'i1', quantity: 1, unitPrice: 100 }] },
          USER,
          TENANT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // The bug this whole path exists to fix: the shop used to accept a room
    // charge, write a room number as free text, and post nothing to the folio —
    // the guest was never billed at checkout and the money left the books.
    it('posts a ROOM_CHARGE sale to the guest folio and stores the back-references', async () => {
      const prisma = buildPrisma();
      const folioPosting = buildFolioPosting();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 10, avgCost: 60 });

      const service = await makeService(prisma, folioPosting);
      const result = await service.create(
        {
          warehouseId: WH,
          paymentMethod: 'ROOM_CHARGE' as any,
          roomNumber: '101',
          lines: [{ itemId: 'i1', quantity: 2, unitPrice: 100 }],
        },
        USER,
        TENANT,
      );

      expect(folioPosting.postChargeWithin).toHaveBeenCalledTimes(1);
      const charge = folioPosting.postChargeWithin.mock.calls[0][1];
      expect(charge).toEqual(
        expect.objectContaining({
          tenantId: TENANT,
          roomNumber: '101',
          sourceType: 'RETAIL_SALE',
          // Grand total, VAT included — the folio bills the guest what the
          // receipt says, not the pre-tax figure.
          totalAmount: 214,
          netAmount: 200,
          postedBy: USER,
        }),
      );
      // The sale keeps the ids so a later void can find the charge to reverse.
      expect(result.bookingId).toBe('booking-1');
      expect(result.folioId).toBe('folio-1');
      expect(result.folioChargeId).toBe('charge-1');
    });

    // Posting happens inside the same $transaction as the stock issue, so a room
    // that cannot take the charge must take the whole sale down with it.
    it('rolls the sale back when the folio refuses the charge', async () => {
      const prisma = buildPrisma();
      const folioPosting = buildFolioPosting();
      folioPosting.postChargeWithin.mockRejectedValue(
        new BadRequestException('ไม่พบการจองที่เช็คอินอยู่สำหรับห้อง 999'),
      );
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 10, avgCost: 60 });

      const service = await makeService(prisma, folioPosting);
      await expect(
        service.create(
          {
            warehouseId: WH,
            paymentMethod: 'ROOM_CHARGE' as any,
            roomNumber: '999',
            lines: [{ itemId: 'i1', quantity: 2, unitPrice: 100 }],
          },
          USER,
          TENANT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.retailSale.create).not.toHaveBeenCalled();
    });

    it('does not touch the folio for a cash sale', async () => {
      const prisma = buildPrisma();
      const folioPosting = buildFolioPosting();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 10, avgCost: 60 });

      const service = await makeService(prisma, folioPosting);
      await service.create(
        { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 1, unitPrice: 100 }] },
        USER,
        TENANT,
      );

      expect(folioPosting.postChargeWithin).not.toHaveBeenCalled();
    });

    it('throws when warehouse does not belong to tenant', async () => {
      const prisma = buildPrisma();
      prisma.warehouse.findFirst.mockResolvedValue(null);
      const service = await makeService(prisma);
      await expect(
        service.create(
          { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 1, unitPrice: 100 }] },
          USER,
          TENANT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /**
   * สมุดรายได้กลาง — ใบเสร็จที่ออกแล้วต้องมีแถวรายได้เสมอ
   *
   * ตัวเลขจริงพิสูจน์กับฐานข้อมูลจริงใน `scripts/verify-revenue-ledger.ts` ตรงนี้
   * ตรึงว่า "ใบไหน ยอดเท่าไร ช่องทางอะไร" ถูกส่งให้สมุด และส่งใน tx เดียวกับที่ตัดสต็อก
   */
  describe('ช่องทางการขาย', () => {
    /** ผู้เรียกเดิมทุกคนต้องได้ SHOP โดยไม่ต้องแก้อะไร */
    it('ไม่ระบุช่องทาง → ใบเสร็จเป็นของหน้าร้าน และค่าใช้จ่ายในโฟลิโอเป็น OTHER', async () => {
      const prisma = buildPrisma();
      const folioPosting = buildFolioPosting();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 10, avgCost: 60 });

      const service = await makeService(prisma, folioPosting);
      const result = await service.create(
        {
          warehouseId: WH,
          paymentMethod: 'ROOM_CHARGE' as any,
          roomNumber: '101',
          lines: [{ itemId: 'i1', quantity: 1, unitPrice: 100 }],
        },
        USER,
        TENANT,
      );

      expect(prisma.retailSale.create.mock.calls[0][0].data.channel).toBe(RetailSaleChannel.SHOP);
      expect(prisma.retailSale.create.mock.calls[0][0].data.roomId).toBeNull();
      const charge = folioPosting.postChargeWithin.mock.calls[0][1];
      expect(charge.chargeType).toBe('OTHER');
      expect(charge.description).toContain('ร้านค้า');
      expect(result.channel).toBe(RetailSaleChannel.SHOP);
    });

    it('ส่งช่องทางมินิบาร์มา → ติดป้ายช่องทาง ผูกห้อง และขึ้นเป็นค่ามินิบาร์ในโฟลิโอ', async () => {
      const prisma = buildPrisma();
      const folioPosting = buildFolioPosting();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 10, avgCost: 60 });

      const service = await makeService(prisma, folioPosting);
      const result = await service.create(
        {
          warehouseId: WH,
          paymentMethod: 'ROOM_CHARGE' as any,
          roomNumber: '301',
          lines: [{ itemId: 'i1', quantity: 1, unitPrice: 100 }],
        },
        USER,
        TENANT,
        {
          channel: RetailSaleChannel.MINIBAR,
          folioChargeType: FolioChargeType.MINIBAR,
          describe: (receiptNo, roomNumber) => `มินิบาร์ ห้อง ${roomNumber} — ใบเสร็จ ${receiptNo}`,
          roomId: 'room-9',
        },
      );

      const created = prisma.retailSale.create.mock.calls[0][0].data;
      expect(created.channel).toBe(RetailSaleChannel.MINIBAR);
      expect(created.roomId).toBe('room-9');
      const charge = folioPosting.postChargeWithin.mock.calls[0][1];
      expect(charge.chargeType).toBe('MINIBAR');
      // เลขใบเสร็จมีเดือนปีอยู่ในตัว จึงเทียบแค่ส่วนที่คงที่ ไม่งั้นเทสต์พังเองเมื่อขึ้นเดือนใหม่
      expect(charge.description).toMatch(/^มินิบาร์ ห้อง 301 — ใบเสร็จ RCP-/);
      expect(result.channel).toBe(RetailSaleChannel.MINIBAR);
      expect(result.roomId).toBe('room-9');
    });
  });

  describe('revenue ledger', () => {
    const oneItem = (prisma: any) => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 10, avgCost: 60 });
    };

    it('posts one RETAIL_GOODS line inside the same transaction as the stock issue', async () => {
      const prisma = buildPrisma();
      prisma.warehouse.findFirst.mockResolvedValue({
        id: WH,
        tenantId: TENANT,
        name: 'มินิมาร์ทล็อบบี้',
        propertyId: 'prop-1',
      });
      oneItem(prisma);

      const { service, revenuePosting } = await makeServiceWithRevenue(prisma);
      const sale = await service.create(
        { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 2, unitPrice: 100 }] },
        USER,
        TENANT,
      );

      expect(revenuePosting.postWithin).toHaveBeenCalledTimes(1);
      // อาร์กิวเมนต์แรกคือ tx ที่ $transaction ส่งเข้ามา ไม่ใช่ client คนละตัว
      expect(revenuePosting.postWithin.mock.calls[0][0]).toBe(prisma);
      expect(postedRevenueInput(revenuePosting)).toMatchObject({
        tenantId: TENANT,
        sourceModule: 'RETAIL',
        sourceType: 'RETAIL_SALE',
        documentNo: sale.receiptNo,
        outletId: WH,
        outletName: 'มินิมาร์ทล็อบบี้',
        propertyId: 'prop-1',
        settlement: 'CASH',
        // subtotal 200, VAT 7% = 14 → รวม 214 เท่ากับ grandTotal
        lines: [{ revenueType: 'RETAIL_GOODS', grossAmount: 200, discount: 0, taxAmount: 14 }],
      });
    });

    it('records a room-charge sale as ROOM_CHARGE with the folio charge it created', async () => {
      const prisma = buildPrisma();
      oneItem(prisma);

      const { service, revenuePosting } = await makeServiceWithRevenue(prisma);
      await service.create(
        {
          warehouseId: WH,
          paymentMethod: 'ROOM_CHARGE' as any,
          roomNumber: '301',
          lines: [{ itemId: 'i1', quantity: 1, unitPrice: 100 }],
        },
        USER,
        TENANT,
      );

      expect(postedRevenueInput(revenuePosting)).toMatchObject({
        settlement: 'ROOM_CHARGE',
        folioChargeId: 'charge-1',
      });
    });

    it('skips a zero-total giveaway instead of writing an empty entry', async () => {
      const prisma = buildPrisma();
      oneItem(prisma);

      const { service, revenuePosting } = await makeServiceWithRevenue(prisma);
      await service.create(
        { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 1, unitPrice: 0 }] },
        USER,
        TENANT,
      );

      // ใบเสร็จยังออก สต็อกยังตัด — แค่ไม่มีรายได้ให้ลง
      expect(prisma.retailSale.create).toHaveBeenCalledTimes(1);
      expect(revenuePosting.postWithin).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns paginated rows with range summary', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([
        {
          id: 'r1', receiptNo: 'RCP-202606-0001', warehouseId: WH, status: 'COMPLETED', paymentMethod: 'CASH',
          roomNumber: null, guestName: null, bookingId: null, subtotal: 250, discountTotal: 0, vatRate: 7,
          vatAmount: 17.5, grandTotal: 267.5, costTotal: 150, profitTotal: 100, notes: null, soldBy: USER,
          soldAt: new Date(), createdAt: new Date(), items: [],
        },
      ]);
      prisma.retailSale.count.mockResolvedValue(1);
      prisma.retailSale.aggregate.mockResolvedValue({ _sum: { grandTotal: 267.5, profitTotal: 100, costTotal: 150 } });

      const service = await makeService(prisma);
      const res = await service.findAll(TENANT, { page: 1, limit: 20 });
      expect(res.meta.total).toBe(1);
      expect(res.data).toHaveLength(1);
      expect(res.summary.totalSales).toBe(267.5);
      expect(res.summary.totalProfit).toBe(100);
    });
  });

  describe('findAll — ตัวกรองช่องทาง', () => {
    /**
     * ยอดมินิบาร์เป็นยอดขายจริงของกิจการ ถ้าประวัติร้านค้ากรอง SHOP ทิ้งไว้เป็นค่าตั้งต้น
     * ผลรวมบนหน้าจอจะน้อยกว่าสมุดรายได้โดยไม่มีใครเห็น — ซ้ำรอยบั๊กเดิมที่เคยเจอ
     */
    it('ไม่ระบุช่องทาง → ไม่กรองช่องทางเลย เห็นทั้งหน้าร้านและมินิบาร์', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([]);
      prisma.retailSale.count.mockResolvedValue(0);
      prisma.retailSale.aggregate.mockResolvedValue({ _sum: {} });

      const service = await makeService(prisma);
      await service.findAll(TENANT, {});

      expect(prisma.retailSale.findMany.mock.calls[0][0].where.channel).toBeUndefined();
    });

    it('ระบุช่องทาง/ห้อง/การจอง → ส่งต่อเป็นเงื่อนไขค้นหา', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([]);
      prisma.retailSale.count.mockResolvedValue(0);
      prisma.retailSale.aggregate.mockResolvedValue({ _sum: {} });

      const service = await makeService(prisma);
      await service.findAll(TENANT, {
        channel: RetailSaleChannel.MINIBAR,
        roomId: 'room-9',
        bookingId: 'booking-1',
      });

      const where = prisma.retailSale.findMany.mock.calls[0][0].where;
      expect(where.channel).toBe(RetailSaleChannel.MINIBAR);
      expect(where.roomId).toBe('room-9');
      expect(where.bookingId).toBe('booking-1');
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findFirst.mockResolvedValue(null);
      const service = await makeService(prisma);
      await expect(service.findOne('nope', TENANT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /**
   * แดชบอร์ดยอดขาย — ตัวเงินมาจากสมุดรายได้ ส่วนต้นทุน/กำไร/จำนวนชิ้นมาจากใบเสร็จ
   * ที่สมุดชี้มา (สมุดไม่เก็บต้นทุน) เทสต์ชุดนี้กันไม่ให้ใครกลับไปบวก `grandTotal` เอง
   */
  describe('getDashboard', () => {
    const anchor = '2026-06-24T10:00:00.000Z'; // พุธ — สัปดาห์ 22–28 มิ.ย.

    /** ใบเสร็จสองใบในสัปดาห์เดียวกัน คนละวัน คนละช่องทางจ่าย */
    const twoSales = (prisma: any) =>
      prisma.retailSale.findMany.mockResolvedValue([
        {
          id: 'r1', receiptNo: 'RCP-202606-0001', warehouseId: WH, status: 'COMPLETED', paymentMethod: 'CASH',
          grandTotal: 267.5, profitTotal: 100, costTotal: 150,
          soldAt: new Date('2026-06-22T09:00:00.000Z'),
          items: [{ itemId: 'i1', sku: 'A', name: 'Cola', unit: 'CAN', quantity: 2, lineTotal: 200 }],
        },
        {
          id: 'r2', receiptNo: 'RCP-202606-0002', warehouseId: WH, status: 'COMPLETED', paymentMethod: 'QR',
          grandTotal: 53.5, profitTotal: 20, costTotal: 30,
          soldAt: new Date('2026-06-24T11:00:00.000Z'),
          items: [{ itemId: 'i1', sku: 'A', name: 'Cola', unit: 'CAN', quantity: 1, lineTotal: 50 }],
        },
      ]);

    const weekRows: LedgerRow[] = [
      retailRow('2026-06-22', 'r1', 250, { tax: 17.5 }),
      retailRow('2026-06-24', 'r2', 50, { tax: 3.5, settlement: SettlementType.TRANSFER }),
    ];

    it('aggregates KPIs, payment breakdown, top items and a zero-filled daily series for a week', async () => {
      const prisma = buildPrisma();
      twoSales(prisma);

      const { service } = await makeServiceReadingLedger(prisma, weekRows);
      const res = await service.getDashboard(TENANT, { period: 'week', date: anchor });

      expect(res.period).toBe('week');
      expect(res.kpis.totalSales).toBe(321);
      // รายได้ทางบัญชีไม่รวม VAT ที่ต้องนำส่ง
      expect(res.kpis.netSales).toBe(300);
      expect(res.kpis.totalProfit).toBe(120);
      expect(res.kpis.salesCount).toBe(2);
      expect(res.kpis.itemsSold).toBe(3);
      expect(res.kpis.avgSale).toBe(160.5);
      // Week (Mon–Sun) => 7 daily buckets
      expect(res.series).toHaveLength(7);
      expect(res.series[0].key).toBe('2026-06-22');
      expect(res.series[6].key).toBe('2026-06-28');
      const seriesTotal = res.series.reduce((sum, b) => sum + b.sales, 0);
      expect(seriesTotal).toBe(res.kpis.totalSales);
      // ช่องทางรับเงินใช้คำของสมุด: QR ของร้านค้าคือการโอน ไม่ใช่เงินสด
      expect(res.paymentBreakdown).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'CASH', count: 1, total: 267.5 }),
          expect.objectContaining({ method: 'TRANSFER', count: 1, total: 53.5 }),
        ]),
      );
      expect(res.paymentBreakdown.reduce((sum, p) => sum + p.total, 0)).toBe(res.kpis.totalSales);
      // Top item aggregates across sales
      expect(res.topItems[0]).toEqual(
        expect.objectContaining({ itemId: 'i1', quantity: 3, sales: 250 }),
      );
    });

    it('ยอดขายมาจากสมุด ไม่ใช่ grandTotal บนใบเสร็จ', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([
        {
          id: 'r1', receiptNo: 'RCP-202606-0001', warehouseId: WH, status: 'COMPLETED', paymentMethod: 'CASH',
          grandTotal: 999_999, profitTotal: 100, costTotal: 150,
          soldAt: new Date('2026-06-22T09:00:00.000Z'),
          items: [],
        },
      ]);

      const { service } = await makeServiceReadingLedger(prisma, [retailRow('2026-06-22', 'r1', 250)]);
      const res = await service.getDashboard(TENANT, { period: 'week', date: anchor });

      expect(res.kpis.totalSales).toBe(250);
    });

    it('อ่านใบเสร็จเฉพาะใบที่สมุดชี้มา และเฉพาะ tenant นี้', async () => {
      const prisma = buildPrisma();
      twoSales(prisma);

      const { service } = await makeServiceReadingLedger(prisma, weekRows);
      await service.getDashboard(TENANT, { period: 'week', date: anchor });

      expect(prisma.retailSale.findMany).toHaveBeenCalledTimes(1);
      const [args] = prisma.retailSale.findMany.mock.calls[0];
      expect(args.where).toEqual({ id: { in: ['r1', 'r2'] }, tenantId: TENANT });
      // สถานะ/ช่วงเวลาไม่ได้ถูกกรองซ้ำที่นี่ — สมุดคัดมาให้แล้ว
      expect(args.where.status).toBeUndefined();
      expect(args.where.soldAt).toBeUndefined();
    });

    it('ถามสมุดด้วยช่วงวันธุรกิจไทยแบบรวมปลาย และล็อกเฉพาะรายได้ร้านค้าของคลังที่เลือก', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([]);

      const { service, revenueQuery } = await makeServiceReadingLedger(prisma);
      await service.getDashboard(TENANT, { period: 'week', date: anchor, warehouseId: WH });

      const filters = ledgerFiltersOf(revenueQuery);
      expect(filters.length).toBeGreaterThan(0);
      for (const filter of filters) {
        expect(filter).toMatchObject({
          tenantId: TENANT,
          sourceModule: RevenueSourceModule.RETAIL,
          outletId: WH,
          from: '2026-06-22',
          to: '2026-06-28',
        });
      }
    });

    it('ไม่ล็อกคลังใดคลังหนึ่งเมื่อไม่ได้ระบุ warehouseId', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([]);

      const { service, revenueQuery } = await makeServiceReadingLedger(prisma);
      await service.getDashboard(TENANT, { period: 'week', date: anchor });

      for (const filter of ledgerFiltersOf(revenueQuery)) expect(filter.outletId).toBeUndefined();
    });

    it('หักใบที่ถูกกลับรายการวันหลังออกจากถังของวันนั้น', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([
        {
          id: 'r1', receiptNo: 'RCP-202606-0001', warehouseId: WH, status: 'VOIDED', paymentMethod: 'CASH',
          grandTotal: 267.5, profitTotal: 100, costTotal: 150,
          soldAt: new Date('2026-06-22T09:00:00.000Z'),
          items: [],
        },
      ]);

      const { service } = await makeServiceReadingLedger(prisma, [
        retailRow('2026-06-22', 'r1', 250),
        retailRow('2026-06-24', 'r1', -250),
      ]);
      const res = await service.getDashboard(TENANT, { period: 'week', date: anchor });

      expect(res.kpis.totalSales).toBe(0);
      // ใบเดียวกัน ไม่ใช่สองใบ
      expect(res.kpis.salesCount).toBe(1);
      expect(res.series.find((b) => b.key === '2026-06-22')?.sales).toBe(250);
      expect(res.series.find((b) => b.key === '2026-06-24')?.sales).toBe(-250);
    });

    it('builds 12 monthly buckets for a year period', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([]);
      const { service, revenueQuery } = await makeServiceReadingLedger(prisma, [
        retailRow('2026-03-15', 'r1', 500),
      ]);
      const res = await service.getDashboard(TENANT, { period: 'year', date: '2026-06-24T00:00:00.000Z' });

      expect(res.series).toHaveLength(12);
      expect(res.series[2]).toMatchObject({ key: '2026-03', sales: 500 });
      expect(res.kpis.totalSales).toBe(500);
      expect(ledgerFiltersOf(revenueQuery)[0]).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    });

    it('ช่วงเดือนจบที่วันสุดท้ายของเดือนจริง', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([]);
      const { service, revenueQuery } = await makeServiceReadingLedger(prisma);
      const res = await service.getDashboard(TENANT, { period: 'month', date: '2026-02-10T00:00:00.000Z' });

      expect(res.series).toHaveLength(28);
      expect(ledgerFiltersOf(revenueQuery)[0]).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    });
  });
});
