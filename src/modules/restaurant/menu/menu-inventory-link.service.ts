import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export type MenuInventoryLinkAction = 'LINK' | 'RELINK' | 'UNLINK';

export interface MenuInventoryLinkLogRow {
  id: string;
  action: MenuInventoryLinkAction;
  fromInventoryItemId: string | null;
  fromItemName: string | null;
  fromItemSku: string | null;
  toInventoryItemId: string | null;
  toItemName: string | null;
  toItemSku: string | null;
  reason: string | null;
  note: string | null;
  changedById: string | null;
  changedByName: string | null;
  createdAt: Date;
}

export interface RelinkInventoryInput {
  inventoryItemId: string;
  reason: string;
}

type Db = PrismaService | Prisma.TransactionClient;

/**
 * เปลี่ยนสินค้าในคลังที่เมนูผูกอยู่ + ประวัติการผูกทุกครั้ง
 *
 * ทำไมต้องเป็นขั้นตอนแยกจาก "ถอดออกจากคลัง": ถอดแล้วผูกใหม่ = ระหว่างนั้นเมนูกลายเป็น
 * นับเอง/ขายไม่จำกัด และของถูกเบิกออกจากคลังมาที่เมนูโดยไม่จำเป็น การเปลี่ยนตรง ๆ
 * ไม่ขยับสต็อกเลย — ของเดิมยังอยู่ที่สินค้าตัวเดิมในคลัง ขายต่อจากนี้ตัดจากตัวใหม่
 *
 * ห้ามเปลี่ยนตอนมีบิลค้าง: บรรทัดในบิลที่ยังไม่ปิดอาจตัดสต็อกไปแล้วตอนสั่ง (คืนตอนยกเลิก)
 * หรือจะตัดตอนปิดบิล — ทั้งสองทางอ่าน inventoryItemId ของเมนู ณ ตอนนั้น เปลี่ยนกลางทาง
 * = ตัดตัวหนึ่งแต่คืนอีกตัวหนึ่ง
 */
