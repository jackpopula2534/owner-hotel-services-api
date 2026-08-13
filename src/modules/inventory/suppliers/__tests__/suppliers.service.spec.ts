import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { SuppliersService } from '../suppliers.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateSupplierDto } from '../dto/create-supplier.dto';

/**
 * รหัสซัพพลายเออร์ที่ระบบจัดสรรให้เอง
 *
 * The quick-add form on the RFQ screen cannot ask a person for a supplier code —
 * it is bookkeeping they have no way to invent — so the server allocates it.
 * That makes the allocator load-bearing, and it has two traps worth a test each:
 * `@@unique([tenantId, code])` covers soft-deleted rows too, so a dead
 * supplier's code must never be handed out again; and two people adding a
 * vendor in the same second will both compute the same next code.
 */
describe('SuppliersService — code allocation', () => {
  let service: SuppliersService;
  let mockPrisma: {
    supplier: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  const TENANT = 'tenant-1';

  function dto(overrides: Partial<CreateSupplierDto> = {}): CreateSupplierDto {
    return { name: 'ร้านนายใหม่', ...overrides } as CreateSupplierDto;
  }

  /** P2002 คือ unique-constraint ของ Prisma — เลียนแบบตอนชนกันกลางอากาศ */
  function uniqueViolation(): Error & { code: string } {
    return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }

  beforeEach(async () => {
    mockPrisma = {
      supplier: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'sup-new',
          ...data,
          taxId: null,
          tags: data.tags ?? null,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SuppliersService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('ไม่ส่ง code มา → ตั้ง SUP-0001 ให้ tenant ที่ยังไม่มีซัพพลายเออร์', async () => {
    await service.create(dto(), TENANT);

    expect(mockPrisma.supplier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: 'SUP-0001', tenantId: TENANT }),
      }),
    );
  });

  it('นับต่อจากเลขสูงสุดที่มีอยู่ ไม่ใช่จากจำนวนแถว', async () => {
    // ลบไปกลางทางหนึ่งราย — ถ้านับจากจำนวนแถวจะได้ SUP-0003 แล้วชนกับของเดิม
    mockPrisma.supplier.findMany.mockResolvedValue([
      { code: 'SUP-0001' },
      { code: 'SUP-0003' },
      { code: 'SUP-0007' },
    ]);

    await service.create(dto(), TENANT);

    expect(mockPrisma.supplier.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'SUP-0008' }) }),
    );
  });

  it('สแกนรวมรายที่ถูกลบไปแล้ว — unique index ครอบ soft-deleted ด้วย', async () => {
    await service.create(dto(), TENANT);

    const where = mockPrisma.supplier.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ tenantId: TENANT, code: { startsWith: 'SUP-' } });
    // เผลอใส่ deletedAt: null เมื่อไหร่ = แจกรหัสของคนตายซ้ำ แล้วประวัติซื้อจะสลับร้าน
    expect(where).not.toHaveProperty('deletedAt');
  });

  it('มองข้ามรหัสที่ไม่ใช่รูปแบบตัวเลข', async () => {
    mockPrisma.supplier.findMany.mockResolvedValue([
      { code: 'SUP-LEGACY' },
      { code: 'SUP-0002' },
    ]);

    await service.create(dto(), TENANT);

    expect(mockPrisma.supplier.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'SUP-0003' }) }),
    );
  });

  it('ชนกันกลางอากาศ → จัดสรรใหม่แล้วลองอีกครั้ง', async () => {
    mockPrisma.supplier.findMany
      .mockResolvedValueOnce([{ code: 'SUP-0001' }])
      .mockResolvedValueOnce([{ code: 'SUP-0001' }, { code: 'SUP-0002' }]);
    mockPrisma.supplier.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockImplementationOnce(({ data }) => ({ id: 'sup-new', ...data, taxId: null }));

    await service.create(dto(), TENANT);

    expect(mockPrisma.supplier.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.supplier.create.mock.calls[0][0].data.code).toBe('SUP-0002');
    expect(mockPrisma.supplier.create.mock.calls[1][0].data.code).toBe('SUP-0003');
  });

  it('ไม่ retry ไม่รู้จบ — ชนซ้ำถึงเพดานแล้วโยนออกไป', async () => {
    mockPrisma.supplier.create.mockRejectedValue(uniqueViolation());

    await expect(service.create(dto(), TENANT)).rejects.toMatchObject({ code: 'P2002' });
    expect(mockPrisma.supplier.create).toHaveBeenCalledTimes(5);
  });

  it('code ที่ผู้ใช้ระบุเองแล้วซ้ำ = ความผิดของผู้ใช้ ต้องบอก ไม่ใช่แอบเปลี่ยนให้', async () => {
    mockPrisma.supplier.findFirst.mockResolvedValue({ id: 'sup-old', code: 'SUP-001' });

    await expect(service.create(dto({ code: 'SUP-001' }), TENANT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(mockPrisma.supplier.create).not.toHaveBeenCalled();
  });

  it('code ที่ผู้ใช้ระบุเองแล้วชนตอน insert — ไม่ retry ทับของเขา', async () => {
    mockPrisma.supplier.create.mockRejectedValue(uniqueViolation());

    await expect(service.create(dto({ code: 'SUP-777' }), TENANT)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(mockPrisma.supplier.create).toHaveBeenCalledTimes(1);
  });

  it('จัดสรรแยกตาม tenant — เลขของโรงแรมอื่นไม่เกี่ยวกัน', async () => {
    await service.create(dto(), 'tenant-2');

    expect(mockPrisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-2' }) }),
    );
  });
});
