import { BadRequestException } from '@nestjs/common';
import { AssetsService } from './assets.service';

/**
 * จำหน่ายสินทรัพย์ต้องตัดราคาทุน + ค่าเสื่อมสะสมออกจากสมุด — เดิมแค่เปลี่ยนสถานะ
 * งบดุลจึงยังโชว์สินทรัพย์ที่ขายไปแล้ว
 */
describe('AssetsService.dispose — journal posting', () => {
  const TENANT = 'tenant-1';
  const codes = ['1206', '1207', '1102', '4309', '6309'];
  let prisma: any;
  let journal: { createAndPostAutoEntry: jest.Mock };
  let service: AssetsService;

  beforeEach(() => {
    prisma = {
      fixedAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'asset-1',
          assetCode: 'FA-01',
          name: 'ตู้เย็น',
          propertyId: 'prop-1',
          category: 'KITCHEN_EQUIPMENT',
          status: 'ACTIVE',
          purchaseCost: 12000,
          acquisitionCost: 0,
          assetAccountId: null,
          accumDeprecAccountId: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'asset-1', status: 'DISPOSED' }),
      },
      assetDepreciation: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { depreciationAmount: 1000 } }),
      },
      fiscalYear: { findFirst: jest.fn().mockResolvedValue(null) },
      accountChart: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue(codes.map((code) => ({ id: `acc-${code}`, code }))),
      },
    };
    journal = { createAndPostAutoEntry: jest.fn().mockResolvedValue({}) };
    service = new AssetsService(prisma, journal as any);
  });

  it('ขายขาดทุน: DR ค่าเสื่อมสะสม + เงินที่ได้ + ขาดทุน / CR ราคาทุน และสมดุล', async () => {
    await service.dispose('asset-1', TENANT, 'user-1', '2026-10-29', 9000);

    const input = journal.createAndPostAutoEntry.mock.calls[0][1];
    expect(input.sourceId).toBe('asset-1');
    const byAccount = Object.fromEntries(
      input.lines.map((l: any) => [l.accountId, [l.debit, l.credit]]),
    );
    expect(byAccount).toEqual({
      'acc-1207': [1000, 0],
      'acc-1102': [9000, 0],
      'acc-6309': [2000, 0],
      'acc-1206': [0, 12000],
    });
    expect(prisma.fixedAsset.update).toHaveBeenCalled();
  });

  it('ขายกำไรลง 4309', async () => {
    await service.dispose('asset-1', TENANT, 'user-1', '2026-10-29', 11500);

    const lines = journal.createAndPostAutoEntry.mock.calls[0][1].lines;
    expect(lines.find((l: any) => l.accountId === 'acc-4309')).toMatchObject({ credit: 500 });
    expect(lines.find((l: any) => l.accountId === 'acc-6309')).toBeUndefined();
  });

  it('มีค่าเสื่อมที่ยังไม่ post → ไม่ยอมจำหน่าย และไม่แตะสถานะ', async () => {
    prisma.assetDepreciation.count.mockResolvedValue(2);

    await expect(
      service.dispose('asset-1', TENANT, 'user-1', '2026-10-29', 9000),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(journal.createAndPostAutoEntry).not.toHaveBeenCalled();
    expect(prisma.fixedAsset.update).not.toHaveBeenCalled();
  });
});
