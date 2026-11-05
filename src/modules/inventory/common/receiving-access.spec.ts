import { ForbiddenException } from '@nestjs/common';
import { assertCanReceive, hasReceivingAccess, purchaseOrderIdOfReceive } from './receiving-access';

function prismaWith(opts: {
  perms?: { procurementPermissions?: string | null; warehousePermissions?: string | null };
  po?: { requestedBy: string; approvedBy: string | null; poNumber: string } | null;
  gr?: { purchaseOrderId: string | null } | null;
}) {
  return {
    user: { findFirst: jest.fn().mockResolvedValue(opts.perms ?? null) },
    purchaseOrder: { findFirst: jest.fn().mockResolvedValue(opts.po ?? null) },
    goodsReceive: { findFirst: jest.fn().mockResolvedValue(opts.gr ?? null) },
  } as any;
}

const actor = (role: string, userId = 'u1') => ({ userId, tenantId: 't1', role });
const PO = { requestedBy: 'buyer1', approvedBy: 'boss1', poNumber: 'PO-202611-0001' };

describe('receiving-access', () => {
  it('procurement_manager cannot receive or pass QC (segregation of duties)', async () => {
    const prisma = prismaWith({ perms: { procurementPermissions: '["po.create","grn.view"]' } });
    await expect(
      assertCanReceive(prisma, actor('procurement_manager'), 'receive'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertCanReceive(prisma, actor('buyer'), 'qc', 'po1')).rejects.toThrow('ระบบคลัง');
  });

  it('purchasing login (systemContext=procurement) can only watch — even owner / receiver roles', async () => {
    const prisma = prismaWith({ perms: { procurementPermissions: '["grn.create","qc.inspect"]' } });
    for (const role of ['tenant_admin', 'receiver', 'warehouse_manager']) {
      for (const action of ['receive', 'qc'] as const) {
        await expect(
          assertCanReceive(prisma, { ...actor(role), systemContext: 'procurement' }, action),
        ).rejects.toThrow('ระบบจัดซื้อดูและติดตามการรับเข้าได้อย่างเดียว');
      }
    }
    // the same person from the main dashboard / warehouse system still can
    await expect(
      assertCanReceive(prisma, { ...actor('tenant_admin'), systemContext: 'main' }, 'receive'),
    ).resolves.toBeUndefined();
  });

  it('warehouse roles and the receiver role can receive', async () => {
    const prisma = prismaWith({ po: PO });
    for (const role of ['warehouse_manager', 'inventory_clerk', 'receiver']) {
      await expect(
        assertCanReceive(prisma, actor(role, 'clerk1'), 'receive', 'po1'),
      ).resolves.toBeUndefined();
    }
    // พนักงานคลังทั่วไปรับของได้ แต่ผ่าน QC ไม่ได้
    expect(await hasReceivingAccess(prismaWith({}), actor('inventory_clerk'), 'qc')).toBe(false);
    expect(await hasReceivingAccess(prismaWith({}), actor('qc_officer'), 'qc')).toBe(true);
  });

  it('an explicit per-user grant (grn.create) allows receiving', async () => {
    const prisma = prismaWith({ perms: { procurementPermissions: '["grn.create"]' } });
    expect(await hasReceivingAccess(prisma, actor('buyer'), 'receive')).toBe(true);
    expect(await hasReceivingAccess(prisma, actor('buyer'), 'qc')).toBe(false);
  });

  it('whoever requested or approved the PO cannot receive it', async () => {
    const prisma = prismaWith({ po: PO });
    await expect(
      assertCanReceive(prisma, actor('receiver', 'buyer1'), 'receive', 'po1'),
    ).rejects.toThrow('PO-202611-0001');
    await expect(
      assertCanReceive(prisma, actor('manager', 'boss1'), 'qc', 'po1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('owners / admins may receive their own PO (small properties)', async () => {
    const prisma = prismaWith({ po: { ...PO, requestedBy: 'owner1' } });
    await expect(
      assertCanReceive(prisma, actor('tenant_admin', 'owner1'), 'qc', 'po1'),
    ).resolves.toBeUndefined();
  });

  it('resolves the PO of a goods receive', async () => {
    expect(
      await purchaseOrderIdOfReceive(prismaWith({ gr: { purchaseOrderId: 'po9' } }), 't1', 'gr1'),
    ).toBe('po9');
    expect(await purchaseOrderIdOfReceive(prismaWith({}), 't1', null)).toBeNull();
  });
});
