/**
 * ช่องทาง (ระบบ) ที่มองเห็นคลัง — ผูกผ่านกลุ่มคลัง
 *
 * กติกา: คลังที่ไม่มีกลุ่ม หรือกลุ่มถูกปิดใช้งาน = แสดงทุกระบบ (พฤติกรรมเดิม)
 * คลังที่อยู่ในกลุ่มที่เปิดใช้งาน = แสดงเฉพาะระบบที่กลุ่มเลือกไว้
 */
export const WAREHOUSE_CHANNELS = ['POS'] as const;
export type WarehouseChannel = (typeof WAREHOUSE_CHANNELS)[number];

export interface ChannelGroupLike {
  channels: unknown;
  isActive: boolean;
}

export function parseChannels(raw: unknown): WarehouseChannel[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is WarehouseChannel =>
    (WAREHOUSE_CHANNELS as readonly string[]).includes(c as string),
  );
}

export function isVisibleOnChannel(
  group: ChannelGroupLike | null | undefined,
  channel: WarehouseChannel,
): boolean {
  if (!group || !group.isActive) return true;
  return parseChannels(group.channels).includes(channel);
}
