import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  assertCanApproveProcurement,
  assertCanApproveStockCount,
  assertCanCancelProcurement,
  hasProcurementApproval,
} from '../approval-access';

const TENANT = 'tenant-1';

function prismaWith(procurementPermissions: string | null) {
  const findFirst = jest.fn().mockResolvedValue({ procurementPermissions });
  return { prisma: { user: { findFirst } } as unknown as PrismaService, findFirst };
}

const actor = (role: string, userId = 'me') => ({ userId, tenantId: TENANT, role });

describe('approval-access', () => {
  describe('hasProcurementApproval', () => {
    it.each(['tenant_admin', 'owner', 'admin', 'procurement_manager'])(
      '%s อนุมัติได้โดยไม่ต้องอ่านสิทธิ์รายคน',
      async (role) => {
        const { prisma, findFirst } = prismaWith(null);
        await expect(hasProcurementApproval(prisma, actor(role), 'po.approve')).resolves.toBe(true);
        expect(findFirst).not.toHaveBeenCalled();
      },
    );

    it('approver ที่มี po.approve อนุมัติ PO ได้ — อ่านสิทธิ์แบบ scope tenant', async () => {
      const { prisma, findFirst } = prismaWith(JSON.stringify(['pr.approve', 'po.approve']));
      await expect(hasProcurementApproval(prisma, actor('approver'), 'po.approve')).resolves.toBe(
        true,
      );
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'me', tenantId: TENANT } }),
      );
    });

    it('approver ที่ถูกถอด po.approve อนุมัติไม่ได้', async () => {
      const { prisma } = prismaWith(JSON.stringify(['pr.approve']));
      await expect(hasProcurementApproval(prisma, actor('approver'), 'po.approve')).resolves.toBe(
        false,
      );
    });

    it.each(['buyer', 'receiver', 'warehouse_manager', 'inventory_clerk'])(
      '%s ที่ไม่มีสิทธิ์ อนุมัติไม่ได้',
      async (role) => {
        const { prisma } = prismaWith(JSON.stringify(['pr.create', 'po.create']));
        await expect(hasProcurementApproval(prisma, actor(role), 'pr.approve')).resolves.toBe(
          false,
        );
      },
    );

    it('JSON สิทธิ์เสีย = ไม่มีสิทธิ์ (ไม่ throw)', async () => {
      const { prisma } = prismaWith('{not json');
      await expect(hasProcurementApproval(prisma, actor('approver'), 'pr.approve')).resolves.toBe(
        false,
      );
    });
  });

  describe('assertCanApproveProcurement', () => {
    it('buyer อนุมัติ PO ไม่ได้ → 403', async () => {
      const { prisma } = prismaWith(JSON.stringify(['po.create']));
      await expect(
        assertCanApproveProcurement(prisma, actor('buyer'), 'po.approve', 'someone-else'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('procurement_manager ห้ามอนุมัติเอกสารที่ตัวเองสร้าง', async () => {
      const { prisma } = prismaWith(null);
      await expect(
        assertCanApproveProcurement(prisma, actor('procurement_manager'), 'po.approve', 'me'),
      ).rejects.toThrow('ตัวเองสร้าง');
    });

    it('เจ้าของอนุมัติเอกสารที่ตัวเองสร้างได้ (โรงแรมเล็ก)', async () => {
      const { prisma } = prismaWith(null);
      await expect(
        assertCanApproveProcurement(prisma, actor('owner'), 'pr.approve', 'me'),
      ).resolves.toBeUndefined();
    });

    it('ไม่มี tenant → 403', async () => {
      const { prisma } = prismaWith(null);
      await expect(
        assertCanApproveProcurement(
          prisma,
          { userId: 'me', tenantId: '', role: 'owner' },
          'pr.approve',
          'x',
        ),
      ).rejects.toThrow('No active tenant');
    });
  });

  describe('assertCanCancelProcurement', () => {
    it('ผู้สร้างยกเลิกของตัวเองได้แม้ไม่มีสิทธิ์อนุมัติ', async () => {
      const { prisma, findFirst } = prismaWith(null);
      await expect(
        assertCanCancelProcurement(prisma, actor('buyer'), 'pr.approve', 'me'),
      ).resolves.toBeUndefined();
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('buyer ยกเลิก/ไม่อนุมัติ PR ของคนอื่นไม่ได้', async () => {
      const { prisma } = prismaWith(JSON.stringify(['pr.create']));
      await expect(
        assertCanCancelProcurement(prisma, actor('buyer'), 'pr.approve', 'someone-else'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('approver ไม่อนุมัติ PR ของคนอื่นได้', async () => {
      const { prisma } = prismaWith(JSON.stringify(['pr.approve']));
      await expect(
        assertCanCancelProcurement(prisma, actor('approver'), 'pr.approve', 'someone-else'),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertCanApproveStockCount', () => {
    it.each(['warehouse_manager', 'tenant_admin', 'owner'])('%s อนุมัติผลตรวจนับได้', (role) => {
      expect(() => assertCanApproveStockCount(actor(role))).not.toThrow();
    });

    it.each(['inventory_clerk', 'receiver', 'buyer', 'procurement_manager'])(
      '%s อนุมัติผลตรวจนับไม่ได้',
      (role) => {
        expect(() => assertCanApproveStockCount(actor(role))).toThrow(ForbiddenException);
      },
    );
  });
});
