import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PitchesService } from './pitches.service';

/**
 * บันทึกตำแหน่งหมุดหลายจุด (ลากในฉาก 3D)
 *  - id ทุกตัวต้องอยู่ในลาน + tenant เดียวกัน ไม่งั้นปฏิเสธทั้งชุด ไม่บันทึกครึ่งเดียว
 *  - updateMany ยังมี scope ลาน/tenant ซ้ำ กันแก้ข้าม tenant แม้ขั้นตรวจจะพลาด
 */
describe('PitchesService.updatePositions', () => {
  const TENANT = 'tenant-1';
  const CAMP = 'camp-1';

  const makePrisma = (ownPitches: string[], ownFacilities: string[]) => {
    const prisma = {
      campPitch: {
        findMany: jest.fn().mockResolvedValue(ownPitches.map((id) => ({ id }))),
        updateMany: jest.fn((args) => ({ op: 'pitch', args })),
      },
      campFacility: {
        findMany: jest.fn().mockResolvedValue(ownFacilities.map((id) => ({ id }))),
        updateMany: jest.fn((args) => ({ op: 'facility', args })),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return prisma;
  };

  it('updates pitches and facilities scoped to the camp and tenant', async () => {
    const prisma = makePrisma(['p1', 'p2'], ['f1']);
    const service = new PitchesService(prisma as never);
    const res = await service.updatePositions(
      {
        campgroundId: CAMP,
        pitches: [
          { id: 'p1', posX: 0.1, posY: 0.2 },
          { id: 'p2', posX: 0.3, posY: 0.4 },
        ],
        facilities: [{ id: 'f1', posX: 0.5, posY: 0.6 }],
      },
      TENANT,
    );

    expect(res.data).toEqual({ pitches: 2, facilities: 1 });
    expect(prisma.campPitch.findMany).toHaveBeenCalledWith({
      where: { campgroundId: CAMP, tenantId: TENANT, id: { in: ['p1', 'p2'] } },
      select: { id: true },
    });
    expect(prisma.campPitch.updateMany).toHaveBeenCalledWith({
      where: { campgroundId: CAMP, tenantId: TENANT, id: 'p1' },
      data: { posX: 0.1, posY: 0.2 },
    });
    expect(prisma.campFacility.updateMany).toHaveBeenCalledWith({
      where: { campgroundId: CAMP, tenantId: TENANT, id: 'f1' },
      data: { posX: 0.5, posY: 0.6 },
    });
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
  });

  it('rejects the whole batch when one id belongs to another camp or tenant', async () => {
    const prisma = makePrisma(['p1'], []);
    const service = new PitchesService(prisma as never);
    await expect(
      service.updatePositions(
        {
          campgroundId: CAMP,
          pitches: [
            { id: 'p1', posX: 0.1, posY: 0.2 },
            { id: 'foreign', posX: 0.3, posY: 0.4 },
          ],
        },
        TENANT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps the last position when an id is sent twice', async () => {
    const prisma = makePrisma(['p1'], []);
    const service = new PitchesService(prisma as never);
    await service.updatePositions(
      {
        campgroundId: CAMP,
        pitches: [
          { id: 'p1', posX: 0.1, posY: 0.1 },
          { id: 'p1', posX: 0.9, posY: 0.9 },
        ],
      },
      TENANT,
    );
    expect(prisma.campPitch.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.campPitch.updateMany.mock.calls[0][0].data).toEqual({ posX: 0.9, posY: 0.9 });
  });

  it('writes rotation only for markers that send one', async () => {
    const prisma = makePrisma(['p1', 'p2'], []);
    const service = new PitchesService(prisma as never);
    await service.updatePositions(
      {
        campgroundId: CAMP,
        pitches: [
          { id: 'p1', posX: 0.1, posY: 0.2, rotation: 45 },
          { id: 'p2', posX: 0.3, posY: 0.4 },
        ],
      },
      TENANT,
    );
    expect(prisma.campPitch.updateMany).toHaveBeenCalledWith({
      where: { campgroundId: CAMP, tenantId: TENANT, id: 'p1' },
      data: { posX: 0.1, posY: 0.2, rotation: 45 },
    });
    expect(prisma.campPitch.updateMany).toHaveBeenCalledWith({
      where: { campgroundId: CAMP, tenantId: TENANT, id: 'p2' },
      data: { posX: 0.3, posY: 0.4 },
    });
  });

  it('rejects an empty batch', async () => {
    const service = new PitchesService(makePrisma([], []) as never);
    await expect(service.updatePositions({ campgroundId: CAMP }, TENANT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
