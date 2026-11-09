import { Test } from '@nestjs/testing';
import { MaterialRequisitionListener } from '../material-requisition.listener';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NotificationsService } from '../../../../notifications/notifications.service';
import { GoodsReceiveCompletedEvent } from '../../events/inventory.events';

describe('MaterialRequisitionListener', () => {
  let listener: MaterialRequisitionListener;

  const prismaMock = {
    materialRequisition: { findMany: jest.fn(), updateMany: jest.fn() },
    warehouseStock: { findMany: jest.fn() },
  };
  const notificationsMock = { create: jest.fn() };

  const WAREHOUSE = 'wh-central';

  const EVENT: GoodsReceiveCompletedEvent = {
    grId: 'gr-1',
    grNumber: 'GR-202608-0001',
    tenantId: 't-1',
    warehouseId: WAREHOUSE,
    purchaseOrderId: 'po-1',
    status: 'ACCEPTED',
    items: [{ itemId: 'item-peanut', receivedQty: 10, rejectedQty: 0, lotId: null, expiryDate: null }],
    receivedBy: 'u-2',
  };

  const WAITING = {
    id: 'mr-1',
    tenantId: 't-1',
    reqNumber: 'RCP-202608-0001',
    createdBy: 'u-1',
    items: [
      { itemId: 'item-papaya', quantity: 11 },
      { itemId: 'item-peanut', quantity: 2 },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MaterialRequisitionListener,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsMock },
      ],
    }).compile();
    listener = moduleRef.get(MaterialRequisitionListener);

    prismaMock.materialRequisition.findMany.mockResolvedValue([WAITING]);
    prismaMock.materialRequisition.updateMany.mockResolvedValue({ count: 1 });
    notificationsMock.create.mockResolvedValue({});
  });

  it('releases the requisition and tells the person who raised it', async () => {
    prismaMock.warehouseStock.findMany.mockResolvedValue([
      { itemId: 'item-papaya', quantity: 30 },
      { itemId: 'item-peanut', quantity: 10 },
    ]);

    await listener.handleGoodsReceived(EVENT);

    expect(prismaMock.materialRequisition.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['mr-1'] } },
        data: expect.objectContaining({ status: 'READY' }),
      }),
    );
    expect(notificationsMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        tenantId: 't-1',
        message: expect.stringContaining('RCP-202608-0001'),
      }),
    );
  });

  it('keeps waiting when the receipt covers only part of the document', async () => {
    // The peanut arrived, but the papaya line is still unfulfilled.
    prismaMock.warehouseStock.findMany.mockResolvedValue([
      { itemId: 'item-papaya', quantity: 3 },
      { itemId: 'item-peanut', quantity: 10 },
    ]);

    await listener.handleGoodsReceived(EVENT);

    expect(prismaMock.materialRequisition.updateMany).not.toHaveBeenCalled();
    expect(notificationsMock.create).not.toHaveBeenCalled();
  });

  it('ignores documents that share no item with the receipt', async () => {
    prismaMock.materialRequisition.findMany.mockResolvedValue([
      { ...WAITING, items: [{ itemId: 'item-chilli', quantity: 5 }] },
    ]);

    await listener.handleGoodsReceived(EVENT);

    expect(prismaMock.warehouseStock.findMany).not.toHaveBeenCalled();
    expect(prismaMock.materialRequisition.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing for a fully rejected receipt — nothing reached the shelf', async () => {
    await listener.handleGoodsReceived({ ...EVENT, status: 'REJECTED' });
    expect(prismaMock.materialRequisition.findMany).not.toHaveBeenCalled();
  });

  it('swallows its own failure so a completed goods receipt is never rolled back', async () => {
    prismaMock.warehouseStock.findMany.mockRejectedValue(new Error('db down'));
    await expect(listener.handleGoodsReceived(EVENT)).resolves.toBeUndefined();
  });
});
