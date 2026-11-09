import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { IntegrationsService } from '@/modules/integrations/integrations.service';
import { SourceWarehouseResolver } from '../warehouses/source-warehouse.resolver';
import { WarehouseIssueService } from '../warehouses/warehouse-issue.service';
import { RestaurantOrderCompletedEvent } from './inventory.events';
import { convertToStockUnit, round6 } from '../common/unit-conversion';

/** หนึ่งบรรทัดที่จะตัดออกจากคลัง — คิดให้เสร็จก่อนเปิด transaction */
export interface StockIssueLine {
  itemId: string;
  quantity: number;
  /** ชื่อที่เอาไปเขียนใน notes ให้คนอ่านสมุดเข้าใจว่าตัดเพราะอะไร */
  label: string;
  kind: 'retail' | 'recipe';
  /**
   * ปริมาณจริงตามสูตร (มีทศนิยมได้ อยู่ในหน่วยสต็อกแล้ว) — เฉพาะ kind='recipe'
   * quantity จริงที่ตัดคำนวณตอน apply จากเศษสะสม (RecipeConsumptionResidual)
   */
  exactQty?: number;
  /**
   * คลังที่จะไปหักของชิ้นนี้ — ไม่ระบุแปลว่าใช้คลังตั้งต้นของร้าน
   *
   * ต้องเป็นรายบรรทัดเพราะของแต่ละอย่างไม่ได้อยู่คลังเดียวกันทั้งบิล
   * (น้ำอัดลมอยู่คลังร้านขายของ ส่วนวัตถุดิบอยู่คลังครัว)
   */
  warehouseId?: string | null;
}

/**
 * ตัดสต๊อกคลังกลางเมื่อปิดบิลร้านอาหาร
 *
 * สองเส้นทางที่ต่างกันโดยเจตนา:
 *
 *   ของสำเร็จรูป (MenuItem.inventoryItemId)  ตัด 1:1 — **ไม่ผ่านสวิตช์ Integration Hub**
 *   วัตถุดิบตามสูตร (MenuItemRecipe)          ตัดตามสูตร — ผ่านสวิตช์ตามเดิม
 *
 * เหตุผลที่แยก: การผูกเมนูกับสินค้าในคลัง *คือ* การประกาศว่า "ยอดของเมนูนี้อยู่ที่คลัง"
 * ถ้ายังต้องไปเปิดสวิตช์อีกชั้น ยอดที่ POS โชว์จะไม่ตรงกับคลังตั้งแต่บิลแรกที่ขาย
 * ส่วนการตัดวัตถุดิบตามสูตรเป็นการ "เดาปริมาณจากสูตร" จึงยังควรให้ผู้ใช้เปิดเอง
 */
@Injectable()
export class RestaurantStockDeductionService {
  private readonly logger = new Logger(RestaurantStockDeductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
    private readonly sourceWarehouse: SourceWarehouseResolver,
    private readonly warehouseIssue: WarehouseIssueService,
  ) {}

  /**
   * ตัดวัตถุดิบตามสูตรไหม — ร้านที่ตั้งค่าเองชนะ, ไม่ตั้ง (null) = ตามสวิตช์ Integration Hub
   *
   * ต้องตั้งรายร้านได้เพราะความพร้อมของสูตรไม่เท่ากัน: ห้องอาหารผูกวัตถุดิบครบแล้ว
   * แต่บาร์ยังพิมพ์สูตรลอย ๆ — เปิดทั้งกิจการพร้อมกันจะทำให้ยอดบาร์เพี้ยน
   */
  async isRecipeDeductionEnabled(tenantId: string, restaurantId?: string): Promise<boolean> {
    if (restaurantId) {
      const restaurant = await this.prisma.restaurant.findFirst({
        where: { id: restaurantId, tenantId },
        select: { recipeStockDeduction: true } as never,
      });
      const own = (restaurant as { recipeStockDeduction?: boolean | null } | null)
        ?.recipeStockDeduction;
      if (own === true || own === false) return own;
    }
    return this.integrationsService.isEnabled(tenantId, 'restaurant-inventory-autodeduct');
  }

  /**
   * คลังต้นทางของร้านนี้ — ตอบด้วยตัวเดียวกับที่ตัวย้ายเข้าคลังและตัวกันขายเกินใช้
   *
   * น้ำขวดที่ lobby bar ไม่ได้มาจากคลังครัว การเดาว่าเป็น KITCHEN เสมอทำให้ตัดผิดคลัง
   * แล้วยอดเพี้ยนสองที่พร้อมกัน (คลังบาร์ไม่ลด คลังครัวลดทั้งที่ไม่ได้ขาย)
   */
  resolveWarehouseId(event: RestaurantOrderCompletedEvent): Promise<string | null> {
    return this.sourceWarehouse.resolve(event.tenantId, event.restaurantId);
  }

