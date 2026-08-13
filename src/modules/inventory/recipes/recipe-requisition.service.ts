import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationsService } from '../../integrations/integrations.service';
import { PlanRecipeRequisitionDto } from './dto/recipe-requisition.dto';
import {
  REQUISITION_INTEGRATION_KEY,
  REQUISITION_OFF_MESSAGE,
  RequisitionLinePlan,
  RequisitionPlan,
  RequisitionWarehouse,
  round3,
} from './requisition.types';

@Injectable()
export class RecipeRequisitionService {
  constructor(
    private prisma: PrismaService,
    private integrations: IntegrationsService,
  ) {}

  /**
   * Turns "I want to be able to cook N plates of these menus" into a draft
   * requisition: what the recipes consume, minus what the kitchen already holds,
   * rounded up to whole units the warehouse can actually issue.
   *
   * Nothing is written — the user edits this, then MaterialRequisitionService
   * turns it into a document.
   */
  async plan(tenantId: string, dto: PlanRecipeRequisitionDto): Promise<RequisitionPlan> {
    await this.assertConnected(tenantId);

    const targets = dto.targets.filter((t) => t.plates > 0);
    if (targets.length === 0) {
      throw new BadRequestException('ยังไม่ได้เลือกเมนูหรือจำนวนจานที่ต้องการ');
    }
    const platesByMenu = new Map(targets.map((t) => [t.menuItemId, t.plates]));

    const menuWhere: any = { tenantId, id: { in: [...platesByMenu.keys()] } };
    if (dto.restaurantId) menuWhere.restaurantId = dto.restaurantId;

    const recipes = await this.prisma.menuItemRecipe.findMany({
      where: { menuItem: menuWhere },
      include: {
        menuItem: { select: { id: true, name: true, restaurantId: true } },
        ingredients: {
          orderBy: { displayOrder: 'asc' },
          include: { item: { select: { id: true, name: true, sku: true, unit: true } } },
        },
      },
    });

    if (recipes.length === 0) {
      throw new BadRequestException('เมนูที่เลือกยังไม่มีสูตรอาหาร จึงคำนวณใบเบิกไม่ได้');
    }

    const propertyId = await this.resolveProperty(recipes.map((r) => r.menuItem.restaurantId));
    const warehouses = propertyId ? await this.listWarehouses(tenantId, propertyId) : [];
    const kitchen = propertyId ? await this.findKitchenWarehouse(tenantId, propertyId) : null;

    const sources = warehouses.filter((w) => w.id !== kitchen?.id);
    const requestedSource = dto.sourceWarehouseId
      ? sources.find((w) => w.id === dto.sourceWarehouseId)
      : undefined;
    const sourceWarehouseId =
      requestedSource?.id ??
      sources.find((w) => w.isDefault)?.id ??
      sources.find((w) => w.type === 'GENERAL')?.id ??
      sources[0]?.id ??
      null;

    // Aggregate every recipe's demand onto one line per inventory item.
    const byItem = new Map<string, RequisitionLinePlan>();
    const unlinked = new Map<string, Set<string>>();
    const menus: RequisitionPlan['menus'] = [];

    for (const recipe of recipes) {
      const plates = platesByMenu.get(recipe.menuItem.id) ?? 0;
      const servings = recipe.servings && recipe.servings > 0 ? recipe.servings : 1;
      menus.push({
        menuItemId: recipe.menuItem.id,
        menuItemName: recipe.menuItem.name,
        plates,
        servings,
      });

      for (const ing of recipe.ingredients) {
        const perPlate = Number(ing.quantity ?? 0) / servings;
        const withWastage = perPlate * (1 + Number(ing.wastagePercent ?? 0) / 100);
        const need = withWastage * plates;
        if (need <= 0) continue;

        if (!ing.itemId || !ing.item) {
          const name = ing.name;
          if (!unlinked.has(name)) unlinked.set(name, new Set());
          unlinked.get(name)!.add(recipe.menuItem.name);
          continue;
        }

        const line = byItem.get(ing.itemId) ?? {
          itemId: ing.itemId,
          itemName: ing.item.name,
          sku: ing.item.sku,
          unit: ing.unit ?? String(ing.item.unit),
          requiredQty: 0,
          onHandQty: 0,
          shortageQty: 0,
          suggestedQty: 0,
          sourceQty: 0,
          enough: true,
          usedBy: [],
        };
        line.requiredQty += need;
        line.usedBy.push({ menuItemName: recipe.menuItem.name, qty: round3(need) });
        byItem.set(ing.itemId, line);
      }
    }

    if (byItem.size === 0) {
      throw new BadRequestException(
        'สูตรของเมนูที่เลือกยังไม่ได้ผูกกับสินค้าในคลัง จึงไม่รู้ว่าต้องเบิกอะไร',
      );
    }

    const itemIds = [...byItem.keys()];
    const stockWarehouseIds = [kitchen?.id, sourceWarehouseId].filter(Boolean) as string[];
    const stocks = stockWarehouseIds.length
      ? await this.prisma.warehouseStock.findMany({
          where: { warehouseId: { in: stockWarehouseIds }, itemId: { in: itemIds } },
          select: { warehouseId: true, itemId: true, quantity: true },
        })
      : [];
    const stockMap = new Map(stocks.map((s) => [`${s.warehouseId}:${s.itemId}`, s.quantity]));

    const lines = [...byItem.values()].map((line) => {
      // Round to the recipe column's own precision BEFORE the ceil. `0.2 × 1.1 × 50`
      // is 11.000000000000002 in binary float, and an un-rounded ceil would turn every
      // whole-number requirement into one unit too many.
      const required = round3(line.requiredQty);
      // Issue mode has no kitchen shelf to net off — the full need is requisitioned.
      const onHand = kitchen ? (stockMap.get(`${kitchen.id}:${line.itemId}`) ?? 0) : 0;
      const shortage = round3(Math.max(0, required - onHand));
      const suggested = Math.ceil(shortage);
      const sourceQty = sourceWarehouseId
        ? (stockMap.get(`${sourceWarehouseId}:${line.itemId}`) ?? 0)
        : 0;
      return {
        ...line,
        requiredQty: required,
        onHandQty: onHand,
        shortageQty: shortage,
        suggestedQty: suggested,
        sourceQty,
        enough: sourceQty >= suggested,
      };
    });

    lines.sort((a, b) => b.suggestedQty - a.suggestedQty || a.itemName.localeCompare(b.itemName));

    const warnings: string[] = [];
    if (!kitchen) warnings.push('ยังไม่พบคลังครัวของสาขานี้ — ตั้งค่าคลังประเภท KITCHEN ก่อน');
    if (!sourceWarehouseId) {
      warnings.push('ไม่มีคลังต้นทางอื่นนอกจากคลังครัว — เลือกโหมด "ตัดออกจากคลัง" แทนการโอน');
    }
    const short = lines.filter((l) => l.suggestedQty > 0 && !l.enough).length;
    if (short > 0) warnings.push(`มี ${short} รายการที่คลังต้นทางมีของไม่พอ`);
    if (unlinked.size > 0) {
      warnings.push(`มีวัตถุดิบ ${unlinked.size} รายการที่ยังไม่ผูกกับสินค้าในคลัง จึงเบิกไม่ได้`);
    }

    return {
      kitchenWarehouse: kitchen,
      sourceWarehouses: sources,
      sourceWarehouseId,
      menus,
      lines,
      unlinked: [...unlinked.entries()].map(([name, m]) => ({ name, menus: [...m] })),
      warnings,
    };
  }

