import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * คลังต้นทางของร้านอาหารหนึ่งร้าน — ที่เดียวที่ตอบคำถามนี้ได้
 *
 * มีสามจุดที่ต้องตอบให้ตรงกันเป๊ะ ๆ ไม่งั้นยอดเพี้ยนแบบไม่มีใครเห็น:
 *
 *   ย้ายเมนูเข้าคลัง  → เอาของไป "วาง" ไว้ที่คลังไหน
 *   กันขายเกินสต๊อก  → ไป "อ่าน" ยอดคงเหลือจากคลังไหน
 *   ปิดบิลแล้วตัดของ → ไป "หัก" ออกจากคลังไหน
 *
 * เดิมแยกกันเขียนสองที่แล้วลำดับสำรองไม่เท่ากัน (ตัวย้ายไล่ต่อไปถึงคลังไหนก็ได้ในกิจการ
 * ส่วนตัวตัดหยุดแค่ในสาขา) ผลคือของถูกวางไว้ในคลังที่ตัวตัดไม่มองหา → ขายแล้วยอดไม่ลด
 * เงียบ ๆ ตลอดไป
 */
@Injectable()
export class SourceWarehouseResolver {
  private readonly logger = new Logger(SourceWarehouseResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ไล่ตามลำดับ: คลังที่สาขาเลือกเอง → ครัวของสาขา → คลังตั้งต้นของสาขา
   * → คลังไหนก็ได้ในสาขา → คลังไหนก็ได้ในกิจการ
   *
   * คลังที่สาขาเลือกไว้อาจถูกปิดหรือลบไปแล้ว — ต้องตกไปใช้ลำดับสำรองต่อ
   * ไม่ใช่ยอมแพ้แล้วขายไม่ได้ทั้งร้าน
   */
  async resolve(tenantId: string, restaurantId: string): Promise<string | null> {
    const restaurant = await this.loadRestaurant(tenantId, restaurantId);
    if (!restaurant) return null;
    return this.resolveDefault(tenantId, restaurantId, restaurant);
  }

  /**
   * คลังของ "สินค้าชิ้นนี้" สำหรับร้านนี้ — ใช้ทั้งตอนอ่านยอดมากันขายเกิน
   * และตอนปิดบิลไปหักจริง สองที่นี้ต้องตอบตรงกัน ไม่งั้นกันไว้ที่คลังหนึ่ง
   * แล้วไปตัดอีกคลังหนึ่ง
   *
   * ทำไมต้องดูเป็นรายสินค้า: ร้านหนึ่งดึงของจากคลังตั้งต้นใบเดียวก็จริง แต่ของ
   * บางอย่างไม่เคยอยู่ในคลังนั้นเลย (น้ำอัดลม/ขนม มักกองอยู่ที่คลังร้านขายของ
   * ส่วนคลังครัวมีแต่วัตถุดิบ) การยืนยันจะตัดจากคลังตั้งต้นอย่างเดียวทำให้
   * คลังที่มีของจริงไม่เคยลด ส่วนคลังครัวติดลบไปเรื่อย ๆ ทั้งที่ไม่เคยมีของ
   *
   * ลำดับ: คลังตั้งต้นถ้ามีของอยู่จริง → คลังในสาขาที่มีของมากที่สุด → คลังตั้งต้น
   * (ตกมาถึงอันสุดท้ายแปลว่าไม่มีของที่ไหนเลย ซึ่งก็ควรกัน/ควรติดลบที่คลังตั้งต้น)
   */
  async resolveForItem(
    tenantId: string,
    restaurantId: string,
    itemId: string,
  ): Promise<string | null> {
    const restaurant = await this.loadRestaurant(tenantId, restaurantId);
    if (!restaurant) return null;

    const fallback = await this.resolveDefault(tenantId, restaurantId, restaurant);
    if (fallback && (await this.hasStock(tenantId, fallback, itemId))) return fallback;

    const withStock = await this.prisma.warehouseStock.findFirst({
      where: {
        itemId,
        quantity: { gt: 0 },
        item: { tenantId },
        warehouse: {
          tenantId,
          isActive: true,
          deletedAt: null,
          ...(restaurant.propertyId ? { propertyId: restaurant.propertyId } : {}),
        },
      },
      orderBy: { quantity: 'desc' },
      select: { warehouseId: true },
    });

    if (withStock && withStock.warehouseId !== fallback) {
      this.logger.warn(
        `Item ${itemId} is not stocked in warehouse ${fallback ?? 'none'} for restaurant ${restaurantId} — using ${withStock.warehouseId} instead`,
      );
      return withStock.warehouseId;
    }
    return fallback;
  }

  private loadRestaurant(tenantId: string, restaurantId: string) {
    return this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
      select: { propertyId: true, warehouseId: true },
    });
  }

  /** มีของอยู่จริงในคลังใบนี้ไหม — เช็ค tenant ของสินค้าด้วย กันอ่านยอดข้ามกิจการ */
  private async hasStock(tenantId: string, warehouseId: string, itemId: string): Promise<boolean> {
    const row = await this.prisma.warehouseStock.findFirst({
      where: { warehouseId, itemId, quantity: { gt: 0 }, item: { tenantId } },
      select: { warehouseId: true },
    });
    return row !== null;
  }

  private async resolveDefault(
    tenantId: string,
    restaurantId: string,
    restaurant: { propertyId: string | null; warehouseId: string | null },
  ): Promise<string | null> {
    const candidates: Prisma.WarehouseWhereInput[] = [];
    if (restaurant.warehouseId) candidates.push({ id: restaurant.warehouseId });
    if (restaurant.propertyId) {
      candidates.push({ propertyId: restaurant.propertyId, type: 'KITCHEN' });
      candidates.push({ propertyId: restaurant.propertyId, isDefault: true });
      candidates.push({ propertyId: restaurant.propertyId });
    }
    // ข้ามสาขาเป็นทางสุดท้ายจริง ๆ — ถึงตรงนี้แปลว่าสาขานี้ไม่มีคลังที่เปิดอยู่เลย
    // ซึ่งเป็นการตั้งค่าที่ผิดอยู่แล้ว แต่ยังดีกว่าปล่อยให้ยอดลอยไม่ถูกตัด
    candidates.push({});

    for (const candidate of candidates) {
      const found = await this.prisma.warehouse.findFirst({
        where: { ...candidate, tenantId, isActive: true, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (found) {
        if (restaurant.warehouseId && candidate.id !== restaurant.warehouseId) {
          this.logger.warn(
            `Restaurant ${restaurantId} points at warehouse ${restaurant.warehouseId} which is inactive or deleted — using ${found.id}`,
          );
        }
        return found.id;
      }
    }
    return null;
  }
}
