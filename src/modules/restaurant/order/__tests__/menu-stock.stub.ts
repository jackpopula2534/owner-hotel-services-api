import { MenuStockService } from '../../menu/menu-stock.service';

/**
 * OrderService เรียก MenuStockService ทุกครั้งที่เปิดบิล/เพิ่มรายการ/ปิดบิล
 * สเปกที่ไม่ได้ทดสอบเรื่องสต๊อกจึงต้องมีตัวแทนที่ "ปล่อยผ่าน" ไว้เสมอ
 * ไม่งั้นจะกลายเป็นว่าสต๊อกกั้นบิลอยู่เงียบ ๆ ในเทสต์เรื่องอื่น
 */
export type MenuStockStub = {
  assertCanSell: jest.Mock;
  deductForOrder: jest.Mock;
  deductPlacedLines: jest.Mock;
  returnPlacedLines: jest.Mock;
  hasInventoryAddon: jest.Mock;
};

export function buildMenuStockStub(): MenuStockStub {
  return {
    assertCanSell: jest.fn().mockResolvedValue(undefined),
    deductForOrder: jest.fn().mockResolvedValue(undefined),
    deductPlacedLines: jest.fn().mockResolvedValue(undefined),
    returnPlacedLines: jest.fn().mockResolvedValue(undefined),
    hasInventoryAddon: jest.fn().mockResolvedValue(false),
  };
}

export const menuStockProvider = (stub: MenuStockStub = buildMenuStockStub()) => ({
  provide: MenuStockService,
  useValue: stub,
});