@Injectable()
export class MenuInventoryLinkService {
  private readonly logger = new Logger(MenuInventoryLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  async relink(
    restaurantId: string,
    menuItemId: string,
    dto: RelinkInventoryInput,
    tenantId: string,
    userId?: string,
  ) {
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 3) {
      throw new BadRequestException('ระบุเหตุผลที่เปลี่ยนสินค้าที่ผูก (อย่างน้อย 3 ตัวอักษร)');
    }

    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, restaurantId, tenantId },
      select: { id: true, name: true, inventoryItemId: true },
    });
    if (!menuItem) throw new NotFoundException(`Menu item ${menuItemId} not found`);
    if (!menuItem.inventoryItemId) {
      throw new ConflictException(
        'เมนูนี้ยังไม่ได้ผูกกับสินค้าในคลัง — เลือกสินค้าที่ฟอร์มแก้ไขเมนูได้เลย',
      );
    }
    if (menuItem.inventoryItemId === dto.inventoryItemId) {
      throw new BadRequestException('เลือกสินค้าตัวเดิม — ไม่มีอะไรเปลี่ยน');
    }

    const [from, to] = await Promise.all([
      this.prisma.inventoryItem.findFirst({
        where: { id: menuItem.inventoryItemId, tenantId },
        select: { id: true, name: true, sku: true },
      }),
      this.prisma.inventoryItem.findFirst({
        where: { id: dto.inventoryItemId, tenantId, isActive: true, deletedAt: null },
        select: { id: true, name: true, sku: true, itemType: true },
      }),
    ]);
    if (!to) throw new BadRequestException('ไม่พบสินค้าที่เลือกในคลัง (หรือถูกปิดใช้งานแล้ว)');
    if (to.itemType !== 'FINISHED_GOOD') {
      throw new BadRequestException(
        `"${to.name}" เป็นวัตถุดิบ — เมนูขายตรงต้องผูกกับสินค้าสำเร็จรูป (เปลี่ยนชนิดสินค้าที่คลังก่อน)`,
      );
    }

    const openLines = await this.prisma.orderItem.count({
      where: {
        tenantId,
        menuItemId: menuItem.id,
        status: { not: 'CANCELLED' },
        order: { tenantId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      },
    });
    if (openLines > 0) {
      throw new ConflictException(
        `มีบิลที่ยังไม่ปิดสั่งเมนูนี้อยู่ ${openLines} รายการ — ปิดหรือยกเลิกบิลก่อนเปลี่ยน ` +
          'เพราะของในบิลนั้นตัด/คืนกับสินค้าตัวเดิม',
      );
    }

    const changedByName = await this.resolveActorName(userId, tenantId);
    await this.prisma.$transaction(async (tx) => {
      await tx.menuItem.update({
        where: { id: menuItem.id },
        // ผูกคลังแล้วยอดเป็นของคลังเสมอ — กันค่าค้างจากการนับในเมนู
        data: { inventoryItemId: to.id, trackStock: false, stockQty: 0 },
      });
      await this.writeLog(tx, {
        tenantId,
        menuItemId: menuItem.id,
        action: 'RELINK',
        from,
        to,
        reason,
        note: 'สต็อกไม่ย้าย — ของเดิมยังอยู่ที่สินค้าตัวเดิมในคลัง ขายต่อจากนี้ตัดจากสินค้าตัวใหม่',
        changedById: userId ?? null,
        changedByName,
      });
    });

    this.logger.log(
      `Relinked menu item ${menuItem.id} from inventory item ${from?.id ?? '?'} to ${to.id}`,
    );
    return {
      menuItemId: menuItem.id,
      inventoryItemId: to.id,
      inventoryItem: { id: to.id, name: to.name, sku: to.sku },
    };
  }

  async history(
    restaurantId: string,
    menuItemId: string,
    tenantId: string,
  ): Promise<MenuInventoryLinkLogRow[]> {
    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, restaurantId, tenantId },
      select: { id: true },
    });
    if (!menuItem) throw new NotFoundException(`Menu item ${menuItemId} not found`);
    return logDelegate(this.prisma).findMany({
      where: { tenantId, menuItemId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * บันทึกประวัติจากเส้นทางอื่น (สร้าง/แก้เมนู, ย้ายเข้าคลัง, ถอดออก)
   * พังแล้วไม่ล้มงานหลัก แต่ log error ให้เห็น — ประวัติขาดคือปัญหาตรวจย้อนหลัง
   */
  async record(
    input: {
      tenantId: string;
      menuItemId: string;
      action: MenuInventoryLinkAction;
      fromInventoryItemId?: string | null;
      toInventoryItemId?: string | null;
      reason?: string | null;
      note?: string | null;
      userId?: string | null;
    },
    db: Db = this.prisma,
  ): Promise<void> {
    try {
      const ids = [input.fromInventoryItemId, input.toInventoryItemId].filter((id): id is string =>
        Boolean(id),
      );
      const items = ids.length
        ? await db.inventoryItem.findMany({
            where: { id: { in: ids }, tenantId: input.tenantId },
            select: { id: true, name: true, sku: true },
          })
        : [];
      const byId = new Map(items.map((i) => [i.id, i]));
      await this.writeLog(db, {
        tenantId: input.tenantId,
        menuItemId: input.menuItemId,
        action: input.action,
        from: input.fromInventoryItemId
          ? (byId.get(input.fromInventoryItemId) ?? {
              id: input.fromInventoryItemId,
              name: null,
              sku: null,
            })
          : null,
        to: input.toInventoryItemId
          ? (byId.get(input.toInventoryItemId) ?? {
              id: input.toInventoryItemId,
              name: null,
              sku: null,
            })
          : null,
        reason: input.reason ?? null,
        note: input.note ?? null,
        changedById: input.userId ?? null,
        changedByName: await this.resolveActorName(input.userId ?? undefined, input.tenantId),
      });
    } catch (error) {
      this.logger.error(
        `Failed to record menu inventory link log for ${input.menuItemId}: ${(error as Error).message}`,
      );
    }
  }

  private async writeLog(
    db: Db,
    row: {
      tenantId: string;
      menuItemId: string;
      action: MenuInventoryLinkAction;
      from: { id: string; name: string | null; sku: string | null } | null;
      to: { id: string; name: string | null; sku: string | null } | null;
      reason: string | null;
      note: string | null;
      changedById: string | null;
      changedByName: string | null;
    },
  ): Promise<void> {
    await logDelegate(db).create({
      data: {
        tenantId: row.tenantId,
        menuItemId: row.menuItemId,
        action: row.action,
        fromInventoryItemId: row.from?.id ?? null,
        fromItemName: row.from?.name ?? null,
        fromItemSku: row.from?.sku ?? null,
        toInventoryItemId: row.to?.id ?? null,
        toItemName: row.to?.name ?? null,
        toItemSku: row.to?.sku ?? null,
        reason: row.reason,
        note: row.note,
        changedById: row.changedById,
        changedByName: row.changedByName,
      },
    });
  }

  private async resolveActorName(
    userId: string | undefined,
    tenantId: string,
  ): Promise<string | null> {
    if (!userId) return null;
    try {
      const user = await this.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { firstName: true, lastName: true, email: true },
      });
      if (!user) return null;
      const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      return full || user.email || null;
    } catch {
      return null;
    }
  }
}

/**
 * MenuItemInventoryLinkLog เป็นตารางใหม่ — Prisma client ในเครื่องจะมี type หลังรัน
 * `prisma generate` เท่านั้น จึงเข้าผ่าน interface แคบ ๆ ตัวนี้
 */
interface LinkLogDelegate {
  create(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<MenuInventoryLinkLogRow[]>;
}
function logDelegate(db: Db): LinkLogDelegate {
  return (db as unknown as { menuItemInventoryLinkLog: LinkLogDelegate }).menuItemInventoryLinkLog;
}
