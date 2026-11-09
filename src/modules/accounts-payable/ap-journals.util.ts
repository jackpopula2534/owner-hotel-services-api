import { PrismaService } from '@/prisma/prisma.service';

const journalSelect = {
  id: true,
  entryNo: true,
  status: true,
  description: true,
  entryDate: true,
  reversedById: true,
  lines: {
    orderBy: { lineNo: 'asc' as const },
    select: { debit: true, credit: true, account: { select: { code: true, name: true } } },
  },
};

/**
 * รายการบัญชีของเอกสาร AP เรียงตามเวลา — รวมรายการกลับ (ADJUSTMENT) ที่เกิดตอนยกเลิกด้วย
 * reverse() เก็บ id รายการกลับไว้ที่ reversedById ของรายการเดิม จึงตามด้วย id ได้ตรง ๆ
 */
export async function findSourceJournals(
  prisma: PrismaService,
  tenantId: string,
  sourceType: 'AP_INVOICE' | 'AP_PAYMENT',
  sourceId: string,
) {
  const originals = await prisma.journalEntry.findMany({
    where: { tenantId, sourceType, sourceId },
    orderBy: { createdAt: 'asc' },
    select: journalSelect,
  });
  const reversalIds = originals.map((j) => j.reversedById).filter((v): v is string => !!v);
  const reversals = reversalIds.length
    ? await prisma.journalEntry.findMany({
        where: { tenantId, id: { in: reversalIds } },
        orderBy: { createdAt: 'asc' },
        select: journalSelect,
      })
    : [];
  return [...originals, ...reversals].map(({ reversedById: _r, ...j }) => ({
    ...j,
    isReversal: reversals.some((r) => r.id === j.id),
  }));
}
