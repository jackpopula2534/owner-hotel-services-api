import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PropertyHoliday } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { THAI_PUBLIC_HOLIDAY_DATES } from '../../common/holidays/thai-holidays';
import { ReplaceHolidaysDto } from './dto/replace-holidays.dto';

/** ช่วงวันหยุดยาวสุดที่ยอมให้ตั้ง (กันพิมพ์ปีผิดแล้วทั้งปีกลายเป็นวันหยุด) */
const MAX_RANGE_DAYS = 31;
const DAY_MS = 86_400_000;

export interface CustomHolidayView {
  id: string;
  date: string;
  endDate: string | null;
  name: string;
  category: string;
  repeatYearly: boolean;
  isEnabled: boolean;
}

export interface PropertyHolidaySettings {
  disabledDefaultDates: string[];
  customHolidays: CustomHolidayView[];
}

/** @db.Date เก็บเป็น UTC midnight — แปลงไป/กลับด้วย UTC เท่านั้น */
const toDbDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
const toYmd = (d: Date): string => d.toISOString().slice(0, 10);
const isRealDate = (ymd: string): boolean => {
  const d = toDbDate(ymd);
  return !Number.isNaN(d.getTime()) && toYmd(d) === ymd;
};

/**
 * วันหยุดของโรงแรม = วันหยุดราชการ (ยกเว้นที่โรงแรมปิด) + วันหยุดที่โรงแรมเพิ่มเอง
 * ใช้เป็นแหล่งเดียวของ "วันนี้คิดราคาวันหยุดไหม" ทั้งหน้าจองหลังบ้านและหน้าเว็บโรงแรม
 */
@Injectable()
export class PropertyHolidaysService {
  private readonly logger = new Logger(PropertyHolidaysService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSettings(propertyId: string, tenantId: string): Promise<PropertyHolidaySettings> {
    await this.assertProperty(propertyId, tenantId);
    return this.toSettings(await this.findRows(propertyId, tenantId));
  }

  async replaceSettings(
    propertyId: string,
    tenantId: string,
    dto: ReplaceHolidaysDto,
  ): Promise<PropertyHolidaySettings> {
    await this.assertProperty(propertyId, tenantId);
    for (const h of dto.customHolidays) {
      if (!isRealDate(h.date) || (h.endDate && !isRealDate(h.endDate))) {
        throw new BadRequestException(`วันที่ไม่ถูกต้อง: ${h.date}`);
      }
      if (h.endDate) {
        const span = (toDbDate(h.endDate).getTime() - toDbDate(h.date).getTime()) / DAY_MS;
        if (span < 0) throw new BadRequestException(`วันสิ้นสุดก่อนวันเริ่ม: ${h.name || h.date}`);
        if (span >= MAX_RANGE_DAYS) {
          throw new BadRequestException(`ช่วงวันหยุดยาวเกิน ${MAX_RANGE_DAYS} วัน: ${h.name || h.date}`);
        }
      }
    }
    const disabled = [...new Set(dto.disabledDefaultDates)].filter(isRealDate);

    await this.prisma.$transaction([
      this.prisma.propertyHoliday.deleteMany({ where: { propertyId, tenantId } }),
      this.prisma.propertyHoliday.createMany({
        data: [
          ...disabled.map((d) => ({
            tenantId,
            propertyId,
            kind: 'default_off',
            date: toDbDate(d),
          })),
          ...dto.customHolidays.map((h) => ({
            tenantId,
            propertyId,
            kind: 'custom',
            date: toDbDate(h.date),
            endDate: h.endDate && h.endDate !== h.date ? toDbDate(h.endDate) : null,
            name: h.name.trim(),
            category: h.category ?? 'custom',
            repeatYearly: h.repeatYearly ?? false,
            isEnabled: h.isEnabled ?? true,
          })),
        ],
      }),
    ]);
    this.logger.log(
      `holidays replaced for property ${propertyId}: ${disabled.length} off, ${dto.customHolidays.length} custom`,
    );
    return this.getSettings(propertyId, tenantId);
  }

  /**
   * วันที่ (YYYY-MM-DD) ที่ property นี้คิดราคาวันหยุด
   * วันหยุดทำซ้ำทุกปีถูกขยายตั้งแต่ปีที่ตั้งไว้ถึงปีหน้า (ครอบคลุมการจองล่วงหน้า)
   */
  async resolveDates(propertyId: string, tenantId: string, now = new Date()): Promise<string[]> {
    const rows = await this.findRows(propertyId, tenantId);
    return expandHolidayDates(rows, now.getUTCFullYear() + 1);
  }

  // ─── internals ───────────────────────────────────────────────────────

  private findRows(propertyId: string, tenantId: string): Promise<PropertyHoliday[]> {
    return this.prisma.propertyHoliday.findMany({
      where: { propertyId, tenantId },
      orderBy: { date: 'asc' },
    });
  }

  private async assertProperty(propertyId: string, tenantId: string): Promise<void> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!property) throw new NotFoundException(`Property with ID ${propertyId} not found`);
  }

  private toSettings(rows: PropertyHoliday[]): PropertyHolidaySettings {
    return {
      disabledDefaultDates: rows.filter((r) => r.kind === 'default_off').map((r) => toYmd(r.date)),
      customHolidays: rows
        .filter((r) => r.kind === 'custom')
        .map((r) => ({
          id: r.id,
          date: toYmd(r.date),
          endDate: r.endDate ? toYmd(r.endDate) : null,
          name: r.name,
          category: r.category,
          repeatYearly: r.repeatYearly,
          isEnabled: r.isEnabled,
        })),
    };
  }
}

/** แยกเป็นฟังก์ชันบริสุทธิ์เพื่อเทสต์ได้โดยไม่ต้องมี DB */
export function expandHolidayDates(
  rows: Pick<PropertyHoliday, 'kind' | 'date' | 'endDate' | 'repeatYearly' | 'isEnabled'>[],
  untilYear: number,
): string[] {
  const off = new Set(rows.filter((r) => r.kind === 'default_off').map((r) => toYmd(r.date)));
  const dates = new Set(THAI_PUBLIC_HOLIDAY_DATES.filter((d) => !off.has(d)));

  for (const r of rows) {
    if (r.kind !== 'custom' || !r.isEnabled) continue;
    const start = r.date.getTime();
    const days = r.endDate
      ? Math.min(MAX_RANGE_DAYS - 1, Math.max(0, Math.round((r.endDate.getTime() - start) / DAY_MS)))
      : 0;
    const baseYear = r.date.getUTCFullYear();
    const lastYear = r.repeatYearly ? Math.max(baseYear, untilYear) : baseYear;
    for (let year = baseYear; year <= lastYear; year += 1) {
      const first = toYmd(new Date(start)).replace(/^\d{4}/, String(year));
      // 29 ก.พ. ที่ทำซ้ำในปีที่ไม่ใช่อธิกสุรทิน → ข้าม
      if (!isRealDate(first)) continue;
      const from = toDbDate(first).getTime();
      for (let i = 0; i <= days; i += 1) dates.add(toYmd(new Date(from + i * DAY_MS)));
    }
  }
  return [...dates].sort();
}
