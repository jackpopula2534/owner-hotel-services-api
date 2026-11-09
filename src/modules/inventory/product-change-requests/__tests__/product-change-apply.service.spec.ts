import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ProductChangeApplyService } from '../product-change-apply.service';
import { FieldChange } from '../product-change-fields';

const tenantId = 'tenant-1';

function buildPrisma() {
  return {
    inventoryItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'new-item' }),
      update: jest.fn(),
    },
    itemSupplier: { updateMany: jest.fn(), upsert: jest.fn(), create: jest.fn() },
    itemCategory: { findFirst: jest.fn() },
    supplier: { findFirst: jest.fn() },
  };
}

const change = (
  field: FieldChange['field'],
  to: FieldChange['to'],
  approved = true,
): FieldChange => ({
  field,
  label: field,
  level: 'ACKNOWLEDGE',
  from: null,
  to,
  decision: approved ? 'APPROVED' : 'REJECTED',
});

describe('ProductChangeApplyService', () => {
  let service: ProductChangeApplyService;
  let prisma: ReturnType<typeof buildPrisma>;
  const tx = (): Prisma.TransactionClient => prisma as unknown as Prisma.TransactionClient;

  beforeEach(async () => {
    prisma = buildPrisma();
    const module = await Test.createTestingModule({
      providers: [ProductChangeApplyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProductChangeApplyService);
  });

  it('reads supplier terms from the preferred supplier', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({
      name: 'A',
      description: null,
      brand: 'B',
      purchaseUnit: 'BOX',
      purchaseUnitFactor: new Prisma.Decimal('24.000'),
      itemSuppliers: [
        {
          supplierId: 'sup-1',
          unitPrice: new Prisma.Decimal('156.00'),
          minOrderQty: 10,
          leadDays: 3,
        },
      ],
    });
    await expect(service.readSnapshot(tenantId, 'item-1')).resolves.toEqual({
      name: 'A',
      description: null,
      brand: 'B',
      preferredSupplierId: 'sup-1',
      unitPrice: 156,
      minOrderQty: 10,
      leadDays: 3,
      purchaseUnit: 'BOX',
      purchaseUnitFactor: 24,
    });
  });

  it('writes only approved item fields', async () => {
    await service.applyUpdate(tx(), tenantId, 'item-1', [
      change('name', 'ใหม่'),
      change('brand', 'X', false),
    ]);
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { name: 'ใหม่' },
    });
    expect(prisma.itemSupplier.upsert).not.toHaveBeenCalled();
  });

  it('moves the preferred flag and carries unchanged terms to the new supplier', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({
      name: 'A',
      description: null,
      brand: null,
      purchaseUnit: null,
      purchaseUnitFactor: null,
      itemSuppliers: [
        {
          supplierId: 'sup-old',
          unitPrice: new Prisma.Decimal('156'),
          minOrderQty: 10,
          leadDays: 3,
        },
      ],
    });
    await service.applyUpdate(tx(), tenantId, 'item-1', [
      change('preferredSupplierId', 'sup-new'),
      change('unitPrice', 168),
    ]);
    expect(prisma.itemSupplier.updateMany).toHaveBeenCalledWith({
      where: { itemId: 'item-1', supplierId: { not: 'sup-new' }, isPreferred: true },
      data: { isPreferred: false },
    });
    expect(prisma.itemSupplier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId_supplierId: { itemId: 'item-1', supplierId: 'sup-new' } },
        update: { isPreferred: true, unitPrice: 168, minOrderQty: 10, leadDays: 3 },
      }),
    );
  });

  it('refuses supplier terms when the item has no supplier', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({
      name: 'A',
      description: null,
      brand: null,
      purchaseUnit: null,
      purchaseUnitFactor: null,
      itemSuppliers: [],
    });
    await expect(
      service.applyUpdate(tx(), tenantId, 'item-1', [change('leadDays', 5)]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a SKU that is already used', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValueOnce({ id: 'x', deletedAt: null });
    await expect(
      service.applyCreate(tx(), tenantId, { name: 'น้ำแร่' }, { sku: 'SKU-1', unit: 'BOTTLE' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates the item with warehouse values and the preferred supplier', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue(null);
    prisma.itemCategory.findFirst.mockResolvedValue({ id: 'cat-1' });
    const id = await service.applyCreate(
      tx(),
      tenantId,
      {
        name: ' น้ำแร่ 500ml ',
        supplierId: 'sup-1',
        unitPrice: 132,
        purchaseUnit: 'BOX',
        purchaseUnitFactor: 24,
      },
      { sku: 'RT-MINERAL-500', unit: 'BOTTLE', categoryId: 'cat-1', minStock: 48, maxStock: 200 },
    );
    expect(id).toBe('new-item');
    expect(prisma.inventoryItem.create.mock.calls[0][0].data).toMatchObject({
      tenantId,
      sku: 'RT-MINERAL-500',
      name: 'น้ำแร่ 500ml',
      unit: 'BOTTLE',
      minStock: 48,
      maxStock: 200,
      purchaseUnit: 'BOX',
      purchaseUnitFactor: 24,
    });
    expect(prisma.itemSupplier.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ itemId: 'new-item', supplierId: 'sup-1', isPreferred: true }),
    });
  });

  it('rejects max stock below min stock', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue(null);
    await expect(
      service.applyCreate(
        tx(),
        tenantId,
        { name: 'A' },
        { sku: 'A-1', unit: 'PIECE', minStock: 10, maxStock: 5 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('suggests the next free SKU in the category prefix', async () => {
    prisma.itemCategory.findFirst.mockResolvedValue({ code: 'bev water' });
    prisma.inventoryItem.findMany.mockResolvedValue([
      { sku: 'BEV-WATER-0001' },
      { sku: 'BEV-WATER-0007' },
    ]);
    await expect(service.suggestSku(tenantId, 'cat-1')).resolves.toBe('BEV-WATER-0008');
  });

  it('ranks barcode matches first when looking for duplicates', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([
      { id: '1', sku: 'A', name: 'น้ำดื่ม 600ml', brand: null, barcode: null, unit: 'BOTTLE' },
      { id: '2', sku: 'B', name: 'โซดา', brand: null, barcode: '885', unit: 'BOTTLE' },
    ]);
    const result = await service.findDuplicates(tenantId, 'น้ำดื่ม 500ml', '885');
    expect(result.map((r) => r.id)).toEqual(['2', '1']);
    expect(result[0].reason).toBe('BARCODE');
  });
});
