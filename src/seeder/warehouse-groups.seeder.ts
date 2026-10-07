import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WarehouseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface GroupDef {
  code: string;
  name: string;
  description: string;
  channels: string[];
  sortOrder: number;
  /** จับคลังด้วยรหัส — ใช้แยกคลังประเภท GENERAL ที่ทำหน้าที่ต่างกัน (ร้านขายของ vs คลังกลาง) */
  warehouseCodes: string[];
  /** จับคลังด้วยประเภท — ครอบคลุมคลังที่ตั้งรหัสเอง เช่น คลังครัวสาขาใหม่ */
  warehouseTypes: WarehouseType[];
}

/**
 * กลุ่มคลังตั้งต้น — แยกคลังขายหน้าร้านออกจากคลังปฏิบัติการ
 * POS เห็นแค่ "หน้าร้าน / POS" (คลังที่ไม่มีกลุ่มยังเห็นทุกระบบเหมือนเดิม)
 * คลังของแถมต้องมีกลุ่มของตัวเอง ไม่งั้นหน้าจัดกลุ่มจะโชว์ว่า "ไม่มีกลุ่ม = แสดงใน POS" ซึ่งไม่จริง
 */
const DEFAULT_GROUPS: GroupDef[] = [
  {
    code: 'GRP-POS',
    name: 'หน้าร้าน / POS',
    description: 'คลังที่ขายผ่านหน้าร้าน POS',
    channels: ['POS'],
    sortOrder: 0,
    warehouseCodes: ['WH-RETAIL', 'WH-MINIBAR'],
    warehouseTypes: [WarehouseType.MINIBAR],
  },
  {
    code: 'GRP-OPS',
    name: 'คลังปฏิบัติการ',
    description: 'คลังใช้ภายใน (ครัว แม่บ้าน ช่าง คลังกลาง) — ไม่แสดงใน POS',
    channels: [],
    sortOrder: 1,
    warehouseCodes: ['WH-MAIN', 'WH-KITCH', 'WH-HK', 'WH-MAINT'],
    warehouseTypes: [WarehouseType.KITCHEN, WarehouseType.HOUSEKEEPING, WarehouseType.MAINTENANCE],
  },
  {
    code: 'GRP-GIFT',
    name: 'คลังของแถม',
    description: 'ของที่กันไว้แจกในโปรโมชั่น — ตัดผ่านโปรเท่านั้น ไม่แสดงใน POS',
    channels: [],
    sortOrder: 2,
    warehouseCodes: ['WH-GIFT'],
    warehouseTypes: [WarehouseType.PROMOTION],
  },
];

@Injectable()
export class WarehouseGroupsSeeder {
  private readonly logger = new Logger(WarehouseGroupsSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async seed(): Promise<void> {
    const tenants = await this.prisma.warehouse.findMany({
      where: { deletedAt: null },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    for (const { tenantId } of tenants) {
      for (const def of DEFAULT_GROUPS) {
        const groupId = await this.ensureGroup(tenantId, def);
        // จัดเฉพาะคลังที่ยังไม่มีกลุ่ม — คลังที่ผู้ใช้ย้ายกลุ่มไปแล้วห้ามดึงกลับ
        const { count } = await this.prisma.warehouse.updateMany({
          where: {
            tenantId,
            deletedAt: null,
            groupId: null,
            OR: [{ code: { in: def.warehouseCodes } }, { type: { in: def.warehouseTypes } }],
          },
          data: { groupId },
        });
        if (count) this.logger.log(`  ✓ Warehouse group ${def.name}: +${count} คลัง (tenant ${tenantId})`);
      }
    }
  }

  /** สร้างกลุ่มถ้ายังไม่มี — กลุ่มที่มีอยู่แล้วอาจถูกผู้ใช้ปรับ (ชื่อ/POS) ห้ามทับ */
  private async ensureGroup(tenantId: string, def: GroupDef): Promise<string> {
    const existing = await this.prisma.warehouseGroup.findFirst({
      where: { tenantId, code: def.code },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.warehouseGroup.create({
      data: {
        tenantId,
        code: def.code,
        name: def.name,
        description: def.description,
        channels: def.channels as Prisma.InputJsonValue,
        sortOrder: def.sortOrder,
      },
      select: { id: true },
    });
    return created.id;
  }
}
