import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PropertyPromoCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PromoRule } from '../bookings/promo-discount';
import { CreatePromoCodeDto, UpdatePromoCodeDto } from './dto/promo-code.dto';

export interface PromoCodeView {
  id: string;
  code: string;
  description: string | null;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  maxDiscount: number | null;
  minNights: number;
  minAmount: number | null;
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
  /** การจองที่ใช้โค้ดนี้ (ไม่นับที่ยกเลิก) */
  usedCount: number;
  isActive: boolean;
  createdAt: Date;
}

/** @db.Date เก็บเป็น UTC midnight */
const toDbDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
const toYmd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const isRealDate = (ymd: string): boolean => {
  const d = toDbDate(ymd);
  return !Number.isNaN(d.getTime()) && toYmd(d) === ymd;
};
/** วันที่วันนี้ตามเวลาไทย */
const bangkokToday = (now = new Date()): string =>
  new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/** สถานะการจองที่ไม่นับเป็นการใช้โค้ด */
const NOT_COUNTED_STATUSES = ['cancelled'];

/**
 * โค้ดส่วนลดของโรงแรม (ต่อ property) — พนักงานสร้าง/แก้ แขกใช้ตอนจองผ่านหน้าเว็บ
 * จำนวนครั้งที่ใช้นับจากการจองจริง (ไม่นับที่ยกเลิก) → ยกเลิกการจองแล้วโควตาคืนเอง
 */
