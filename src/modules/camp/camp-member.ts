import { PrismaService } from '../../prisma/prisma.service';

/** เหลือแต่ตัวเลข และแปลง +66/66 นำหน้าเป็น 0 ให้เบอร์ไทยเทียบกันได้ทุกรูปแบบ */
export function normalizeThaiPhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.startsWith('66') && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
}

/**
 * หาแขกเดิมในระบบของ tenant นี้จาก ชื่อ + นามสกุล + เบอร์โทร (ต้องตรงครบทั้ง 3 อย่าง)
 *
 * ใช้ทั้งหน้าเว็บสาธารณะ (เช็คสมาชิก) และตอนสร้างการจอง (ผูก guestId ไว้สะสมแต้ม)
 * — หน้าเว็บไม่มี tenant context จึงต้องกรอง tenantId เองที่นี่เสมอ
 * ชื่อ+นามสกุล+เบอร์เดียวกันหลายแถว = คนเดิมที่ถูกบันทึกซ้ำ → ใช้แถวแรกสุดให้แต้มไปกองที่เดียว
 */
export async function findCampMemberGuestId(
  prisma: PrismaService,
  tenantId: string,
  input: { firstName: string; lastName: string; phone: string },
): Promise<string | null> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phone = normalizeThaiPhone(input.phone);
  if (!tenantId || !firstName || !lastName || phone.length < 9) return null;

  const candidates = await prisma.guest.findMany({
    where: { tenantId, firstName, lastName, anonymizedAt: null, phone: { not: null } },
    select: { id: true, phone: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  return candidates.find((g) => normalizeThaiPhone(g.phone) === phone)?.id ?? null;
}
