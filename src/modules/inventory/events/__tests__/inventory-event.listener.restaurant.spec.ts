import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AddonService } from '../../../addons/addon.service';
import { IntegrationsService } from '../../../integrations/integrations.service';
import { InventoryEventListener } from '../inventory-event.listener';
import { RestaurantStockDeductionService } from '../restaurant-stock-deduction.service';
import { RestaurantOrderCompletedEvent } from '../inventory.events';

/**
 * ข้อตกลงระดับ "ใครสั่งให้ตัด" — คณิตศาสตร์ของการตัดอยู่ในสเปกของ service
 *
 * สองข้อที่ล็อกไว้ตรงนี้:
 *   1. ไม่มี INVENTORY_MODULE → เงียบสนิท ร้านอาหารต้องขายได้โดยไม่ต้องมีคลัง
 *   2. สวิตช์ Integration Hub ปิด → ของสำเร็จรูปที่ผูกคลังไว้ยัง **ตัดตามปกติ**
 *      ปิดได้เฉพาะการเดาปริมาณวัตถุดิบจากสูตรเท่านั้น
 */
describe('InventoryEventListener — restaurant order completed', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let addonMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deductionMock: any;
  let listener: InventoryEventListener;

  const TENANT_ID = 'tenant-1';

  const baseEvent = (): RestaurantOrderCompletedEvent => ({
    orderId: 'ord-1',
    tenantId: TENANT_ID,
    restaurantId: 'rest-1',
    propertyId: 'prop-1',
    items: [{ menuItemId: 'mi-1', quantity: 3 }],
    completedBy: 'user-1',
  });

  const RETAIL_LINE = { itemId: 'item-water', quantity: 3, label: 'น้ำดื่ม', kind: 'retail' as const };

  beforeEach(async () => {
    prismaMock = {
      // ผู้เรียกส่ง callback เข้ามา — เรียกด้วย tx ปลอมให้เห็นว่า applyPlan ได้ tx จริง
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({ tx: true })),
    };
    addonMock = { hasActiveAddon: jest.fn().mockResolvedValue(true) };
    deductionMock = {
      isRecipeDeductionEnabled: jest.fn().mockResolvedValue(true),
      planDeduction: jest.fn().mockResolvedValue([RETAIL_LINE]),
      resolveWarehouseId: jest.fn().mockResolvedValue('wh-1'),
      applyPlan: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryEventListener,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AddonService, useValue: addonMock },
        // ยังต้องมี — handler ของแม่บ้าน/ซ่อมบำรุงในคลาสเดียวกันใช้สวิตช์ Hub อยู่
        { provide: IntegrationsService, useValue: { isEnabled: jest.fn() } },
        { provide: RestaurantStockDeductionService, useValue: deductionMock },
      ],
    }).compile();

    listener = module.get<InventoryEventListener>(InventoryEventListener);
  });

  it('is a NO-OP when the tenant has no INVENTORY_MODULE add-on', async () => {
    addonMock.hasActiveAddon.mockResolvedValue(false);

    await listener.handleRestaurantOrderCompleted(baseEvent());

    expect(deductionMock.planDeduction).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('still deducts linked ready-made goods when the Integration Hub connection is OFF', async () => {
    deductionMock.isRecipeDeductionEnabled.mockResolvedValue(false);

    await listener.handleRestaurantOrderCompleted(baseEvent());

    // สวิตช์ปิด → planDeduction ถูกบอกว่า "ไม่ต้องคิดสูตร" แต่ยังต้องถูกเรียก
    expect(deductionMock.planDeduction).toHaveBeenCalledWith(expect.anything(), false);
    expect(deductionMock.applyPlan).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'wh-1',
      [RETAIL_LINE],
    );
  });

  it('passes the recipe flag through when the connection is ON', async () => {
    await listener.handleRestaurantOrderCompleted(baseEvent());

    expect(deductionMock.planDeduction).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('skips entirely when nothing in the order is linked to the warehouse', async () => {
    deductionMock.planDeduction.mockResolvedValue([]);

    await listener.handleRestaurantOrderCompleted(baseEvent());

    // ไม่มีอะไรต้องตัด → ห้ามเปิด transaction เปล่า และไม่ต้องไปหาคลังด้วยซ้ำ
    expect(deductionMock.resolveWarehouseId).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('skips when the property has no usable warehouse', async () => {
    deductionMock.resolveWarehouseId.mockResolvedValue(null);

    await listener.handleRestaurantOrderCompleted(baseEvent());

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(deductionMock.applyPlan).not.toHaveBeenCalled();
  });

  it('skips an order with no items', async () => {
    await listener.handleRestaurantOrderCompleted({ ...baseEvent(), items: [] });

    expect(deductionMock.planDeduction).not.toHaveBeenCalled();
  });

  it('applies the plan inside a single transaction', async () => {
    await listener.handleRestaurantOrderCompleted(baseEvent());

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(deductionMock.applyPlan).toHaveBeenCalledWith(
      { tx: true },
      expect.objectContaining({ orderId: 'ord-1' }),
      'wh-1',
      [RETAIL_LINE],
    );
  });

  it('swallows deduction failures so completing the bill never fails', async () => {
    deductionMock.applyPlan.mockRejectedValue(new Error('deadlock'));

    await expect(listener.handleRestaurantOrderCompleted(baseEvent())).resolves.toBeUndefined();
  });
});
