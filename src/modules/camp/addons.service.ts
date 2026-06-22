import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddonDto, UpdateAddonDto } from './dto/addon.dto';

@Injectable()
export class AddonsService {
  private readonly logger = new Logger(AddonsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** สถานะใบจองที่ยังกันของอยู่ (ของยังถูกยืม ไม่ได้คืน) */
  private static readonly ACTIVE_RESERVATION_STATUSES = [
    'pending',
    'confirmed',
    'checked_in',
  ];

  async findAll(campgroundId: string, tenantId?: string) {
    const addons = await this.prisma.campAddon.findMany({
      where: { campgroundId, ...(tenantId ? { tenantId } : {}) },
      orderBy: { createdAt: 'asc' },
    });

    // รวมจำนวนที่ "กำลังถูกยืม" จากใบจอง active เพื่อหา "ว่างให้เช่าตอนนี้"
    // หมายเหตุ: stockQty ถูก decrement ตอนสร้างใบจองอยู่แล้ว ⇒ stockQty = จำนวนที่ว่าง
    //          ส่วน borrowedQty = ที่ออกไปกับใบจอง active ⇒ คงเหลือทั้งหมด = stockQty + borrowedQty
    const borrowedByAddon = new Map<string, number>();
    if (addons.length > 0) {
      const grouped = await this.prisma.campReservationAddon.groupBy({
        by: ['addonId'],
        where: {
          addonId: { in: addons.map((a) => a.id) },
          reservation: {
            status: { in: AddonsService.ACTIVE_RESERVATION_STATUSES },
          },
        },
        _sum: { qty: true },
      });
      for (const g of grouped) {
        borrowedByAddon.set(g.addonId, g._sum.qty ?? 0);
      }
    }

    const data = addons.map((a) => {
      const borrowedQty = borrowedByAddon.get(a.id) ?? 0;
      return {
        ...a,
        /** กำลังถูกยืมจากใบจอง active */
        borrowedQty,
        /** ว่างให้เช่าตอนนี้ (= stockQty หลังหักที่ถูกยืมแล้ว) */
        availableQty: a.stockQty,
        /** คงเหลือทั้งหมดที่ครอบครอง = ว่าง + ถูกยืม */
        totalQty: a.stockQty + borrowedQty,
      };
    });

    return { success: true, data };
  }

  async findOne(id: string, tenantId?: string) {
    const addon = await this.prisma.campAddon.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!addon) {
      throw new NotFoundException(`Addon ${id} not found`);
    }
    return { success: true, data: addon };
  }

  async create(dto: CreateAddonDto, tenantId?: string) {
    const data = await this.prisma.campAddon.create({
      data: { ...dto, tenantId: tenantId ?? null },
    });
    this.logger.log(`Addon created: ${data.id}`);
    return { success: true, data };
  }

  async update(id: string, dto: UpdateAddonDto, tenantId?: string) {
    const existing = await this.prisma.campAddon.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        stockQty: true,
        campground: { select: { warehouseId: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException(`Addon ${id} not found`);
    }

    // กันแก้ stockQty ตรงๆ เมื่อลานเชื่อมคลังกลางแล้ว — สต็อกต้องไหลผ่านใบเบิก/ใบโอน
    // (ระบบคลัง/Stock MM เป็น source of truth) เพื่อกัน dual-accounting ลาน↔คลังกลาง
    if (
      existing.campground?.warehouseId &&
      dto.stockQty !== undefined &&
      dto.stockQty !== existing.stockQty
    ) {
      throw new BadRequestException(
        'ลานนี้เชื่อมคลังกลางแล้ว — ปรับจำนวนสต็อกผ่านใบเบิก/ใบโอน (ระบบคลัง) เท่านั้น',
      );
    }

    const data = await this.prisma.campAddon.update({
      where: { id },
      data: { ...dto },
    });
    return { success: true, data };
  }

  /** เพิ่มรูปภาพเข้าอุปกรณ์ (append) — จำกัดสูงสุด 10 รูป */
  async addImages(id: string, urls: string[], tenantId?: string) {
    const existing = await this.prisma.campAddon.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, images: true },
    });
    if (!existing) {
      throw new NotFoundException(`Addon ${id} not found`);
    }
    const current = Array.isArray(existing.images)
      ? (existing.images as string[])
      : [];
    const merged = [...current, ...urls].slice(0, 10);
    const data = await this.prisma.campAddon.update({
      where: { id },
      data: { images: merged },
    });
    return { success: true, data };
  }

  async remove(id: string, tenantId?: string) {
    await this.ensureExists(id, tenantId);
    await this.prisma.campAddon.delete({ where: { id } });
    return { success: true };
  }

  private async ensureExists(id: string, tenantId?: string): Promise<void> {
    const existing = await this.prisma.campAddon.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Addon ${id} not found`);
    }
  }
}
