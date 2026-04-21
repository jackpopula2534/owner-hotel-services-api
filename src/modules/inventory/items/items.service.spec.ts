import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ItemsService } from './items.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SearchItemDto } from './dto/search-item.dto';

describe('ItemsService — searchItems', () => {
  let service: ItemsService;

  const mockPrismaService = {
    inventoryItem: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ItemsService>(ItemsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const tenantId = 'tenant-123';

  const mockRow = {
    id: 'item-1',
    sku: 'SKU-001',
    name: 'Tomato Fresh',
    unit: 'KG',
    barcode: '1234567890123',
    categoryId: 'cat-1',
    imageUrl: null,
    isPerishable: true,
    defaultShelfLifeDays: 7,
    reorderPoint: 10,
    category: { id: 'cat-1', name: 'Vegetables' },
  };

  it('scopes the query by tenantId and excludes soft-deleted items', async () => {
    mockPrismaService.inventoryItem.findMany.mockResolvedValue([mockRow]);

    const dto: SearchItemDto = { q: 'tom' };
    await service.searchItems(tenantId, dto);

    expect(mockPrismaService.inventoryItem.findMany).toHaveBeenCalledTimes(1);
    const args = mockPrismaService.inventoryItem.findMany.mock.calls[0][0];
    expect(args.where.tenantId).toBe(tenantId);
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.isActive).toBe(true);
    expect(Array.isArray(args.where.OR)).toBe(true);
  });

  it('matches name (insensitive), sku (insensitive), and barcode (exact)', async () => {
    mockPrismaService.inventoryItem.findMany.mockResolvedValue([]);
    await service.searchItems(tenantId, { q: 'abc' });

    const args = mockPrismaService.inventoryItem.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { name: { contains: 'abc', mode: 'insensitive' } },
      { sku: { contains: 'abc', mode: 'insensitive' } },
      { barcode: { equals: 'abc' } },
    ]);
  });

  it('applies default limit of 20 and respects explicit limits', async () => {
    mockPrismaService.inventoryItem.findMany.mockResolvedValue([]);

    await service.searchItems(tenantId, { q: 'tom' });
    expect(mockPrismaService.inventoryItem.findMany.mock.calls[0][0].take).toBe(20);

    await service.searchItems(tenantId, { q: 'tom', limit: 5 });
    expect(mockPrismaService.inventoryItem.findMany.mock.calls[1][0].take).toBe(5);
  });

  it('filters by categoryId when provided', async () => {
    mockPrismaService.inventoryItem.findMany.mockResolvedValue([]);
    await service.searchItems(tenantId, { q: 'tom', categoryId: 'cat-vegetables' });

    const args = mockPrismaService.inventoryItem.findMany.mock.calls[0][0];
    expect(args.where.categoryId).toBe('cat-vegetables');
  });

  it('returns a slim shape with category populated', async () => {
    mockPrismaService.inventoryItem.findMany.mockResolvedValue([mockRow]);
    const results = await service.searchItems(tenantId, { q: 'tom' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'item-1',
      sku: 'SKU-001',
      name: 'Tomato Fresh',
      unit: 'KG',
      barcode: '1234567890123',
      category: { id: 'cat-1', name: 'Vegetables' },
    });
    // No stock aggregation leaked into the search response
    expect(results[0]).not.toHaveProperty('totalStock');
    expect(results[0]).not.toHaveProperty('warehouseStocks');
  });

  it('allows caller to opt into inactive items', async () => {
    mockPrismaService.inventoryItem.findMany.mockResolvedValue([]);
    await service.searchItems(tenantId, { q: 'tom', isActive: false });

    const args = mockPrismaService.inventoryItem.findMany.mock.calls[0][0];
    expect(args.where.isActive).toBe(false);
  });

  it('propagates Prisma errors after logging', async () => {
    const boom = new Error('db down');
    mockPrismaService.inventoryItem.findMany.mockRejectedValue(boom);

    await expect(service.searchItems(tenantId, { q: 'tom' })).rejects.toThrow('db down');
  });
});

describe('SearchItemDto validation', () => {
  it('rejects queries shorter than 2 characters', async () => {
    const dto = plainToInstance(SearchItemDto, { q: 'a' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints?.minLength).toBeDefined();
  });

  it('accepts a 2-character query', async () => {
    const dto = plainToInstance(SearchItemDto, { q: 'ab' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects limits above the 50-row cap', async () => {
    const dto = plainToInstance(SearchItemDto, { q: 'abc', limit: 500 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.constraints?.max)).toBe(true);
  });

  it('trims whitespace from the query', async () => {
    const dto = plainToInstance(SearchItemDto, { q: '  tom  ' });
    expect(dto.q).toBe('tom');
  });
});