  /**
   * คิดว่าต้องตัดอะไรบ้าง — อ่านอย่างเดียว ทำนอก transaction
   * เพื่อให้ transaction ที่ล็อกแถวสั้นที่สุด และเพื่อให้บิลที่ไม่มีอะไรต้องตัด
   * ไม่ต้องเปิด transaction เปล่า ๆ ทิ้งไว้
   */
  async planDeduction(
    event: RestaurantOrderCompletedEvent,
    recipesEnabled: boolean,
  ): Promise<StockIssueLine[]> {
    const totals = new Map<string, number>();
    for (const line of event.items ?? []) {
      if (!line.menuItemId || line.quantity <= 0) continue;
      totals.set(line.menuItemId, (totals.get(line.menuItemId) ?? 0) + line.quantity);
    }
    if (!totals.size) return [];

    const lines: StockIssueLine[] = [];

    // ── ของสำเร็จรูปที่ผูกสินค้าคลังไว้ 1:1 ──
    const linked = await this.prisma.menuItem.findMany({
      where: {
        id: { in: [...totals.keys()] },
        tenantId: event.tenantId,
        inventoryItemId: { not: null },
      },
      select: {
        id: true,
        name: true,
        inventoryItemId: true,
        inventoryItem: { select: { name: true } },
      },
    });

    for (const menuItem of linked) {
      const quantity = totals.get(menuItem.id) ?? 0;
      // เมนูที่ผูกคลังแล้วไม่ต้องคิดสูตรซ้ำ — ยอดอยู่ที่สินค้าตัวเดียว
      totals.delete(menuItem.id);
      if (quantity <= 0 || !menuItem.inventoryItemId) continue;
      lines.push({
        itemId: menuItem.inventoryItemId,
        quantity,
        label: menuItem.inventoryItem?.name ?? menuItem.name,
        kind: 'retail',
        // ตัวเดียวกับที่ตอนกดสั่งใช้อ่านยอดมากันขายเกิน — ถ้าตอบคนละคลัง
        // จะกลายเป็นกันไว้ที่ใบหนึ่งแล้วไปหักอีกใบหนึ่ง
        warehouseId: await this.sourceWarehouse.resolveForItem(
          event.tenantId,
          event.restaurantId,
          menuItem.inventoryItemId,
        ),
      });
    }

    if (!recipesEnabled || !totals.size) return lines;

    // ── วัตถุดิบตามสูตร ──
    const recipes = await this.prisma.menuItemRecipe.findMany({
      where: {
        menuItemId: { in: [...totals.keys()] },
        ingredients: { some: { itemId: { not: null } } },
      },
      include: {
        ingredients: {
          where: { itemId: { not: null } },
          include: { item: { select: { name: true, unit: true } } },
        },
      },
    });

    // รวมของชนิดเดียวกันทั้งบิลก่อน (หลายเมนูใช้ไข่เหมือนกัน) แล้วค่อยไปปัดตอนตัด
    const byItem = new Map<string, { exact: number; label: string }>();
    for (const recipe of recipes) {
      const orderedQty = totals.get(recipe.menuItemId) ?? 0;
      if (orderedQty <= 0) continue;

      // ปริมาณในสูตรเก็บไว้ต่อ "หนึ่งชุด" (servings จาน) ต่อจานจึงต้องหารก่อน
      const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;

      for (const ingredient of recipe.ingredients) {
        if (!ingredient.itemId) continue;
        const perPlate = Number(ingredient.quantity ?? 0) / servings;
        const wastageMultiplier = 1 + Number(ingredient.wastagePercent ?? 0) / 100;
        const used = perPlate * orderedQty * wastageMultiplier;
        if (used <= 0) continue;

        // สูตรเขียน 150 กรัม แต่คลังเก็บเป็น KG → ต้องเป็น 0.15 ไม่ใช่ 150
        const conv = convertToStockUnit(used, ingredient.unit, ingredient.item?.unit);
        if (!conv.ok) {
          this.logger.warn(
            `Skip recipe deduction for "${ingredient.item?.name ?? ingredient.name}" ` +
              `(order ${event.orderId}): ${conv.reason}`,
          );
          continue;
        }
        const prev = byItem.get(ingredient.itemId);
        byItem.set(ingredient.itemId, {
          exact: (prev?.exact ?? 0) + conv.quantity,
          label: ingredient.item?.name ?? ingredient.name,
        });
      }
    }

    for (const [itemId, { exact, label }] of byItem) {
      const exactQty = round6(exact);
      if (exactQty <= 0) continue;
      lines.push({ itemId, quantity: 0, exactQty, label, kind: 'recipe' });
    }

    return lines;
  }

