/**
 * รหัสร้านอาหารเป็นของแต่ละกิจการ ไม่ใช่ของทั้งฐานข้อมูล.
 *
 * `restaurants.code` used to carry a global UNIQUE index while the generator
 * numbered per tenant, so the first tenant to take RES-001 locked out every
 * other tenant's first restaurant — the pre-flight check is tenant-scoped, so
 * it passed and the raw `restaurants_code_key` error reached the screen.
 */

import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RestaurantService } from '../restaurant.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('RestaurantService — รหัสร้าน', () => {
  let service: RestaurantService;

  const prisma = {
    restaurant: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const TENANT = 'tenant-new';
  const NEW_RESTAURANT = { name: 'The Grand Bistro', propertyId: 'prop-1', isActive: true };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [RestaurantService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(RestaurantService);

    prisma.restaurant.findMany.mockResolvedValue([]);
    prisma.restaurant.findFirst.mockResolvedValue(null);
    prisma.restaurant.create.mockImplementation(({ data }: any) => ({ id: 'r-1', ...data }));
  });

  it('กิจการที่ยังไม่มีร้านเลย สร้างร้านแรกได้ ได้รหัส RES-001', async () => {
    const created: any = await service.create({ ...NEW_RESTAURANT } as any, TENANT);

    expect(created.code).toBe('RES-001');
    // The duplicate check must be scoped the same way the DB constraint is,
    // or it clears a code the database will then reject.
    expect(prisma.restaurant.findFirst).toHaveBeenCalledWith({
      where: { code: 'RES-001', tenantId: TENANT },
    });
    expect(prisma.restaurant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: TENANT }) }),
    );
  });

  it('นับต่อจากรหัสที่สูงสุด ไม่ใช่นับจำนวนร้าน — ลบร้านแล้วต้องไม่ออกรหัสซ้ำ', async () => {
    // Two restaurants exist but the numbering already reached 003: counting
    // rows would hand out RES-003 again.
    prisma.restaurant.findMany.mockResolvedValue([{ code: 'RES-001' }, { code: 'RES-003' }]);

    const created: any = await service.create({ ...NEW_RESTAURANT } as any, TENANT);

    expect(created.code).toBe('RES-004');
  });

  it('รหัสที่ไม่ได้อยู่ในรูปแบบ RES-### ไม่ทำให้การนับพัง', async () => {
    prisma.restaurant.findMany.mockResolvedValue([{ code: 'MVR-MAIN' }, { code: 'MVR-BAR' }]);

    const created: any = await service.create({ ...NEW_RESTAURANT } as any, TENANT);

    expect(created.code).toBe('RES-001');
  });

  it('ระบุรหัสเองที่ซ้ำ ต้องได้ข้อความภาษาไทย ไม่ใช่ชื่อ index ของฐานข้อมูล', async () => {
    prisma.restaurant.findFirst.mockResolvedValue({ id: 'r-existing', code: 'RES-001' });

    await expect(
      service.create({ ...NEW_RESTAURANT, code: 'RES-001' } as any, TENANT),
    ).rejects.toThrow(/มีร้านอาหารรหัส 'RES-001' อยู่แล้ว/);
    expect(prisma.restaurant.create).not.toHaveBeenCalled();
  });

  it('ชนกันตอนสร้างพร้อมกัน ต้องแปลง P2002 เป็นข้อความที่อ่านรู้เรื่อง', async () => {
    prisma.restaurant.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: { target: 'restaurants_tenantId_code_key' },
      }),
    );

    // Never let the constraint name reach the user.
    await expect(service.create({ ...NEW_RESTAURANT } as any, TENANT)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.create({ ...NEW_RESTAURANT } as any, TENANT)).rejects.not.toThrow(
      /restaurants_tenantId_code_key/,
    );
  });

  it('ข้อผิดพลาดอื่นต้องไม่ถูกกลืนเป็นรหัสซ้ำ', async () => {
    prisma.restaurant.create.mockRejectedValue(new Error('db down'));

    await expect(service.create({ ...NEW_RESTAURANT } as any, TENANT)).rejects.toThrow('db down');
  });

  it('ไม่มี tenant ต้องไม่ยอมสร้าง', async () => {
    await expect(service.create({ ...NEW_RESTAURANT } as any, undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.restaurant.create).not.toHaveBeenCalled();
  });
});
