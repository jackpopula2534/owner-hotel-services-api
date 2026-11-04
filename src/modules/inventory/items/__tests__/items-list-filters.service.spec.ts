import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ItemsService, stockStatusOf } from '../items.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QueryItemDto, StockStatusFilter } from '../dto/query-item.dto';

const ws = (quantity: number, totalValue = 0, id = 'wh-1', name = 'คลังร้านค้า') => ({
  quantity,
  totalValue,
  warehouse: { id, name },
});

describe('ItemsService — list filters for the items page', () => {
  let service: ItemsService;
  const prisma = {
    inventoryItem: { findMany: jest.fn(), count: jest.fn() },
    inventoryLot: { groupBy: jest.fn() },
  };
  const tenantId = 'tenant-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ItemsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ItemsService);
    prisma.inventoryItem.count.mockResolvedValue(0);
    prisma.inventoryLot.groupBy.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  it('stockStatusOf: 0 = out, below reorder point = low, reorder point 0 never low', () => {
    expect(stockStatusOf(0, 10)).toBe(StockStatusFilter.OUT);
    expect(stockStatusOf(-2, 0)).toBe(StockStatusFilter.OUT);
    expect(stockStatusOf(9, 10)).toBe(StockStatusFilter.LOW);
    expect(stockStatusOf(10, 10)).toBe(StockStatusFilter.OK);
    expect(stockStatusOf(3, 0)).toBe(StockStatusFilter.OK);
  });

  it('stockStatus=low narrows the page to ids whose summed stock is under the reorder point', async () => {
    prisma.inventoryItem.findMany
      .mockResolvedValueOnce([
        { id: 'a', reorderPoint: 12, warehouseStocks: [{ quantity: 4 }, { quantity: 5 }] },
        { id: 'b', reorderPoint: 12, warehouseStocks: [{ quantity: 20 }] },
        { id: 'c', reorderPoint: 12, warehouseStocks: [] },
      ])
      .mockResolvedValueOnce([]);

    await service.findAll(tenantId, { stockStatus: StockStatusFilter.LOW });

    const pageArgs = prisma.inventoryItem.findMany.mock.calls[1][0];
    expect(pageArgs.where.id).toEqual({ in: ['a'] });
    expect(pageArgs.where.tenantId).toBe(tenantId);
  });

  it('noReorderPoint and uncategorized become where clauses', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    await service.findAll(tenantId, { noReorderPoint: true, uncategorized: true });
    const where = prisma.inventoryItem.findMany.mock.calls[0][0].where;
    expect(where.reorderPoint).toEqual({ lte: 0 });
    expect(where.categoryId).toBeNull();
  });

  it('returns stock value, warehouses and active lot stats per item', async () => {
    const expiry = new Date('2027-01-05T00:00:00Z');
    prisma.inventoryItem.findMany.mockResolvedValue([
      {
        id: 'nuts',
        reorderPoint: 12,
        categoryId: 'cat',
        category: { id: 'cat', name: 'ขนม' },
        warehouseStocks: [ws(12, 336, 'wh-2', 'คลังสำรอง'), ws(20, 560)],
      },
    ]);
    prisma.inventoryLot.groupBy.mockResolvedValue([
      { itemId: 'nuts', _count: { _all: 2 }, _min: { expiryDate: expiry } },
    ]);

    const res = await service.findAll(tenantId, {});

    const lotArgs = prisma.inventoryLot.groupBy.mock.calls[0][0];
    expect(lotArgs.where).toMatchObject({ tenantId, status: 'ACTIVE', remainingQty: { gt: 0 } });
    expect(res.data[0]).toMatchObject({
      totalStock: 32,
      stockValue: 896,
      activeLotCount: 2,
      nearestExpiry: expiry,
      stockWarehouses: [
        { id: 'wh-1', name: 'คลังร้านค้า', quantity: 20 },
        { id: 'wh-2', name: 'คลังสำรอง', quantity: 12 },
      ],
    });
  });

  it('summary counts items without a reorder point or category', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([
      {
        reorderPoint: 0,
        categoryId: null,
        warehouseStocks: [{ ...ws(15), warehouse: { propertyId: 'p' } }],
      },
      {
        reorderPoint: 12,
        categoryId: 'c',
        warehouseStocks: [{ ...ws(9), warehouse: { propertyId: 'p' } }],
      },
      { reorderPoint: 12, categoryId: 'c', warehouseStocks: [] },
    ]);
    const s = await service.getStockSummary(tenantId);
    expect(s).toMatchObject({
      totalItems: 3,
      lowStockCount: 1,
      outOfStockCount: 1,
      noReorderPointCount: 1,
      uncategorizedCount: 1,
    });
  });
});

describe('QueryItemDto boolean query params', () => {
  const parse = (raw: Record<string, string>) =>
    plainToInstance(QueryItemDto, raw, { enableImplicitConversion: true });

  it('"false" stays false (implicit conversion would make it true)', async () => {
    const dto = parse({ isActive: 'false', isPerishable: 'true', noReorderPoint: 'true' });
    expect(dto.isActive).toBe(false);
    expect(dto.isPerishable).toBe(true);
    expect(dto.noReorderPoint).toBe(true);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an unknown stockStatus and accepts sort=reorderPoint', async () => {
    expect(await validate(parse({ stockStatus: 'nope' }))).not.toHaveLength(0);
    expect(await validate(parse({ sort: 'reorderPoint' }))).toHaveLength(0);
  });
});

describe('UpdateItemDto isActive (ปิด/เปิดใช้งานจากหน้ารายการสินค้า)', () => {
  it('accepts isActive and rejects a non-boolean', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { UpdateItemDto } = require('../dto/update-item.dto');
    expect(await validate(plainToInstance(UpdateItemDto, { isActive: false }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateItemDto, { isActive: 'nope' }))).not.toHaveLength(0);
  });
});
