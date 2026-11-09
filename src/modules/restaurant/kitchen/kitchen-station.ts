/**
 * Kitchen display stations. A dish is made at one of them:
 *   KITCHEN — อาหารต้องปรุง (ครัวร้อน)
 *   BAR     — เครื่องดื่มชง
 * Ready-made items (MenuItem.itemKind = READY_MADE) are not made anywhere —
 * the display shows them as "สำเร็จรูป" (pick and serve).
 */
export const KITCHEN_STATIONS = ['KITCHEN', 'BAR'] as const;
export type KitchenStation = (typeof KITCHEN_STATIONS)[number];

/** Item override → category setting → category revenue type (BEVERAGE → BAR). */
export function resolveKitchenStation(item: {
  kitchenStation?: string | null;
  category?: { kitchenStation?: string | null; revenueType?: string | null } | null;
}): KitchenStation {
  const pick = (v?: string | null): KitchenStation | null =>
    (KITCHEN_STATIONS as readonly string[]).includes(v ?? '') ? (v as KitchenStation) : null;
  return (
    pick(item.kitchenStation) ??
    pick(item.category?.kitchenStation) ??
    (item.category?.revenueType === 'BEVERAGE' ? 'BAR' : 'KITCHEN')
  );
}
