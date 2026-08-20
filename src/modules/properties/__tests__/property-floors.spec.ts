import { BadRequestException } from '@nestjs/common';
import { PropertiesService } from '../properties.service';

/**
 * จำนวนชั้นของที่พัก — คอลัมน์ properties.floors
 *
 * ก่อนมีคอลัมน์นี้ ไม่มีที่ไหนในระบบบอกได้เลยว่าโรงแรมหลังหนึ่งมีกี่ชั้น
 * ชั้นถูกพิมพ์ทีละห้องใน rooms.floor เท่านั้น หน้าจอจึงต้องเดาเอง —
 * บางที่ไล่จากห้องจริง บางที่ฮาร์ดโค้ดชั้น 1-5 ทิ้งไว้
 *
 * เทสต์ชุดนี้ตรึงกฎที่ทำให้ค่านี้เชื่อถือได้: ลดจำนวนชั้นทิ้งห้องไว้ข้างบนไม่ได้
 */
describe('PropertiesService.update — floors', () => {
  const TENANT = 'tenant-1';
  const PROPERTY = 'prop-1';

  function makeService(highestRoomFloor: number | null) {
    const prisma = {
      property: {
        findFirst: jest.fn(async () => ({ id: PROPERTY, tenantId: TENANT, floors: 5 })),
        update: jest.fn(async ({ data }: any) => ({ id: PROPERTY, ...data })),
      },
      room: {
        aggregate: jest.fn(async () => ({ _max: { floor: highestRoomFloor } })),
      },
    };
    const audit = { logPropertyUpdate: jest.fn() };
    const service = new PropertiesService(prisma as any, audit as any, {} as any);
    // findOne ดึงสถิติทั้งหน้ารายละเอียด — ไม่ใช่สิ่งที่เทสต์ชุดนี้สนใจ
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: PROPERTY, tenantId: TENANT, floors: 5 } as any);
    return { service, prisma };
  }

  it('saves the new floor count', async () => {
    const { service, prisma } = makeService(2);

    await service.update(PROPERTY, { floors: 8 }, TENANT);

    expect(prisma.property.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ floors: 8 }) }),
    );
  });

  it('refuses to cut floors out from under existing rooms', async () => {
    const { service, prisma } = makeService(5);

    await expect(service.update(PROPERTY, { floors: 3 }, TENANT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.property.update).not.toHaveBeenCalled();
  });

  it('names the floor that is in the way', async () => {
    const { service } = makeService(5);

    await expect(service.update(PROPERTY, { floors: 3 }, TENANT)).rejects.toThrow(/ชั้น 5/);
  });

  it('lets a property with no rooms yet be set to any floor count', async () => {
    const { service, prisma } = makeService(null);

    await service.update(PROPERTY, { floors: 1 }, TENANT);

    expect(prisma.property.update).toHaveBeenCalled();
  });

  it('leaves the room check alone when the update does not touch floors', async () => {
    const { service, prisma } = makeService(5);

    await service.update(PROPERTY, { name: 'ชื่อใหม่' }, TENANT);

    expect(prisma.room.aggregate).not.toHaveBeenCalled();
    expect(prisma.property.update).toHaveBeenCalled();
  });
});