@Injectable()
export class PropertyPromoCodesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(propertyId: string, tenantId: string): Promise<PromoCodeView[]> {
    await this.assertProperty(propertyId, tenantId);
    const rows = await this.prisma.propertyPromoCode.findMany({
      where: { propertyId, tenantId },
      orderBy: { createdAt: 'desc' },
    });
    const usage = await this.usageCounts(
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toView(r, usage.get(r.id) ?? 0));
  }

  async create(
    propertyId: string,
    tenantId: string,
    dto: CreatePromoCodeDto,
  ): Promise<PromoCodeView> {
    await this.assertProperty(propertyId, tenantId);
    const data = this.toData(dto);
    this.assertConsistent({
      ...data,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
    });
    try {
      const row = await this.prisma.propertyPromoCode.create({
        data: {
          ...data,
          code: dto.code,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          tenantId,
          propertyId,
        },
      });
      return this.toView(row, 0);
    } catch (err) {
      throw this.mapUniqueError(err, dto.code);
    }
  }

  async update(
    propertyId: string,
    id: string,
    tenantId: string,
    dto: UpdatePromoCodeDto,
  ): Promise<PromoCodeView> {
    const existing = await this.findOwned(propertyId, id, tenantId);
    const data = this.toData(dto);
    this.assertConsistent({
      discountType: dto.discountType ?? existing.discountType,
      discountValue: dto.discountValue ?? Number(existing.discountValue),
      validFrom: data.validFrom === undefined ? existing.validFrom : data.validFrom,
      validUntil: data.validUntil === undefined ? existing.validUntil : data.validUntil,
    });
    try {
      const row = await this.prisma.propertyPromoCode.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.discountType !== undefined && { discountType: dto.discountType }),
          ...(dto.discountValue !== undefined && { discountValue: dto.discountValue }),
        },
      });
      const usage = await this.usageCounts(tenantId, [row.id]);
      return this.toView(row, usage.get(row.id) ?? 0);
    } catch (err) {
      throw this.mapUniqueError(err, dto.code ?? existing.code);
    }
  }

  async remove(propertyId: string, id: string, tenantId: string): Promise<{ id: string }> {
    const existing = await this.findOwned(propertyId, id, tenantId);
    // การจองเดิมเก็บโค้ด/ยอดส่วนลดไว้ใน pricingBreakdown แล้ว ลบโค้ดได้โดยไม่กระทบประวัติ
    await this.prisma.propertyPromoCode.delete({ where: { id: existing.id } });
    return { id: existing.id };
  }

  /**
   * หาโค้ดที่ใช้ได้ ณ ตอนนี้ (เปิดใช้ / อยู่ในช่วงวันที่ / ยังไม่เต็มโควตา)
   * เรียกจากหน้า public — กรอง tenantId/propertyId เองเสมอ
   */
  async findRedeemable(propertyId: string, tenantId: string, rawCode: string): Promise<PromoRule> {
    const code = rawCode.trim().toUpperCase();
    const invalid = new BadRequestException('โค้ดส่วนลดไม่ถูกต้องหรือหมดอายุแล้ว');
    if (!code) throw invalid;
    const row = await this.prisma.propertyPromoCode.findFirst({
      where: { tenantId, propertyId, code, isActive: true },
    });
    if (!row) throw invalid;
    const today = bangkokToday();
    if (
      (row.validFrom && today < toYmd(row.validFrom)!) ||
      (row.validUntil && today > toYmd(row.validUntil)!)
    ) {
      throw invalid;
    }
    if (row.usageLimit != null) {
      const used = (await this.usageCounts(tenantId, [row.id])).get(row.id) ?? 0;
      if (used >= row.usageLimit) throw new BadRequestException('โค้ดส่วนลดนี้ถูกใช้ครบจำนวนแล้ว');
    }
    return {
      id: row.id,
      code: row.code,
      discountType: row.discountType,
      discountValue: Number(row.discountValue),
      maxDiscount: row.maxDiscount == null ? null : Number(row.maxDiscount),
      minNights: row.minNights,
      minAmount: row.minAmount == null ? null : Number(row.minAmount),
    };
  }

  // ─── internals ───────────────────────────────────────────────────────

  private async usageCounts(tenantId: string, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.booking.groupBy({
      by: ['promoCodeId'],
      where: { tenantId, promoCodeId: { in: ids }, status: { notIn: NOT_COUNTED_STATUSES } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.promoCodeId as string, r._count._all]));
  }

  private toData(dto: UpdatePromoCodeDto) {
    for (const d of [dto.validFrom, dto.validUntil]) {
      if (d && !isRealDate(d)) throw new BadRequestException(`วันที่ไม่ถูกต้อง: ${d}`);
    }
    const date = (v: string | null | undefined) =>
      v === undefined ? undefined : v ? toDbDate(v) : null;
    return {
      ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
      ...(dto.maxDiscount !== undefined && { maxDiscount: dto.maxDiscount }),
      ...(dto.minNights !== undefined && { minNights: dto.minNights }),
      ...(dto.minAmount !== undefined && { minAmount: dto.minAmount }),
      ...(dto.usageLimit !== undefined && { usageLimit: dto.usageLimit }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      validFrom: date(dto.validFrom),
      validUntil: date(dto.validUntil),
    };
  }

  private assertConsistent(v: {
    discountType: string;
    discountValue: number;
    validFrom?: Date | null;
    validUntil?: Date | null;
  }): void {
    if (v.discountType === 'percentage' && v.discountValue > 100) {
      throw new BadRequestException('ส่วนลดแบบเปอร์เซ็นต์ต้องไม่เกิน 100%');
    }
    if (v.validFrom && v.validUntil && v.validFrom > v.validUntil) {
      throw new BadRequestException('วันเริ่มต้องไม่หลังวันสิ้นสุด');
    }
  }

  private mapUniqueError(err: unknown, code: string): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(`มีโค้ด ${code} อยู่แล้ว`);
    }
    return err;
  }

  private async findOwned(
    propertyId: string,
    id: string,
    tenantId: string,
  ): Promise<PropertyPromoCode> {
    const row = await this.prisma.propertyPromoCode.findFirst({
      where: { id, propertyId, tenantId },
    });
    if (!row) throw new NotFoundException('ไม่พบโค้ดส่วนลด');
    return row;
  }

  private async assertProperty(propertyId: string, tenantId: string): Promise<void> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!property) throw new NotFoundException(`Property with ID ${propertyId} not found`);
  }

  private toView(r: PropertyPromoCode, usedCount: number): PromoCodeView {
    return {
      id: r.id,
      code: r.code,
      description: r.description,
      discountType: r.discountType === 'fixed' ? 'fixed' : 'percentage',
      discountValue: Number(r.discountValue),
      maxDiscount: r.maxDiscount == null ? null : Number(r.maxDiscount),
      minNights: r.minNights,
      minAmount: r.minAmount == null ? null : Number(r.minAmount),
      validFrom: toYmd(r.validFrom),
      validUntil: toYmd(r.validUntil),
      usageLimit: r.usageLimit,
      usedCount,
      isActive: r.isActive,
      createdAt: r.createdAt,
    };
  }
}
