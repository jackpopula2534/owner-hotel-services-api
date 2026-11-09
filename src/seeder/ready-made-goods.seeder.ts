import { Injectable, Logger } from '@nestjs/common';
import { ItemUnit, MenuItemKind, RevenueType, WarehouseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** หมวดสินค้าสำเร็จรูปในคลัง — ใช้โค้ดชุดเดียวกับที่ seedInventoryData ใช้กับ tenant พรีเมียม */
type RetailCategoryCode = 'CAT-RETAIL-DRINK' | 'CAT-RETAIL-SNACK' | 'CAT-RETAIL-DAILY';

interface ReadyMadeGood {
  sku: string;
  name: string;
  catCode: RetailCategoryCode;
  unit: ItemUnit;
  /** บาร์โค้ดอยู่ที่ตัวสินค้าในคลังเสมอ ไม่ได้อยู่ที่เมนู — หน้าขายยิงแล้ววิ่งกลับมาหาเมนูเอง */
  barcode: string;
  cost: number;
  price: number;
  /** ยอดตั้งต้นในคลังหน้าร้าน */
  shopQty: number;
  /** ยอดตั้งต้นในตู้มินิบาร์ */
  minibarQty: number;
  reorderPoint: number;
  /** ขึ้นเป็นเมนูของสำเร็จรูปที่ร้าน/บาร์ด้วยไหม (ของใช้จำเป็นไม่ขึ้นเมนูอาหาร) */
  onBarMenu: boolean;
}

interface SeedProperty {
  id: string;
  tenantId: string;
  name: string;
}

const RETAIL_PARENT_CODE = 'CAT-RETAIL';

const CATEGORY_DEFS: Array<{ code: string; name: string; parentCode: string | null; sortOrder: number }> = [
  { code: RETAIL_PARENT_CODE, name: 'สินค้าร้านค้า / Mini Mart', parentCode: null, sortOrder: 10 },
  { code: 'CAT-RETAIL-DRINK', name: 'เครื่องดื่มร้านค้า', parentCode: RETAIL_PARENT_CODE, sortOrder: 11 },
  { code: 'CAT-RETAIL-SNACK', name: 'ขนมและของทานเล่น', parentCode: RETAIL_PARENT_CODE, sortOrder: 12 },
  { code: 'CAT-RETAIL-DAILY', name: 'ของใช้จำเป็น', parentCode: RETAIL_PARENT_CODE, sortOrder: 13 },
];

/**
 * แคตตาล็อกของสำเร็จรูปที่ทุกโรงแรมควรมีให้ทดสอบได้
 *
 * ชื่อและ SKU ตรงกับของเดิมที่ tenant พรีเมียมมีอยู่แล้ว เพื่อให้ซีดซ้ำแล้วเจอของเดิม
 * ไม่ใช่สร้างซ้ำเป็นสองแถว บาร์โค้ดใช้เลขเดียวกันข้ามกิจการได้ (ของจริงก็ขวดเดียวกัน)
 * เพราะการค้นหาถูกกรองด้วย tenantId เสมอ และคอลัมน์ barcode เป็นแค่ index ไม่ใช่ unique
 */
const READY_MADE_CATALOG: ReadyMadeGood[] = [
  {
    sku: 'RT-WATER-600',
    name: 'น้ำดื่ม 600ml',
    catCode: 'CAT-RETAIL-DRINK',
    unit: ItemUnit.BOTTLE,
    barcode: '8850001000011',
    cost: 6,
    price: 20,
    shopQty: 96,
    minibarQty: 24,
    reorderPoint: 24,
    onBarMenu: true,
  },
  {
    sku: 'RT-SPARKLING-LEMON',
    name: 'โซดามะนาว 325ml',
    catCode: 'CAT-RETAIL-DRINK',
    unit: ItemUnit.CAN,
    barcode: '8850001000028',
    cost: 14,
    price: 35,
    shopQty: 48,
    minibarQty: 12,
    reorderPoint: 12,
    onBarMenu: true,
  },
  {
    sku: 'RT-ICED-TEA',
    name: 'ชาเย็นพร้อมดื่ม 350ml',
    catCode: 'CAT-RETAIL-DRINK',
    unit: ItemUnit.BOTTLE,
    barcode: '8850001000035',
    cost: 18,
    price: 40,
    shopQty: 36,
    minibarQty: 12,
    reorderPoint: 12,
    onBarMenu: true,
  },
  {
    sku: 'RT-COLA-325',
    name: 'โคล่ากระป๋อง 325ml',
    catCode: 'CAT-RETAIL-DRINK',
    unit: ItemUnit.CAN,
    barcode: '8850001000042',
    cost: 12,
    price: 30,
    shopQty: 48,
    minibarQty: 12,
    reorderPoint: 12,
    onBarMenu: true,
  },
  {
    sku: 'RT-BEER-CAN',
    name: 'เบียร์กระป๋อง 330ml',
    catCode: 'CAT-RETAIL-DRINK',
    unit: ItemUnit.CAN,
    barcode: '8850001000066',
    cost: 42,
    price: 90,
    shopQty: 24,
    minibarQty: 6,
    reorderPoint: 12,
    onBarMenu: true,
  },
  {
    sku: 'RT-CHIPS-SALT',
    name: 'มันฝรั่งทอดรสเกลือ 50g',
    catCode: 'CAT-RETAIL-SNACK',
    unit: ItemUnit.BAG,
    barcode: '8850002000010',
    cost: 16,
    price: 35,
    shopQty: 36,
    minibarQty: 10,
    reorderPoint: 12,
    onBarMenu: true,
  },
  {
    sku: 'RT-NUTS-CASHEW',
    name: 'เม็ดมะม่วงหิมพานต์อบ 40g',
    catCode: 'CAT-RETAIL-SNACK',
    unit: ItemUnit.BAG,
    barcode: '8850002000027',
    cost: 28,
    price: 60,
    shopQty: 24,
    minibarQty: 8,
    reorderPoint: 12,
    onBarMenu: true,
  },
  {
    sku: 'RT-COOKIE-BOX',
    name: 'คุกกี้กล่องเล็ก',
    catCode: 'CAT-RETAIL-SNACK',
    unit: ItemUnit.BOX,
    barcode: '8850002000034',
    cost: 45,
    price: 90,
    shopQty: 24,
    minibarQty: 6,
    reorderPoint: 12,
    onBarMenu: true,
  },
  {
    sku: 'RT-TOOTHBRUSH',
    name: 'แปรงสีฟันพกพา',
    catCode: 'CAT-RETAIL-DAILY',
    unit: ItemUnit.PIECE,
    barcode: '8850003000019',
    cost: 12,
    price: 30,
    shopQty: 40,
    minibarQty: 8,
    reorderPoint: 12,
    onBarMenu: false,
  },
  {
    sku: 'RT-TOOTHPASTE',
    name: 'ยาสีฟันหลอดเล็ก 40g',
    catCode: 'CAT-RETAIL-DAILY',
    unit: ItemUnit.PIECE,
    barcode: '8850003000026',
    cost: 18,
    price: 40,
    shopQty: 40,
    minibarQty: 8,
    reorderPoint: 12,
    onBarMenu: false,
  },
];

const READY_MADE_MENU_CATEGORY = 'ของสำเร็จรูป & ของทานเล่น';

/**
 * ของสำเร็จรูปสำหรับ "ทุกโรงแรม" ไม่ใช่แค่ tenant พรีเมียม
 *
 * seedInventoryData() ซีดคลังให้เฉพาะ Mountain View ทำให้อีกสามโรงแรมเปิดหน้ามินิบาร์
 * หรือหน้าร้านค้ามาแล้วเจอจอเปล่า ทดสอบอะไรไม่ได้เลย ที่นี่จึงเติมสามอย่างให้ครบทุกกิจการ:
 *
 *   1. คลังประเภท MINIBAR ต่อสาขา + ของในตู้  → หน้ามินิบาร์เลิกตัดจากคลังสำรอง
 *      (แบนเนอร์เหลือง "กำลังตัดจากคลัง…" หายไป และยอดตู้แยกจากยอดหน้าร้านจริง ๆ)
 *   2. สินค้าสำเร็จรูปพร้อมบาร์โค้ดและราคาขาย       → ยิงบาร์โค้ดที่หน้าขายได้
 *   3. เมนูของสำเร็จรูปที่ผูก inventoryItemId       → ปิดบิลแล้วตัดของออกจากคลังกลางจริง
 *
 * ข้อ 3 คือโหมด CENTRAL (คลังเป็นเจ้าของยอด) ซึ่งต่างจากเมนูของ Mountain View Restaurant
 * ที่ตั้งใจเก็บไว้เป็นโหมด LOCAL (นับสต๊อกในตัวเมนูเอง) — เดโมจึงมีให้ดูครบทั้งสองโหมด
 */
@Injectable()
export class ReadyMadeGoodsSeeder {
  private readonly logger = new Logger(ReadyMadeGoodsSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async seed(): Promise<void> {
    this.logger.log('🥤 Seeding ready-made goods (ของสำเร็จรูป + ตู้มินิบาร์)...');

    const properties = await this.prisma.property.findMany({
      select: { id: true, tenantId: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (properties.length === 0) {
      this.logger.warn('  ⚠️ ไม่พบสาขาใด ๆ — ข้ามการซีดของสำเร็จรูป');
      return;
    }

    const byTenant = new Map<string, SeedProperty[]>();
    for (const property of properties) {
      byTenant.set(property.tenantId, [...(byTenant.get(property.tenantId) ?? []), property]);
    }

    for (const [tenantId, tenantProperties] of byTenant) {
      await this.seedTenant(tenantId, tenantProperties);
    }
  }

  private async seedTenant(tenantId: string, tenantProperties: SeedProperty[]): Promise<void> {
    const categoryMap = await this.ensureCategories(tenantId);
    const itemMap = await this.ensureItems(tenantId, categoryMap);

    const shopByProperty: Record<string, string> = {};
    for (const property of tenantProperties) {
      const warehouses = await this.ensureWarehouses(tenantId, property.id);
      shopByProperty[property.id] = warehouses.shopWarehouseId;
      await this.stockShop(warehouses.shopWarehouseId, itemMap);
      await this.stockMinibar(warehouses.minibarWarehouseId, itemMap);
    }

    await this.linkRestaurantMenus(tenantId, itemMap, shopByProperty);
  }

  /** หมวดสินค้า — ของเดิมค้นด้วย code เสมอ ไม่สร้างซ้ำเวลาซีดทับ */
  private async ensureCategories(tenantId: string): Promise<Record<string, string>> {
    const categoryMap: Record<string, string> = {};
    for (const def of CATEGORY_DEFS) {
      const existing = await this.prisma.itemCategory.findFirst({
        where: { tenantId, code: def.code },
        select: { id: true },
      });
      if (existing) {
        categoryMap[def.code] = existing.id;
        continue;
      }
      const created = await this.prisma.itemCategory.create({
        data: {
          tenantId,
          code: def.code,
          name: def.name,
          sortOrder: def.sortOrder,
          parentId: def.parentCode ? (categoryMap[def.parentCode] ?? null) : null,
          isActive: true,
        },
        select: { id: true },
      });
      categoryMap[def.code] = created.id;
    }
    return categoryMap;
  }

  /**
   * สินค้าสำเร็จรูปในคลัง
   *
   * ของที่มีอยู่แล้วไม่แตะยอดหรือราคา — ของ tenant พรีเมียมถูกตั้งค่าไว้โชว์สถานะ
   * ใกล้หมด/หมด/ล้นสต๊อก การเขียนทับจะพังเดโมนั้น เติมให้เฉพาะบาร์โค้ดที่ยังว่าง
   * เพราะการยิงบาร์โค้ดใช้ไม่ได้เลยถ้าไม่มีเลข
   */
  private async ensureItems(
    tenantId: string,
    categoryMap: Record<string, string>,
  ): Promise<Record<string, string>> {
    const itemMap: Record<string, string> = {};
    let created = 0;

    for (const good of READY_MADE_CATALOG) {
      const existing = await this.prisma.inventoryItem.findFirst({
        where: { tenantId, sku: good.sku },
        select: { id: true, barcode: true, itemType: true, sellingPrice: true },
      });

      if (existing) {
        itemMap[good.sku] = existing.id;
        const needsBarcode = !existing.barcode;
        const needsType = existing.itemType !== 'FINISHED_GOOD';
        const needsPrice = existing.sellingPrice === null;
        if (needsBarcode || needsType || needsPrice) {
          await this.prisma.inventoryItem.update({
            where: { id: existing.id },
            data: {
              ...(needsBarcode ? { barcode: good.barcode } : {}),
              ...(needsType ? { itemType: 'FINISHED_GOOD' as const } : {}),
              ...(needsPrice ? { sellingPrice: good.price } : {}),
            },
          });
        }
        continue;
      }

      const row = await this.prisma.inventoryItem.create({
        data: {
          tenantId,
          sku: good.sku,
          name: good.name,
          categoryId: categoryMap[good.catCode] ?? null,
          unit: good.unit,
          itemType: 'FINISHED_GOOD',
          sellingPrice: good.price,
          reorderPoint: good.reorderPoint,
          reorderQty: good.reorderPoint * 2,
          minStock: Math.ceil(good.reorderPoint / 2),
          barcode: good.barcode,
          isPerishable: good.catCode !== 'CAT-RETAIL-DAILY',
          defaultShelfLifeDays: good.catCode === 'CAT-RETAIL-DAILY' ? null : 365,
          isActive: true,
        },
        select: { id: true },
      });
      itemMap[good.sku] = row.id;
      created++;
    }

    if (created > 0) {
      this.logger.log(`  ✓ ${created} ready-made items created for tenant ${tenantId}`);
    }
    return itemMap;
  }

  /**
   * คลังหน้าร้าน + คลังมินิบาร์ของสาขา
   *
   * สาขาที่ยังไม่มีคลังเลยต้องได้คลังตั้งต้นก่อน ไม่งั้นทุกอย่างที่ถามหา "คลังตั้งต้น"
   * (ใบรับสินค้า เบิกของ ตัดของจากร้านอาหาร) จะตกไปหาคลังของสาขาอื่นแทน
   */
  private async ensureWarehouses(
    tenantId: string,
    propertyId: string,
  ): Promise<{ shopWarehouseId: string; minibarWarehouseId: string }> {
    const hasAny = await this.prisma.warehouse.findFirst({
      where: { tenantId, propertyId, deletedAt: null },
      select: { id: true },
    });
    if (!hasAny) {
      await this.ensureWarehouse(tenantId, propertyId, {
        code: 'WH-MAIN',
        name: 'คลังกลาง',
        type: WarehouseType.GENERAL,
        isDefault: true,
      });
    }

    const shop = await this.ensureWarehouse(tenantId, propertyId, {
      code: 'WH-RETAIL',
      name: 'คลังร้านขายของ',
      type: WarehouseType.GENERAL,
      isDefault: false,
    });
    const minibar = await this.ensureWarehouse(tenantId, propertyId, {
      code: 'WH-MINIBAR',
      name: 'คลังมินิบาร์',
      type: WarehouseType.MINIBAR,
      isDefault: false,
    });

    return { shopWarehouseId: shop, minibarWarehouseId: minibar };
  }

  private async ensureWarehouse(
    tenantId: string,
    propertyId: string,
    def: { code: string; name: string; type: WarehouseType; isDefault: boolean },
  ): Promise<string> {
    const existing = await this.prisma.warehouse.findFirst({
      where: { tenantId, propertyId, code: def.code },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.warehouse.create({
      data: { tenantId, propertyId, ...def, isActive: true },
      select: { id: true },
    });
    this.logger.log(`  ✓ Warehouse: ${def.name} (${def.code})`);
    return created.id;
  }

  /** ยอดตั้งต้นคลังหน้าร้าน — สร้างเฉพาะที่ยังไม่มี ห้ามทับยอดที่ตั้งไว้โชว์สถานะสต๊อก */
  private async stockShop(warehouseId: string, itemMap: Record<string, string>): Promise<void> {
    for (const good of READY_MADE_CATALOG) {
      const itemId = itemMap[good.sku];
      if (!itemId) continue;

      const existing = await this.prisma.warehouseStock.findFirst({
        where: { warehouseId, itemId },
        select: { id: true },
      });
      if (existing) continue;

      await this.prisma.warehouseStock.create({
        data: {
          warehouseId,
          itemId,
          quantity: good.shopQty,
          avgCost: good.cost,
          totalValue: good.shopQty * good.cost,
        },
      });
    }
  }

  /** ของในตู้มินิบาร์ — upsert ได้เพราะคลังใบนี้เป็นของ seeder ทั้งใบ ซีดใหม่ = เติมตู้ให้เต็ม */
  private async stockMinibar(warehouseId: string, itemMap: Record<string, string>): Promise<void> {
    for (const good of READY_MADE_CATALOG) {
      const itemId = itemMap[good.sku];
      if (!itemId) continue;

      await this.prisma.warehouseStock.upsert({
        where: { warehouseId_itemId: { warehouseId, itemId } },
        create: {
          warehouseId,
          itemId,
          quantity: good.minibarQty,
          avgCost: good.cost,
          totalValue: good.minibarQty * good.cost,
        },
        update: {
          quantity: good.minibarQty,
          avgCost: good.cost,
          totalValue: good.minibarQty * good.cost,
        },
      });
    }
  }

  /**
   * เมนูของสำเร็จรูปที่ผูกกับคลัง (โหมด CENTRAL)
   *
   * ข้ามร้านที่มีของสำเร็จรูปอยู่แล้ว — Mountain View Restaurant ตั้งใจเป็นโหมด LOCAL
   * (นับสต๊อกในตัวเมนู) การเติมซ้ำจะกลายเป็นสองแหล่งความจริงของน้ำขวดขวดเดียวกัน
   */
  private async linkRestaurantMenus(
    tenantId: string,
    itemMap: Record<string, string>,
    shopByProperty: Record<string, string>,
  ): Promise<void> {
    const restaurants = await this.prisma.restaurant.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, propertyId: true, warehouseId: true },
    });

    for (const restaurant of restaurants) {
      const readyMadeCount = await this.prisma.menuItem.count({
        where: { tenantId, restaurantId: restaurant.id, itemKind: MenuItemKind.READY_MADE },
      });
      if (readyMadeCount > 0) continue;

      // ร้านที่ยังไม่ได้เลือกคลัง จะไปตัดของจากคลังครัว (ซึ่งมีแต่วัตถุดิบ) แล้วยอดติดลบ
      // ทั้งที่ของกองอยู่คลังหน้าร้าน — ชี้ให้ตรงตั้งแต่ซีดเลย
      const shopWarehouseId = restaurant.propertyId ? shopByProperty[restaurant.propertyId] : undefined;
      if (!restaurant.warehouseId && shopWarehouseId) {
        await this.prisma.restaurant.update({
          where: { id: restaurant.id },
          data: { warehouseId: shopWarehouseId },
        });
      }

      const category = await this.prisma.menuCategory.create({
        data: {
          tenantId,
          restaurantId: restaurant.id,
          name: READY_MADE_MENU_CATEGORY,
          description: 'น้ำดื่ม เครื่องดื่มกระป๋อง ขนม — หยิบเสิร์ฟได้ทันที ตัดจากคลังกลาง',
          displayOrder: 9,
          revenueType: RevenueType.RETAIL_GOODS,
          isActive: true,
        },
        select: { id: true },
      });

      let order = 0;
      for (const good of READY_MADE_CATALOG) {
        const itemId = itemMap[good.sku];
        if (!good.onBarMenu || !itemId) continue;
        order++;
        await this.prisma.menuItem.create({
          data: {
            tenantId,
            restaurantId: restaurant.id,
            categoryId: category.id,
            name: good.name,
            description: `สินค้าสำเร็จรูป — ตัดสต๊อกจากคลัง (${good.sku})`,
            price: good.price,
            cost: good.cost,
            preparationTime: 0,
            isAvailable: true,
            displayOrder: order,
            itemKind: MenuItemKind.READY_MADE,
            // ผูกคลังกลางแล้วห้ามเปิด trackStock พร้อมกัน — สองแหล่งความจริงของยอดเดียวกัน
            trackStock: false,
            inventoryItemId: itemId,
          },
        });
      }

      this.logger.log(`  ✓ ${order} ready-made menu items linked at ${restaurant.name}`);
    }
  }
}