  /** ลงมือตัดจริง — ต้องอยู่ใน transaction เดียวกันทั้งชุด */
  async applyPlan(
    tx: Prisma.TransactionClient,
    event: RestaurantOrderCompletedEvent,
    warehouseId: string,
    lines: StockIssueLine[],
  ): Promise<void> {
    for (const line of lines) {
      if (line.kind === 'recipe' && line.exactQty !== undefined) {
        const quantity = await this.takeWholeUnits(
          tx,
          event.tenantId,
          line.warehouseId ?? warehouseId,
          line.itemId,
          line.exactQty,
        );
        if (quantity <= 0) continue; // ยังไม่ครบ 1 หน่วย — เก็บเป็นเศษไว้ก่อน
        await this.issue(tx, event, warehouseId, { ...line, quantity });
        continue;
      }
      await this.issue(tx, event, warehouseId, line);
    }
  }

  /**
   * สต็อกเป็นจำนวนเต็ม แต่สูตรใช้เป็นเศษ (ข้าว 0.15 KG/จาน)
   *
   * เดิมปัดขึ้นทุกบิล → ขาย 1 จานหักข้าว 1 กิโล. ตอนนี้สะสมเศษต่อ (คลัง, สินค้า)
   * แล้วตัดเฉพาะส่วนที่ครบหน่วย: 7 จาน = 1.05 KG → ตัด 1 เหลือเศษ 0.05 ไว้บิลหน้า
   * ยอดตัดรวมจึงตรงกับที่ใช้จริงเสมอ ต่างกันไม่เกิน 1 หน่วยต่อสินค้า
   *
   * ใช้ increment/decrement เพื่อให้สองบิลที่ปิดพร้อมกันไม่ทับเศษกัน
   */
  private async takeWholeUnits(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    itemId: string,
    exactQty: number,
  ): Promise<number> {
    const residuals = residualDelegate(tx);
    const existing = await residuals.findFirst({
      where: { tenantId, warehouseId, itemId },
      select: { id: true },
    });
    let id: string;
    let total: number;
    if (existing) {
      const updated = await residuals.update({
        where: { id: existing.id },
        data: { pendingQty: { increment: exactQty } },
        select: { id: true, pendingQty: true },
      });
      id = updated.id;
      total = Number(updated.pendingQty);
    } else {
      const created = await residuals.create({
        data: { tenantId, warehouseId, itemId, pendingQty: exactQty },
        select: { id: true, pendingQty: true },
      });
      id = created.id;
      total = Number(created.pendingQty);
    }

    const whole = Math.floor(round6(total));
    if (whole > 0) {
      await residuals.update({
        where: { id },
        data: { pendingQty: { decrement: whole } },
        select: { id: true, pendingQty: true },
      });
    }
    return whole;
  }

  /**
   * เขียนใบเบิก + อัปเดตยอดคงเหลือ
   *
   * ตัวเขียนจริงอยู่ที่ WarehouseIssueService — ที่เดียวกับที่ตอนกดสั่งใช้ตัดของสำเร็จรูป
   * เพื่อให้สองจังหวะที่ของออกจากคลังเขียนสมุดแบบเดียวกันเป๊ะ ๆ
   */
  private async issue(
    tx: Prisma.TransactionClient,
    event: RestaurantOrderCompletedEvent,
    warehouseId: string,
    line: StockIssueLine,
  ): Promise<void> {
    const { itemId, quantity, label, kind } = line;
    // บรรทัดที่รู้คลังของตัวเองมาก่อน (ของสำเร็จรูป) — ที่เหลือใช้คลังตั้งต้นของร้าน
    const targetWarehouseId = line.warehouseId ?? warehouseId;

    await this.warehouseIssue.issue(tx, {
      tenantId: event.tenantId,
      warehouseId: targetWarehouseId,
      itemId,
      quantity,
      referenceType: 'restaurant_order',
      referenceId: event.orderId,
      notes: `Auto-deduct (${kind}): ${label} x${quantity} for order ${event.orderId}`,
      createdBy: event.completedBy,
      label,
    });
  }
}

/**
 * RecipeConsumptionResidual เป็นตารางใหม่ — Prisma client ในเครื่องจะมี type หลังรัน
 * `prisma generate` เท่านั้น จึงเข้าผ่าน interface แคบ ๆ ตัวนี้แทน
 */
interface ResidualRow {
  id: string;
  pendingQty: unknown;
}
interface ResidualDelegate {
  findFirst(args: unknown): Promise<{ id: string } | null>;
  create(args: unknown): Promise<ResidualRow>;
  update(args: unknown): Promise<ResidualRow>;
}
function residualDelegate(tx: Prisma.TransactionClient): ResidualDelegate {
  return (tx as unknown as { recipeConsumptionResidual: ResidualDelegate })
    .recipeConsumptionResidual;
}
