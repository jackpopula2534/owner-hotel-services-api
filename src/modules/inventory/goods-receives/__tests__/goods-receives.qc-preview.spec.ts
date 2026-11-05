import { GoodsReceivesService } from '../goods-receives.service';

/**
 * หน้า "สร้างใบรับสินค้า" ต้องบอกผู้ใช้ล่วงหน้าว่าสินค้าตัวไหนต้องผ่าน QC
 * — คำตอบต้องมาจากกฎเดียวกับตอนบันทึกจริง (เทมเพลตประจำสินค้า → ระดับสินค้า → ระดับหมวด)
 */
describe('GoodsReceivesService.qcPreview', () => {
  const TENANT = 't1';
  const prisma = {
    inventoryItem: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'water', categoryId: 'drinks', defaultQCTemplateId: null },
        { id: 'chicken', categoryId: 'meat', defaultQCTemplateId: null },
        { id: 'milk', categoryId: 'drinks', defaultQCTemplateId: 'tpl-milk' },
        { id: 'egg', categoryId: 'fresh', defaultQCTemplateId: null },
      ]),
    },
    qCTemplate: {
      findMany: jest.fn(({ where }: { where: { appliesTo?: string; id?: unknown } }) => {
        if (where.id) return Promise.resolve([{ id: 'tpl-milk', name: 'ตรวจนมสด' }]);
        if (where.appliesTo === 'ITEM')
          return Promise.resolve([{ id: 'tpl-egg', name: 'ตรวจไข่', itemId: 'egg' }]);
        return Promise.resolve([{ id: 'tpl-meat', name: 'ตรวจเนื้อสัตว์', categoryId: 'meat' }]);
      }),
    },
  };
  const service = new GoodsReceivesService(prisma as never, {} as never, {} as never, {} as never);

  it('says which items need QC and why, and which go straight to stock', async () => {
    const rows = await service.qcPreview(TENANT, ['water', 'chicken', 'milk', 'egg']);
    const byId = Object.fromEntries(rows.map((r) => [r.itemId, r]));

    expect(byId.water).toMatchObject({ requiresQC: false, templateName: null });
    expect(byId.chicken).toMatchObject({
      requiresQC: true,
      templateName: 'ตรวจเนื้อสัตว์',
      source: 'CATEGORY',
    });
    expect(byId.milk).toMatchObject({
      requiresQC: true,
      templateName: 'ตรวจนมสด',
      source: 'ITEM_DEFAULT',
    });
    expect(byId.egg).toMatchObject({ requiresQC: true, templateName: 'ตรวจไข่', source: 'ITEM' });
  });

  it('returns nothing for an empty list without querying', async () => {
    prisma.inventoryItem.findMany.mockClear();
    await expect(service.qcPreview(TENANT, [])).resolves.toEqual([]);
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });
});