  private async assertConnected(tenantId: string): Promise<void> {
    const connected = await this.integrations.isEnabled(tenantId, REQUISITION_INTEGRATION_KEY);
    if (!connected) throw new BadRequestException(REQUISITION_OFF_MESSAGE);
  }

  /**
   * A requisition draws from one property's warehouses, so menus spanning two
   * properties cannot share one document.
   */
  private async resolveProperty(restaurantIds: (string | null)[]): Promise<string | null> {
    const ids = [...new Set(restaurantIds.filter(Boolean))] as string[];
    if (ids.length === 0) return null;

    const restaurants = await this.prisma.restaurant.findMany({
      where: { id: { in: ids } },
      select: { propertyId: true },
    });
    const properties = [...new Set(restaurants.map((r) => r.propertyId).filter(Boolean))];
    if (properties.length > 1) {
      throw new BadRequestException('เมนูที่เลือกอยู่คนละสาขา — สร้างใบเบิกแยกทีละสาขา');
    }
    return (properties[0] as string) ?? null;
  }

  private async listWarehouses(
    tenantId: string,
    propertyId: string,
  ): Promise<RequisitionWarehouse[]> {
    const rows = await this.prisma.warehouse.findMany({
      where: { tenantId, propertyId, isActive: true, deletedAt: null },
      select: { id: true, name: true, code: true, type: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((w) => ({ ...w, type: String(w.type) }));
  }

  /** Same resolution order as the readiness page, so both agree on "the kitchen". */
  private async findKitchenWarehouse(
    tenantId: string,
    propertyId: string,
  ): Promise<RequisitionWarehouse | null> {
    const all = await this.listWarehouses(tenantId, propertyId);
    return all.find((w) => w.type === 'KITCHEN') ?? all.find((w) => w.isDefault) ?? all[0] ?? null;
  }
}
