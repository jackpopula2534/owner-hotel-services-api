import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { BANGKOK_OFFSET_MS } from '@/common/utils/bangkok-day.util';

/**
 * กติกากลางของการลงสมุดรายวัน — ทุกโมดูลที่สร้าง JE (ลงมือเอง/ออโต้) ต้องใช้ชุดนี้
 *
 * เดิมแต่ละโมดูลคิดงวดบัญชีจาก `new Date().getMonth()` ของเครื่องเซิร์ฟเวอร์เอง
 * (เซิร์ฟเวอร์ UTC → รายการช่วง 00:00–07:00 น. เวลาไทยวันที่ 1 ตกไปเดือนก่อน)
 * และไม่มีใครเช็คว่าปีบัญชีปิดไปแล้วหรือยัง จึงลงย้อนเข้างวดที่ปิดแล้วได้เงียบ ๆ
 */

export interface FiscalPeriodRef {
  fiscalYear: number;
  fiscalPeriod: number;
}

/** โรงแรมทั้งหมดอยู่ไทย — งวดบัญชีนับตามปฏิทินไทย ไม่ใช่ timezone ของเซิร์ฟเวอร์ */
export function fiscalPeriodOf(date: Date): FiscalPeriodRef {
  const local = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return { fiscalYear: local.getUTCFullYear(), fiscalPeriod: local.getUTCMonth() + 1 };
}

/** วันตามปฏิทินไทยในรูป UTC midnight — ใช้เทียบกับคอลัมน์ @db.Date */
export function businessDayOf(date: Date): Date {
  const local = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

type SequenceClient = Pick<PrismaClient | Prisma.TransactionClient, 'documentSequence'>;

/** เลขที่ JE รันต่อ tenant ต่อเดือนของวันที่รายการ (ไม่ใช่เดือนที่กดบันทึก) */
export async function nextJournalEntryNo(
  prisma: SequenceClient,
  tenantId: string,
  entryDate: Date,
): Promise<string> {
  const { fiscalYear, fiscalPeriod } = fiscalPeriodOf(entryDate);
  const yearMonth = `${fiscalYear}${String(fiscalPeriod).padStart(2, '0')}`;
  const seq = await prisma.documentSequence.upsert({
    where: { tenantId_docType_yearMonth: { tenantId, docType: 'JE', yearMonth } },
    update: { lastNumber: { increment: 1 } },
    create: { tenantId, docType: 'JE', prefix: 'JE', yearMonth, lastNumber: 1 },
  });
  return `JE-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
}

type FiscalYearClient = Pick<PrismaClient | Prisma.TransactionClient, 'fiscalYear'>;

/**
 * ห้ามลงรายการเข้าปีบัญชีที่ปิด/ล็อกแล้ว — ถ้ายังไม่ได้ตั้งปีบัญชีถือว่าเปิด
 * (tenant ส่วนใหญ่ยังไม่เคยสร้างปีบัญชี ห้ามทำให้การลงบัญชีอัตโนมัติพังทั้งระบบ)
 */
export async function assertPeriodOpen(
  prisma: FiscalYearClient,
  tenantId: string,
  propertyId: string,
  entryDate: Date,
): Promise<void> {
  // startDate/endDate เป็น @db.Date (UTC midnight) — เทียบตรง ๆ กับเวลาเต็มจะหลุดวันสุดท้ายของปี
  const day = businessDayOf(entryDate);
  const closed = await prisma.fiscalYear.findFirst({
    where: {
      tenantId,
      propertyId,
      status: { in: ['CLOSED', 'LOCKED'] },
      startDate: { lte: day },
      endDate: { gte: day },
    },
    select: { year: true, status: true },
  });
  if (closed) {
    throw new BadRequestException(
      `ปีบัญชี ${closed.year} ${closed.status === 'LOCKED' ? 'ถูกล็อก' : 'ปิดแล้ว'} — ลงรายการวันที่นี้ไม่ได้`,
    );
  }
}
