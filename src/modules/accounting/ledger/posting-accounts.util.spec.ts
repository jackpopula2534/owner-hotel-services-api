import { ACCOUNT_CODES, resolveAccountIds } from './posting-accounts.util';
import { DEFAULT_ACCOUNTS } from '@/modules/accounting/chart-of-accounts/default-chart-of-accounts';

/**
 * 4300 รายได้อื่นๆ เป็นหัวข้อ ลงรายการตรงไม่ได้ — รายได้อื่นที่ลงอัตโนมัติต้องไป 4309
 * และ tenant ที่มีผังก่อนเพิ่ม 4309 ต้องได้บัญชีนี้เติมให้ ไม่งั้นลงบัญชีล้ม
 */
describe('resolveAccountIds', () => {
  it('OTHER_REVENUE ชี้บัญชีที่ลงรายการได้ ไม่ใช่หัวข้อ', () => {
    const acc = DEFAULT_ACCOUNTS.find((a) => a.code === ACCOUNT_CODES.OTHER_REVENUE);
    expect(acc).toBeDefined();
    expect(acc?.isHeaderOnly ?? false).toBe(false);
    expect(acc?.level ?? 'ACCOUNT').toBe('ACCOUNT');
  });

  it('เติมบัญชีมาตรฐานที่ขาดให้ผังเก่าแล้วหาซ้ำ', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'a-1101', code: '1101' }])
      .mockResolvedValueOnce([
        { id: 'a-1101', code: '1101' },
        { id: 'a-4309', code: '4309' },
      ]);
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { accountChart: { count: jest.fn().mockResolvedValue(70), findMany, createMany } };

    const map = await resolveAccountIds(prisma as never, 't-1', ['1101', '4309']);

    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [expect.objectContaining({ tenantId: 't-1', code: '4309', isHeaderOnly: false })],
      }),
    );
    expect(map.get('4309')).toBe('a-4309');
  });

  it('รหัสที่ไม่ใช่บัญชีมาตรฐานยังล้มเหมือนเดิม', async () => {
    const prisma = {
      accountChart: {
        count: jest.fn().mockResolvedValue(70),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(),
      },
    };
    await expect(resolveAccountIds(prisma as never, 't-1', ['9999'])).rejects.toThrow('9999');
    expect(prisma.accountChart.createMany).not.toHaveBeenCalled();
  });
});
