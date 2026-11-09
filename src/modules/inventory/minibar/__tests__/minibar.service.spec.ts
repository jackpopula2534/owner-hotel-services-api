import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RetailSaleChannel } from '@prisma/client';
import { MinibarService } from '../minibar.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { RetailSalesService } from '@/modules/inventory/retail-sales/retail-sales.service';

const TENANT = 'tenant-1';
const USER = 'user-1';
const PROPERTY = 'prop-1';
const BOOKING = 'booking-1';
const ROOM = 'room-1';

function buildPrisma() {
  const mock: any = {
    booking: { findFirst: jest.fn() },
    warehouse: { findFirst: jest.fn() },
    warehouseStock: { findMany: jest.fn(), groupBy: jest.fn() },
    inventoryItem: { findMany: jest.fn() },
  };
  mock.warehouseStock.findMany.mockResolvedValue([]);
  mock.warehouseStock.groupBy.mockResolvedValue([]);
  mock.inventoryItem.findMany.mockResolvedValue([]);
  return mock;
}

/**
 * ท่อขายจริงถูกแทนด้วย mock — แต่ผูกไว้กับ prototype ของตัวจริงก่อน
 * ไม่งั้นเปลี่ยนชื่อเมธอดในท่อขายแล้วชุดนี้ยังเขียวอยู่ ทั้งที่ของจริงพัง
 */
function buildRetailSales() {
  const real = RetailSalesService.prototype as unknown as Record<string, unknown>;
  expect(typeof real.create).toBe('function');
  expect(typeof real.findAll).toBe('function');
  return {
    create: jest.fn().mockResolvedValue({ id: 'sale-1', receiptNo: 'RCP-0001' }),
    findAll: jest.fn().mockResolvedValue({ data: [], meta: {}, summary: {} }),
  };
}

function buildFolioPosting() {
  const real = FolioPostingService.prototype as unknown as Record<string, unknown>;
  expect(typeof real.listChargeableRooms).toBe('function');
  return { listChargeableRooms: jest.fn().mockResolvedValue([]) };
}

async function makeService(
  prisma: any,
  retailSales: any = buildRetailSales(),
  folioPosting: any = buildFolioPosting(),
) {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      MinibarService,
      { provide: PrismaService, useValue: prisma },
      { provide: RetailSalesService, useValue: retailSales },
      { provide: FolioPostingService, useValue: folioPosting },
    ],
  }).compile();
  return { service: moduleRef.get(MinibarService), prisma, retailSales, folioPosting };
}

/** คลังใบหนึ่ง — ค่าเริ่มต้นเป็นคลังมินิบาร์แท้ ๆ ของสาขา */
const warehouse = (over: Record<string, unknown> = {}) => ({
  id: 'wh-minibar',
  name: 'ตู้มินิบาร์',
  type: 'MINIBAR',
  propertyId: PROPERTY,
  ...over,
});

const bookingRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING,
  propertyId: PROPERTY,
  guestFirstName: 'สมชาย',
  guestLastName: 'ใจดี',
  guest: null,
  room: { id: ROOM, number: '301', propertyId: PROPERTY },
  ...over,
});

