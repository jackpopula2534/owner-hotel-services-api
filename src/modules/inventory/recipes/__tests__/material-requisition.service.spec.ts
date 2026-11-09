import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaterialRequisitionService } from '../material-requisition.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { IntegrationsService } from '../../../integrations/integrations.service';
import { StockMovementsService } from '../../stock-movements/stock-movements.service';
import { ItemPriceEstimateService } from '../../pricing/item-price-estimate.service';
import { StockMovementTypeDto } from '../../stock-movements/dto/create-stock-movement.dto';

describe('MaterialRequisitionService', () => {
  let service: MaterialRequisitionService;

  const prismaMock = {
    warehouse: { findFirst: jest.fn(), findMany: jest.fn() },
    warehouseStock: { findMany: jest.fn() },
    inventoryItem: { findMany: jest.fn() },
    materialRequisition: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    purchaseRequisition: { create: jest.fn() },
    documentSequence: { upsert: jest.fn() },
    $transaction: jest.fn(),
  };
  const integrationsMock = { isEnabled: jest.fn() };
  const movementsMock = { createTransfer: jest.fn(), createMovement: jest.fn() };
  const priceMock = { estimateMany: jest.fn() };

  const CENTRAL = { id: 'wh-central', name: 'คลังกลาง', propertyId: 'prop-1' };
  const KITCHEN = { id: 'wh-kitchen', name: 'คลังครัว', propertyId: 'prop-1' };

  const TRANSFER = {
    mode: 'transfer' as const,
    sourceWarehouseId: CENTRAL.id,
    toWarehouseId: KITCHEN.id,
    lines: [
      { itemId: 'item-papaya', quantity: 11 },
      { itemId: 'item-peanut', quantity: 2 },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MaterialRequisitionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: IntegrationsService, useValue: integrationsMock },
        { provide: StockMovementsService, useValue: movementsMock },
        { provide: ItemPriceEstimateService, useValue: priceMock },
      ],
    }).compile();
    service = moduleRef.get(MaterialRequisitionService);

    integrationsMock.isEnabled.mockResolvedValue(true);
    prismaMock.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
    prismaMock.materialRequisition.create.mockResolvedValue({ id: 'mr-1' });
    prismaMock.materialRequisition.update.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
    priceMock.estimateMany.mockResolvedValue(new Map());
  });

  /** Both warehouses resolve, both items exist, and the source is well stocked. */
  const stocked = (): void => {
    prismaMock.warehouse.findFirst
      .mockResolvedValueOnce(CENTRAL)
      .mockResolvedValueOnce({ id: KITCHEN.id, name: KITCHEN.name });
    prismaMock.inventoryItem.findMany.mockResolvedValue([
      { id: 'item-papaya', name: 'มะละกอดิบ' },
      { id: 'item-peanut', name: 'ถั่วลิสง' },
    ]);
    prismaMock.warehouseStock.findMany.mockResolvedValue([
      { itemId: 'item-papaya', quantity: 30, avgCost: 25 },
      { itemId: 'item-peanut', quantity: 10, avgCost: 80 },
    ]);
  };

  it('refuses everything when the warehouse connection is off', async () => {
    integrationsMock.isEnabled.mockResolvedValue(false);
    await expect(
      service.create('t-1', 'u-1', {
        mode: 'issue',
        sourceWarehouseId: CENTRAL.id,
        lines: [{ itemId: 'item-papaya', quantity: 11 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(movementsMock.createMovement).not.toHaveBeenCalled();
    expect(prismaMock.materialRequisition.create).not.toHaveBeenCalled();
  });

  describe('create — issue now', () => {
    it('transfers every line into the kitchen under one requisition number', async () => {
      stocked();

      const result = await service.create('t-1', 'u-1', TRANSFER);

      expect(result.status).toBe('ISSUED');
      expect(result.lineCount).toBe(2);
      expect(result.totalQty).toBe(13);
      expect(result.requisitionNo).toMatch(/^RCP-\d{6}-0001$/);
      expect(movementsMock.createTransfer).toHaveBeenCalledTimes(2);
      expect(movementsMock.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          fromWarehouseId: CENTRAL.id,
          toWarehouseId: KITCHEN.id,
          itemId: 'item-papaya',
          quantity: 11,
          referenceType: 'RECIPE_REQUISITION',
          referenceId: result.requisitionNo,
        }),
        'u-1',
        't-1',
      );
    });

    it('writes nothing at all when one line is short — no partial requisition', async () => {
      prismaMock.warehouse.findFirst
        .mockResolvedValueOnce(CENTRAL)
        .mockResolvedValueOnce({ id: KITCHEN.id, name: KITCHEN.name });
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        { id: 'item-papaya', name: 'มะละกอดิบ' },
        { id: 'item-peanut', name: 'ถั่วลิสง' },
      ]);
      // Papaya is fine; peanut is one short.
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { itemId: 'item-papaya', quantity: 30, avgCost: 25 },
        { itemId: 'item-peanut', quantity: 1, avgCost: 80 },
      ]);

      await expect(service.create('t-1', 'u-1', TRANSFER)).rejects.toThrow(/ถั่วลิสง/);
      expect(movementsMock.createTransfer).not.toHaveBeenCalled();
      expect(prismaMock.materialRequisition.create).not.toHaveBeenCalled();
    });

    it('issues from the source warehouse when there is no kitchen to transfer into', async () => {
      prismaMock.warehouse.findFirst.mockResolvedValueOnce(CENTRAL);
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        { id: 'item-papaya', name: 'มะละกอดิบ' },
      ]);
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { itemId: 'item-papaya', quantity: 30, avgCost: 25 },
      ]);

      await service.create('t-1', 'u-1', {
        mode: 'issue',
        sourceWarehouseId: CENTRAL.id,
        lines: [{ itemId: 'item-papaya', quantity: 11 }],
      });

      expect(movementsMock.createTransfer).not.toHaveBeenCalled();
      expect(movementsMock.createMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          warehouseId: CENTRAL.id,
          type: StockMovementTypeDto.GOODS_ISSUE,
          quantity: 11,
          unitCost: 25,
          referenceType: 'RECIPE_REQUISITION',
        }),
        'u-1',
        't-1',
      );
    });

    it('collapses a duplicated item rather than issuing it twice', async () => {
      prismaMock.warehouse.findFirst.mockResolvedValueOnce(CENTRAL);
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        { id: 'item-papaya', name: 'มะละกอดิบ' },
      ]);
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { itemId: 'item-papaya', quantity: 30, avgCost: 25 },
      ]);

      const result = await service.create('t-1', 'u-1', {
        mode: 'issue',
        sourceWarehouseId: CENTRAL.id,
        lines: [
          { itemId: 'item-papaya', quantity: 4 },
          { itemId: 'item-papaya', quantity: 7 },
        ],
      });

      expect(result.lineCount).toBe(1);
      expect(movementsMock.createMovement).toHaveBeenCalledTimes(1);
      expect(movementsMock.createMovement).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 11 }),
        'u-1',
        't-1',
      );
    });

    it('refuses a transfer with no destination, and one onto itself', async () => {
      prismaMock.warehouse.findFirst.mockResolvedValue(CENTRAL);

      await expect(
        service.create('t-1', 'u-1', { ...TRANSFER, toWarehouseId: undefined }),
      ).rejects.toThrow(/คลังปลายทาง/);
      await expect(
        service.create('t-1', 'u-1', { ...TRANSFER, toWarehouseId: CENTRAL.id }),
      ).rejects.toThrow(/คลังเดียวกัน/);
      expect(movementsMock.createTransfer).not.toHaveBeenCalled();
    });

    it('continues the month’s running number from the shared sequence table', async () => {
      stocked();
      prismaMock.documentSequence.upsert.mockResolvedValue({ lastNumber: 3 });

      const result = await service.create('t-1', 'u-1', TRANSFER);
      expect(result.requisitionNo).toMatch(/-0003$/);
    });
  });

  describe('create — reserve and wait for goods', () => {
    /** Peanut is 1 short of the 2 requested; papaya is fine. */
    const oneShort = (): void => {
      prismaMock.warehouse.findFirst
        .mockResolvedValueOnce(CENTRAL)
        .mockResolvedValueOnce({ id: KITCHEN.id, name: KITCHEN.name });
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        { id: 'item-papaya', name: 'มะละกอดิบ' },
        { id: 'item-peanut', name: 'ถั่วลิสง' },
      ]);
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { itemId: 'item-papaya', quantity: 30, avgCost: 25 },
        { itemId: 'item-peanut', quantity: 1, avgCost: 80 },
      ]);
    };

    it('parks the document instead of rejecting it, and moves no stock', async () => {
      oneShort();

      const result = await service.create('t-1', 'u-1', { ...TRANSFER, action: 'reserve' });

      expect(result.status).toBe('WAITING_STOCK');
      expect(result.shortLines).toEqual([{ itemName: 'ถั่วลิสง', missing: 1 }]);
      expect(movementsMock.createTransfer).not.toHaveBeenCalled();
      expect(prismaMock.materialRequisition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'WAITING_STOCK', reqNumber: result.requisitionNo }),
        }),
      );
    });

    it('opens a purchase requisition for the shortfall only, linked to the document', async () => {
      oneShort();
      prismaMock.purchaseRequisition.create.mockResolvedValue({
        id: 'pr-1',
        prNumber: 'PR-202608-0001',
      });

      const result = await service.create('t-1', 'u-1', {
        ...TRANSFER,
        action: 'reserve',
        createPurchaseRequisition: true,
      });

      expect(result.purchaseRequisition).toEqual({ id: 'pr-1', prNumber: 'PR-202608-0001' });
      // The PR asks for what is missing (1), not the whole requisition line (2).
      expect(prismaMock.purchaseRequisition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DRAFT',
            propertyId: 'prop-1',
            items: { create: [{ itemId: 'item-peanut', quantity: 1 }] },
          }),
        }),
      );
      expect(prismaMock.materialRequisition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ purchaseRequisitionId: 'pr-1' }),
        }),
      );
    });

    it('lands straight in READY when the stock happens to be there already', async () => {
      stocked();

      const result = await service.create('t-1', 'u-1', { ...TRANSFER, action: 'reserve' });

      expect(result.status).toBe('READY');
      expect(result.purchaseRequisition).toBeNull();
      // Reserving never moves stock, even when it could — issuing is a separate step.
      expect(movementsMock.createTransfer).not.toHaveBeenCalled();
      expect(prismaMock.purchaseRequisition.create).not.toHaveBeenCalled();
    });

    it('does not raise a purchase requisition when nothing is actually short', async () => {
      stocked();

      await service.create('t-1', 'u-1', {
        ...TRANSFER,
        action: 'reserve',
        createPurchaseRequisition: true,
      });

      expect(prismaMock.purchaseRequisition.create).not.toHaveBeenCalled();
    });

    it('เติมราคาประมาณการให้ทุกบรรทัดที่หาราคาอ้างอิงได้ พร้อมบอกที่มา', async () => {
      oneShort();
      prismaMock.purchaseRequisition.create.mockResolvedValue({ id: 'pr-1', prNumber: 'PR-1' });
      priceMock.estimateMany.mockResolvedValue(
        new Map([
          ['item-peanut', { unitPrice: 45.5, source: 'SUPPLIER_PREFERRED', supplierId: 's-9' }],
        ]),
      );

      await service.create('t-1', 'u-1', {
        ...TRANSFER,
        action: 'reserve',
        createPurchaseRequisition: true,
      });

      // Only the shortfall is priced — the estimator is asked about that item alone.
      expect(priceMock.estimateMany).toHaveBeenCalledWith('t-1', ['item-peanut']);

      const line = prismaMock.purchaseRequisition.create.mock.calls[0][0].data.items.create[0];
      expect(line.itemId).toBe('item-peanut');
      expect(Number(line.estimatedUnitPrice)).toBe(45.5);
      // Total follows the quantity actually being requested (1 short), not the recipe line.
      expect(Number(line.estimatedTotalPrice)).toBe(45.5);
      expect(line.preferredSupplierId).toBe('s-9');
      expect(line.notes).toBe('ราคาประมาณการจากผู้ขายหลัก');
    });

    it('หาราคาอ้างอิงไม่ได้ ต้องปล่อยว่าง ไม่ใช่ตั้งราคาเป็น 0', async () => {
      oneShort();
      prismaMock.purchaseRequisition.create.mockResolvedValue({ id: 'pr-1', prNumber: 'PR-1' });
      priceMock.estimateMany.mockResolvedValue(new Map());

      await service.create('t-1', 'u-1', {
        ...TRANSFER,
        action: 'reserve',
        createPurchaseRequisition: true,
      });

      // A zero would total as "free" on every procurement screen.
      expect(prismaMock.purchaseRequisition.create.mock.calls[0][0].data.items.create).toEqual([
        { itemId: 'item-peanut', quantity: 1 },
      ]);
    });
  });

  describe('issue — releasing a parked document', () => {
    const parked = {
      id: 'mr-1',
      reqNumber: 'RCP-202608-0001',
      status: 'READY',
      mode: 'TRANSFER',
      sourceWarehouseId: CENTRAL.id,
      toWarehouseId: KITCHEN.id,
      notes: null,
      items: [{ itemId: 'item-papaya', quantity: 11, requiredQty: 11 }],
    };

    it('re-checks stock at issue time — READY is a hint, not a promise', async () => {
      prismaMock.materialRequisition.findFirst.mockResolvedValue(parked);
      prismaMock.warehouse.findFirst
        .mockResolvedValueOnce(CENTRAL)
        .mockResolvedValueOnce({ id: KITCHEN.id, name: KITCHEN.name });
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        { id: 'item-papaya', name: 'มะละกอดิบ' },
      ]);
      // Someone else drew the papaya down between READY and this call.
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { itemId: 'item-papaya', quantity: 2, avgCost: 25 },
      ]);

      await expect(service.issue('t-1', 'u-1', 'mr-1')).rejects.toThrow(/ยังไม่พอ/);
      expect(movementsMock.createTransfer).not.toHaveBeenCalled();
      expect(prismaMock.materialRequisition.update).not.toHaveBeenCalled();
    });

    it('moves the stock and marks the document issued', async () => {
      prismaMock.materialRequisition.findFirst.mockResolvedValue(parked);
      prismaMock.warehouse.findFirst
        .mockResolvedValueOnce(CENTRAL)
        .mockResolvedValueOnce({ id: KITCHEN.id, name: KITCHEN.name });
      prismaMock.inventoryItem.findMany.mockResolvedValue([
        { id: 'item-papaya', name: 'มะละกอดิบ' },
      ]);
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { itemId: 'item-papaya', quantity: 30, avgCost: 25 },
      ]);

      const result = await service.issue('t-1', 'u-1', 'mr-1');

      expect(result.status).toBe('ISSUED');
      expect(result.totalQty).toBe(11);
      expect(movementsMock.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ referenceId: 'RCP-202608-0001', quantity: 11 }),
        'u-1',
        't-1',
      );
      expect(prismaMock.materialRequisition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ISSUED' }) }),
      );
    });

    it('refuses to issue the same document twice', async () => {
      prismaMock.materialRequisition.findFirst.mockResolvedValue({ ...parked, status: 'ISSUED' });
      await expect(service.issue('t-1', 'u-1', 'mr-1')).rejects.toThrow(/เบิกไปแล้ว/);
      expect(movementsMock.createTransfer).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('refuses to cancel a document whose stock already moved', async () => {
      prismaMock.materialRequisition.findFirst.mockResolvedValue({
        id: 'mr-1',
        status: 'ISSUED',
        notes: null,
        reqNumber: 'RCP-202608-0001',
      });
      await expect(service.cancel('t-1', 'u-1', 'mr-1', {})).rejects.toThrow(/ยกเลิกไม่ได้/);
    });

    it('keeps the reason on the document', async () => {
      prismaMock.materialRequisition.findFirst.mockResolvedValue({
        id: 'mr-1',
        status: 'WAITING_STOCK',
        notes: 'งานเลี้ยง 50 ที่',
        reqNumber: 'RCP-202608-0001',
      });

      await service.cancel('t-1', 'u-1', 'mr-1', { reason: 'ลูกค้ายกเลิกงาน' });

      expect(prismaMock.materialRequisition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            notes: 'งานเลี้ยง 50 ที่ · ยกเลิก: ลูกค้ายกเลิกงาน',
          }),
        }),
      );
    });
  });

  describe('list', () => {
    it('defaults to the open documents and reports what is coverable right now', async () => {
      prismaMock.materialRequisition.findMany.mockResolvedValue([
        {
          id: 'mr-1',
          reqNumber: 'RCP-202608-0001',
          status: 'WAITING_STOCK',
          mode: 'TRANSFER',
          createdAt: new Date('2026-08-07'),
          readyAt: null,
          issuedAt: null,
          sourceWarehouseId: CENTRAL.id,
          toWarehouseId: KITCHEN.id,
          notes: null,
          purchaseRequisition: { id: 'pr-1', prNumber: 'PR-202608-0001', status: 'DRAFT' },
          items: [
            {
              itemId: 'item-papaya',
              quantity: 11,
              requiredQty: 11,
              shortageQty: 11,
              item: { name: 'มะละกอดิบ', sku: 'ING-PAPAYA', unit: 'KG' },
            },
          ],
        },
      ]);
      prismaMock.warehouse.findMany.mockResolvedValue([
        { id: CENTRAL.id, name: CENTRAL.name },
        { id: KITCHEN.id, name: KITCHEN.name },
      ]);
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { warehouseId: CENTRAL.id, itemId: 'item-papaya', quantity: 4 },
      ]);

      const [doc] = await service.list('t-1', {});

      expect(prismaMock.materialRequisition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['WAITING_STOCK', 'READY'] } }),
        }),
      );
      expect(doc.purchaseRequisition?.prNumber).toBe('PR-202608-0001');
      expect(doc.lines[0].availableQty).toBe(4);
      expect(doc.lines[0].enough).toBe(false);
      expect(doc.fulfillable).toBe(false);
    });

    it('opens the history only when asked — ALL drops the status filter entirely', async () => {
      prismaMock.materialRequisition.findMany.mockResolvedValue([]);

      await service.list('t-1', { status: 'ALL' });

      const { where } = prismaMock.materialRequisition.findMany.mock.calls[0][0];
      expect(where.status).toBeUndefined();
      expect(where.tenantId).toBe('t-1');
    });

    it('narrows to one status when the list page asks for it', async () => {
      prismaMock.materialRequisition.findMany.mockResolvedValue([]);

      await service.list('t-1', { status: 'ISSUED' });

      expect(prismaMock.materialRequisition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'ISSUED' }) }),
      );
    });

    it('searches by requisition number or by the PR number it is waiting on', async () => {
      prismaMock.materialRequisition.findMany.mockResolvedValue([]);

      await service.list('t-1', { search: '  PR-202608-0001  ', limit: 10 });

      const { where, take } = prismaMock.materialRequisition.findMany.mock.calls[0][0];
      expect(take).toBe(10);
      expect(where.OR).toEqual([
        { reqNumber: { contains: 'PR-202608-0001' } },
        { purchaseRequisition: { prNumber: { contains: 'PR-202608-0001' } } },
      ]);
    });
  });

  describe('findOne', () => {
    const stored = {
      id: 'mr-1',
      reqNumber: 'RCP-202608-0001',
      status: 'WAITING_STOCK',
      mode: 'TRANSFER',
      createdAt: new Date('2026-08-07'),
      readyAt: null,
      issuedAt: null,
      sourceWarehouseId: CENTRAL.id,
      toWarehouseId: KITCHEN.id,
      notes: null,
      purchaseRequisition: { id: 'pr-1', prNumber: 'PR-202608-0001', status: 'DRAFT' },
      items: [
        {
          itemId: 'item-papaya',
          quantity: 11,
          requiredQty: 11,
          shortageQty: 11,
          item: { name: 'มะละกอดิบ', sku: 'ING-PAPAYA', unit: 'KG' },
        },
      ],
    };

    it('never reads a document outside the tenant — findFirst with both keys', async () => {
      prismaMock.materialRequisition.findFirst.mockResolvedValue(stored);
      prismaMock.warehouse.findMany.mockResolvedValue([
        { id: CENTRAL.id, name: CENTRAL.name },
        { id: KITCHEN.id, name: KITCHEN.name },
      ]);
      prismaMock.warehouseStock.findMany.mockResolvedValue([
        { warehouseId: CENTRAL.id, itemId: 'item-papaya', quantity: 30 },
      ]);

      const doc = await service.findOne('t-1', 'mr-1');

      expect(prismaMock.materialRequisition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'mr-1', tenantId: 't-1' } }),
      );
      // Same shape as a list row, so the detail modal can be fed from either path.
      expect(doc.reqNumber).toBe('RCP-202608-0001');
      expect(doc.purchaseRequisition?.prNumber).toBe('PR-202608-0001');
      // Live stock, not the stored status: the goods landed, so it is issuable.
      expect(doc.lines[0].availableQty).toBe(30);
      expect(doc.fulfillable).toBe(true);
    });

    it('404s instead of returning nothing when the id is not ours', async () => {
      prismaMock.materialRequisition.findFirst.mockResolvedValue(null);

      await expect(service.findOne('t-1', 'mr-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
