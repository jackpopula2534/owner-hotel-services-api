import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AddonService } from '../../../addons/addon.service';
import { IntegrationsService } from '../../../integrations/integrations.service';
import { InventoryEventListener } from '../inventory-event.listener';
import { RestaurantOrderCompletedEvent } from '../inventory.events';

/**
 * Locks in the loose-coupling contract: the restaurant/kitchen system must run
 * standalone. When a tenant has NO inventory sub-system (INVENTORY_MODULE off),
 * completing an order must be a no-op here — no warehouse lookup, no stock
 * movement, no throw — so ordering keeps working without any คลัง.
 */
describe('InventoryEventListener — restaurant order completed', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let addonMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let integrationsMock: any;
  let listener: InventoryEventListener;

  const TENANT_ID = 'tenant-1';

  const makeTxMock = () => ({
    warehouseStock: { findUnique: jest.fn(), update: jest.fn() },
    stockMovement: { create: jest.fn() },
  });

  const baseEvent = (): RestaurantOrderCompletedEvent => ({
    orderId: 'ord-1',
    tenantId: TENANT_ID,
    restaurantId: 'rest-1',
    propertyId: 'prop-1',
    items: [{ menuItemId: 'mi-1', quantity: 3 }],
    completedBy: 'user-1',
  });

  beforeEach(async () => {
    prismaMock = {
      warehouse: { findFirst: jest.fn() },
      menuItemRecipe: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    addonMock = { hasActiveAddon: jest.fn() };
    // Integration Hub gate — default ON (connection enabled) unless a test overrides it.
    integrationsMock = { isEnabled: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryEventListener,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AddonService, useValue: addonMock },
        { provide: IntegrationsService, useValue: integrationsMock },
      ],
    }).compile();

    listener = module.get<InventoryEventListener>(InventoryEventListener);
  });

  it('is a NO-OP when the tenant has no INVENTORY_MODULE (restaurant runs standalone)', async () => {
    addonMock.hasActiveAddon.mockResolvedValue(false);

    await expect(listener.handleRestaurantOrderCompleted(baseEvent())).resolves.toBeUndefined();

    expect(addonMock.hasActiveAddon).toHaveBeenCalledWith(TENANT_ID, 'INVENTORY_MODULE');
    // No stock work whatsoever — no warehouse lookup, no transaction
    expect(prismaMock.warehouse.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.menuItemRecipe.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('is a NO-OP when the connection is turned OFF in the Integration Hub', async () => {
    addonMock.hasActiveAddon.mockResolvedValue(true); // has inventory...
    integrationsMock.isEnabled.mockResolvedValue(false); // ...but connection disabled

    await expect(listener.handleRestaurantOrderCompleted(baseEvent())).resolves.toBeUndefined();

    expect(integrationsMock.isEnabled).toHaveBeenCalledWith(
      TENANT_ID,
      'restaurant-inventory-autodeduct',
    );
    expect(prismaMock.warehouse.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('skips (no throw) when inventory is on but no kitchen warehouse exists', async () => {
    addonMock.hasActiveAddon.mockResolvedValue(true);
    prismaMock.warehouse.findFirst.mockResolvedValue(null); // no warehouse of any kind

    await expect(listener.handleRestaurantOrderCompleted(baseEvent())).resolves.toBeUndefined();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('skips when order has no stock-linked recipes', async () => {
    addonMock.hasActiveAddon.mockResolvedValue(true);
    prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });
    prismaMock.menuItemRecipe.findMany.mockResolvedValue([]); // nothing linked to คลัง

    await expect(listener.handleRestaurantOrderCompleted(baseEvent())).resolves.toBeUndefined();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('deducts linked ingredients from kitchen warehouse when inventory is enabled', async () => {
    addonMock.hasActiveAddon.mockResolvedValue(true);
    prismaMock.warehouse.findFirst.mockResolvedValue({ id: 'wh-1' });
    prismaMock.menuItemRecipe.findMany.mockResolvedValue([
      {
        menuItemId: 'mi-1',
        servings: 1,
        ingredients: [
          {
            itemId: 'item-1',
            quantity: 2, // per batch (servings=1) → 2 per plate
            wastagePercent: 0,
            name: 'Shrimp',
            item: { id: 'item-1', name: 'Shrimp', sku: 'SH-01' },
          },
        ],
      },
    ]);

    const tx = makeTxMock();
    tx.warehouseStock.findUnique.mockResolvedValue({ quantity: 10, avgCost: 5 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await listener.handleRestaurantOrderCompleted(baseEvent()); // order qty = 3

    // 2 per plate × 3 plates × (1 + 0%) = 6, clamped by stock 10 → deduct 6
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'GOODS_ISSUE',
          quantity: 6,
          itemId: 'item-1',
          warehouseId: 'wh-1',
          referenceType: 'restaurant_order',
          referenceId: 'ord-1',
        }),
      }),
    );
    expect(tx.warehouseStock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: 4 }), // 10 − 6
      }),
    );
  });
});
