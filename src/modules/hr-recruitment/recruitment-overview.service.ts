import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** คำขออัตรากำลังที่อนุมัติงบแล้วและยังรับคนอยู่ — แสดงในภาพรวมการสรรหา */
export const RECRUITING_STATUSES: readonly string[] = [
  'budget_approved',
  'recruiting',
  'interviewing',
  'offer_made',
];

/**
 * ภาพรวมการสรรหา — ส่งคำขอที่กำลังรับคน + ผู้สมัครทั้งหมดของคำขอเหล่านั้นในครั้งเดียว
 *
 * การจัดขั้น (ใหม่/นัดแล้ว/ผ่าน/เสนอจ้าง/จ้างแล้ว/ตัดออก) ทำที่ frontend ด้วย state machine
 * เดียวกับกระดานผู้สมัครในหน้าคำขอ เพื่อให้ตัวเลขสองหน้าตรงกันเสมอ
 */
@Injectable()
export class RecruitmentOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(tenantId: string | undefined, now: Date = new Date()) {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const requests = await (this.prisma as any).hrManpowerRequest.findMany({
      where: { tenantId, status: { in: [...RECRUITING_STATUSES] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        requestNo: true,
        positionTitle: true,
        headcount: true,
        status: true,
        departmentId: true,
        salaryRangeMin: true,
        salaryRangeMax: true,
        createdAt: true,
        budgetApprovedAt: true,
        jobPosting: { select: { id: true, status: true, publicToken: true, closeAt: true } },
      },
    });

    const ids: string[] = requests.map((r: { id: string }) => r.id);
    const deptIds = [
      ...new Set(
        requests.map((r: { departmentId: string | null }) => r.departmentId).filter(Boolean),
      ),
    ] as string[];

    const [candidates, departments] = await Promise.all([
      ids.length
        ? (this.prisma as any).hrCandidate.findMany({
            where: { tenantId, manpowerRequestId: { in: ids } },
            orderBy: { createdAt: 'desc' },
            include: {
              interviews: { orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }] },
              hireRecord: {
                include: { employee: { select: { id: true, status: true, startDate: true } } },
              },
              manpowerRequest: {
                select: { id: true, requestNo: true, positionTitle: true, status: true },
              },
            },
          })
        : [],
      deptIds.length
        ? (this.prisma as any).hrDepartment.findMany({
            where: { tenantId, id: { in: deptIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const deptName = new Map<string, string>(
      (departments as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
    );

    return {
      asOf: now.toISOString(),
      requests: requests.map((r: Record<string, any>) => {
        const { departmentId, ...rest } = r;
        return {
          ...rest,
          department: departmentId
            ? { id: departmentId, name: deptName.get(departmentId) ?? null }
            : null,
          openedAt: (r.budgetApprovedAt ?? r.createdAt) as Date,
        };
      }),
      candidates,
    };
  }
}
