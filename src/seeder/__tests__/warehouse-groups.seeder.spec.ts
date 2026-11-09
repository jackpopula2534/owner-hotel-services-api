import { WarehouseGroupsSeeder } from '../warehouse-groups.seeder';

function buildPrisma(existingCodes: string[] = []) {
  return {
    warehouse: {
      findMany: jest.fn().mockResolvedValue([{ tenantId: 't1' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    warehouseGroup: {
      findFirst: jest.fn(({ where }: { where: { code: string } }) =>
        Promise.resolve(existingCodes.includes(where.code) ? { id: `old-${where.code}` } : null),
      ),
      create: jest.fn(({ data }: { data: { code: string } }) => Promise.resolve({ id: `new-${data.code}` })),
    },
  };
}

describe('WarehouseGroupsSeeder', () => {
  it('สร้าง 3 กลุ่ม (POS / ปฏิบัติการ / ของแถม) และจับคลังด้วยรหัสหรือประเภท', async () => {
    const prisma = buildPrisma();
    await new WarehouseGroupsSeeder(prisma as never).seed();

    expect(prisma.warehouseGroup.create.mock.calls.map((c) => c[0].data.code)).toEqual([
      'GRP-POS',
      'GRP-OPS',
      'GRP-GIFT',
    ]);
    const gift = prisma.warehouse.updateMany.mock.calls[2][0];
    expect(gift.where.OR).toEqual([{ code: { in: ['WH-GIFT'] } }, { type: { in: ['PROMOTION'] } }]);
    expect(gift.data).toEqual({ groupId: 'new-GRP-GIFT' });
    const ops = prisma.warehouse.updateMany.mock.calls[1][0];
    expect(ops.where.OR[1].type.in).toEqual(['KITCHEN', 'HOUSEKEEPING', 'MAINTENANCE']);
  });

  it('รันซ้ำ: ไม่ทับกลุ่มเดิม แต่ยังจัดคลังใหม่ที่ไม่มีกลุ่มเข้ากลุ่มเดิม', async () => {
    const prisma = buildPrisma(['GRP-POS', 'GRP-OPS', 'GRP-GIFT']);
    await new WarehouseGroupsSeeder(prisma as never).seed();

    expect(prisma.warehouseGroup.create).not.toHaveBeenCalled();
    for (const [arg] of prisma.warehouse.updateMany.mock.calls) {
      expect(arg.where.groupId).toBeNull();
      expect(arg.data.groupId).toMatch(/^old-/);
    }
  });
});