describe('MinibarService', () => {
  describe('listRooms', () => {
    it('ดึงห้องจาก FolioPostingService ที่เดียว ไม่นิยามเงื่อนไขเอง', async () => {
      const { service, folioPosting } = await makeService(buildPrisma());
      folioPosting.listChargeableRooms.mockResolvedValue([
        { roomNumber: '301', guestName: 'สมชาย ใจดี', bookingId: BOOKING, status: 'checked_in', roomId: ROOM, propertyId: PROPERTY },
      ]);

      const rooms = await service.listRooms(TENANT, { propertyId: PROPERTY, search: '301' });

      expect(folioPosting.listChargeableRooms).toHaveBeenCalledWith({
        tenantId: TENANT,
        propertyId: PROPERTY,
        search: '301',
      });
      expect(rooms[0].roomId).toBe(ROOM);
    });
  });

  describe('listProducts', () => {
    it('อ่านของจากคลังมินิบาร์ของสาขา และหักยอดที่ถูกกันไว้ออกจากยอดที่หยิบได้', async () => {
      const prisma = buildPrisma();
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      prisma.warehouseStock.findMany.mockResolvedValue([
        {
          quantity: 10,
          reservedQty: 3,
          item: {
            id: 'i1', sku: 'MB-01', name: 'โค้กกระป๋อง', unit: 'CAN',
            imageUrl: null, sellingPrice: 45, category: { name: 'เครื่องดื่ม' },
          },
        },
      ]);
      const { service } = await makeService(prisma);

      const result = await service.listProducts(TENANT, { propertyId: PROPERTY });

      expect(result.source).toEqual({
        warehouseId: 'wh-minibar',
        warehouseName: 'ตู้มินิบาร์',
        warehouseType: 'MINIBAR',
        propertyId: PROPERTY,
        isFallback: false,
      });
      expect(result.data).toEqual([
        {
          itemId: 'i1', sku: 'MB-01', name: 'โค้กกระป๋อง', unit: 'CAN',
          imageUrl: null, categoryName: 'เครื่องดื่ม', sellingPrice: 45,
          quantity: 10, available: 7,
        },
      ]);
    });

    it('ไม่มีคลังมินิบาร์ → ตกไปใช้คลังตั้งต้น แล้วติดธง isFallback ให้จอเห็น', async () => {
      const prisma = buildPrisma();
      prisma.warehouse.findFirst
        .mockResolvedValueOnce(null) // ไม่มี type MINIBAR
        .mockResolvedValueOnce(warehouse({ id: 'wh-main', name: 'คลังกลาง', type: 'GENERAL' }));
      const { service } = await makeService(prisma);

      const result = await service.listProducts(TENANT, { propertyId: PROPERTY });

      expect(result.source.warehouseId).toBe('wh-main');
      expect(result.source.isFallback).toBe(true);
    });

    /**
     * คลังตั้งต้นของสาขามักเป็นคลังวัตถุดิบ ส่วนน้ำอัดลม/ขนมไปกองที่คลังร้านขายของ
     * ถ้าตกไปคลังตั้งต้นทันทีจอจะว่างเปล่าทั้งที่ของอยู่ครบในอีกคลังหนึ่ง
     */
    it('ไม่มีคลังมินิบาร์ → เลือกคลังที่มีของสำเร็จรูปอยู่จริง ก่อนคลังตั้งต้น', async () => {
      const prisma = buildPrisma();
      prisma.warehouseStock.groupBy.mockResolvedValue([
        { warehouseId: 'wh-shop', _sum: { quantity: 144 } },
      ]);
      prisma.warehouse.findFirst
        .mockResolvedValueOnce(null) // ไม่มี type MINIBAR
        .mockResolvedValueOnce(warehouse({ id: 'wh-shop', name: 'คลังร้านขายของ', type: 'GENERAL' }));
      const { service } = await makeService(prisma);

      const result = await service.listProducts(TENANT, { propertyId: PROPERTY });

      expect(prisma.warehouse.findFirst.mock.calls[1][0].where).toEqual(
        expect.objectContaining({ id: 'wh-shop' }),
      );
      expect(result.source.warehouseId).toBe('wh-shop');
      expect(result.source.isFallback).toBe(true);
    });

    it('ปกติซ่อนตัวที่ของหมด แต่ includeOutOfStock=true ให้เห็นทั้งตู้', async () => {
      const prisma = buildPrisma();
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      const { service } = await makeService(prisma);

      await service.listProducts(TENANT, { propertyId: PROPERTY });
      expect(prisma.warehouseStock.findMany.mock.calls[0][0].where.quantity).toEqual({ gt: 0 });

      await service.listProducts(TENANT, { propertyId: PROPERTY, includeOutOfStock: 'true' });
      expect(prisma.warehouseStock.findMany.mock.calls[1][0].where.quantity).toBeUndefined();
    });

    it('หาสาขาจากการจองให้เองเมื่อจอส่งมาแค่ bookingId', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue({ propertyId: 'other', room: { propertyId: PROPERTY } });
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      const { service } = await makeService(prisma);

      const result = await service.listProducts(TENANT, { bookingId: BOOKING });

      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BOOKING, tenantId: TENANT } }),
      );
      expect(result.source.propertyId).toBe(PROPERTY);
    });

    it('ไม่ส่งอะไรมาเลย → บอกให้ระบุสาขาหรือการจอง', async () => {
      const { service } = await makeService(buildPrisma());
      await expect(service.listProducts(TENANT, {})).rejects.toThrow(BadRequestException);
    });

    it('ระบุคลังข้ามกิจการ → ปฏิเสธ', async () => {
      const prisma = buildPrisma();
      prisma.warehouse.findFirst.mockResolvedValue(null);
      const { service } = await makeService(prisma);

      await expect(
        service.listProducts(TENANT, { propertyId: PROPERTY, warehouseId: 'wh-of-another-tenant' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('สาขาไม่มีคลังที่เปิดใช้งานเลย → ปฏิเสธ ไม่ข้ามไปคลังสาขาอื่น', async () => {
      const prisma = buildPrisma();
      prisma.warehouse.findFirst.mockResolvedValue(null);
      const { service } = await makeService(prisma);

      await expect(service.listProducts(TENANT, { propertyId: PROPERTY })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('recordConsumption', () => {
    const priced = (over: Record<string, unknown> = {}) => ({
      id: 'i1', name: 'โค้กกระป๋อง', sellingPrice: 45, ...over,
    });

    it('ตัดของจากคลังมินิบาร์ แล้วส่งเข้าท่อขายเดิมเป็นช่องทาง MINIBAR/ชาร์จเข้าห้อง', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow());
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      prisma.inventoryItem.findMany.mockResolvedValue([priced()]);
      const { service, retailSales } = await makeService(prisma);

      await service.recordConsumption(
        { bookingId: BOOKING, lines: [{ itemId: 'i1', quantity: 2 }], notes: 'พบตอนทำห้อง' },
        USER,
        TENANT,
      );

      const [dto, userId, tenantId, origin] = retailSales.create.mock.calls[0];
      expect(dto).toEqual({
        warehouseId: 'wh-minibar',
        paymentMethod: 'ROOM_CHARGE',
        bookingId: BOOKING,
        roomNumber: '301',
        guestName: 'สมชาย ใจดี',
        vatRate: undefined,
        notes: 'พบตอนทำห้อง',
        lines: [{ itemId: 'i1', quantity: 2, unitPrice: 45 }],
      });
      expect(userId).toBe(USER);
      expect(tenantId).toBe(TENANT);
      expect(origin.channel).toBe(RetailSaleChannel.MINIBAR);
      expect(origin.folioChargeType).toBe('MINIBAR');
      expect(origin.roomId).toBe(ROOM);
    });

    it('คำอธิบายในโฟลิโอบอกเลขห้อง แขกต้องอ่านออกว่าโดนคิดค่าอะไรของห้องไหน', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow());
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      prisma.inventoryItem.findMany.mockResolvedValue([priced()]);
      const { service, retailSales } = await makeService(prisma);

      await service.recordConsumption(
        { bookingId: BOOKING, lines: [{ itemId: 'i1', quantity: 1 }] },
        USER,
        TENANT,
      );

      const origin = retailSales.create.mock.calls[0][3];
      expect(origin.describe('RCP-0007')).toContain('301');
      expect(origin.describe('RCP-0007')).toContain('RCP-0007');
    });

    it('ราคามาจากตัวสินค้าเสมอ — หน้าจอส่งราคามาเองไม่ได้', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow());
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      prisma.inventoryItem.findMany.mockResolvedValue([priced({ sellingPrice: 120 })]);
      const { service, retailSales } = await makeService(prisma);

      await service.recordConsumption(
        // ราคาปลอมที่แนบมากับ payload ต้องถูกทิ้ง
        { bookingId: BOOKING, lines: [{ itemId: 'i1', quantity: 1, unitPrice: 1 } as never] },
        USER,
        TENANT,
      );

      expect(retailSales.create.mock.calls[0][0].lines).toEqual([
        { itemId: 'i1', quantity: 1, unitPrice: 120 },
      ]);
    });

    it('สินค้ายังไม่ตั้งราคา → ปฏิเสธ ไม่ปล่อยเป็นศูนย์', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow());
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      prisma.inventoryItem.findMany.mockResolvedValue([priced({ sellingPrice: null })]);
      const { service, retailSales } = await makeService(prisma);

      await expect(
        service.recordConsumption({ bookingId: BOOKING, lines: [{ itemId: 'i1', quantity: 1 }] }, USER, TENANT),
      ).rejects.toThrow(/ยังไม่ได้ตั้งราคาขาย/);
      expect(retailSales.create).not.toHaveBeenCalled();
    });

    it('ราคา 0 ก็ไม่ผ่าน — แจกฟรีต้องเป็นการตัดสินใจ ไม่ใช่ข้อมูลค้าง', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow());
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      prisma.inventoryItem.findMany.mockResolvedValue([priced({ sellingPrice: 0 })]);
      const { service } = await makeService(prisma);

      await expect(
        service.recordConsumption({ bookingId: BOOKING, lines: [{ itemId: 'i1', quantity: 1 }] }, USER, TENANT),
      ).rejects.toThrow(BadRequestException);
    });

    it('บรรทัดซ้ำสินค้าเดียวกันถูกรวมเป็นบรรทัดเดียว', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow());
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      prisma.inventoryItem.findMany.mockResolvedValue([priced()]);
      const { service, retailSales } = await makeService(prisma);

      await service.recordConsumption(
        { bookingId: BOOKING, lines: [{ itemId: 'i1', quantity: 2 }, { itemId: 'i1', quantity: 3 }] },
        USER,
        TENANT,
      );

      expect(retailSales.create.mock.calls[0][0].lines).toEqual([
        { itemId: 'i1', quantity: 5, unitPrice: 45 },
      ]);
    });

    it('สินค้าข้ามกิจการ → ปฏิเสธ', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow());
      prisma.warehouse.findFirst.mockResolvedValue(warehouse());
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      const { service } = await makeService(prisma);

      await expect(
        service.recordConsumption({ bookingId: BOOKING, lines: [{ itemId: 'ghost', quantity: 1 }] }, USER, TENANT),
      ).rejects.toThrow(BadRequestException);
    });

    it('การจองคนละกิจการ → ไม่พบ (ค้นด้วย findFirst พร้อม tenantId)', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(null);
      const { service } = await makeService(prisma);

      await expect(
        service.recordConsumption({ bookingId: BOOKING, lines: [{ itemId: 'i1', quantity: 1 }] }, USER, TENANT),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: BOOKING, tenantId: TENANT } }),
      );
    });

    it('การจองที่ยังไม่ผูกห้อง → ปฏิเสธ ก่อนไปแตะสต๊อก', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow({ room: null }));
      const { service, retailSales } = await makeService(prisma);

      await expect(
        service.recordConsumption({ bookingId: BOOKING, lines: [{ itemId: 'i1', quantity: 1 }] }, USER, TENANT),
      ).rejects.toThrow(BadRequestException);
      expect(retailSales.create).not.toHaveBeenCalled();
    });

    it('ระบุคลังเองได้ เมื่อโรงแรมไม่ได้แยกตู้มินิบาร์เป็นคลังต่างหาก', async () => {
      const prisma = buildPrisma();
      prisma.booking.findFirst.mockResolvedValue(bookingRow());
      prisma.warehouse.findFirst.mockResolvedValue(
        warehouse({ id: 'wh-shop', name: 'คลังร้านขายของ', type: 'GENERAL' }),
      );
      prisma.inventoryItem.findMany.mockResolvedValue([priced()]);
      const { service, retailSales } = await makeService(prisma);

      const result = await service.recordConsumption(
        { bookingId: BOOKING, warehouseId: 'wh-shop', lines: [{ itemId: 'i1', quantity: 1 }] },
        USER,
        TENANT,
      );

      expect(retailSales.create.mock.calls[0][0].warehouseId).toBe('wh-shop');
      expect(result.source.isFallback).toBe(true);
    });
  });

  describe('listConsumption', () => {
    it('บังคับช่องทาง MINIBAR แล้วส่งตัวกรองที่เหลือต่อให้ตัวอ่านประวัติเดิม', async () => {
      const { service, retailSales } = await makeService(buildPrisma());

      await service.listConsumption(TENANT, { roomId: ROOM, bookingId: BOOKING, page: 2, limit: 50 });

      expect(retailSales.findAll).toHaveBeenCalledWith(TENANT, {
        roomId: ROOM,
        bookingId: BOOKING,
        page: 2,
        limit: 50,
        channel: RetailSaleChannel.MINIBAR,
      });
    });
  });
});
