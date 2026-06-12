import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/reservation.dto';

/**
 * สร้าง mock tx (Prisma transaction client) แบบยืดหยุ่น
 * ปรับพฤติกรรมผ่าน overrides
 */
function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    campPitch: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'pitch-1',
        zoneId: 'zone-1',
        zone: { basePrice: 800, weekendPrice: null },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    campReservation: {
      findFirst: jest.fn().mockResolvedValue(null), // ไม่มี clash
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'res-1', ...data })),
      update: jest.fn().mockResolvedValue({ id: 'res-1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'res-1', addonItems: [] }),
    },
    campAddon: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    campReservationAddon: {
      create: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

function makeService(tx: ReturnType<typeof makeTx>) {
  const prisma = {
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    campReservation: {
      findFirst: jest.fn().mockResolvedValue({ id: 'res-1' }),
      update: jest.fn().mockResolvedValue({ id: 'res-1' }),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ReservationsService(prisma as any);
}

const baseDto: CreateReservationDto = {
  campgroundId: 'cg-1',
  pitchId: 'pitch-1',
  guestFirstName: 'แจ็ค',
  checkIn: '2026-06-12T00:00:00.000Z',
  checkOut: '2026-06-15T00:00:00.000Z',
};

describe('ReservationsService.create', () => {
  it('คำนวณราคา 3 คืน * 800 = 2400 และสร้างการจองสำเร็จ', async () => {
    const tx = makeTx();
    const service = makeService(tx);
    const res = await service.create({ ...baseDto });
    expect(res.success).toBe(true);
    expect(res.data.totalPrice).toBe(2400);
    expect(res.data.status).toBe('pending');
  });

  it('ปฏิเสธเมื่อ checkOut <= checkIn', async () => {
    const service = makeService(makeTx());
    await expect(
      service.create({ ...baseDto, checkOut: '2026-06-12T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('โยน ConflictException เมื่อจุดถูกจองทับช่วงเวลา', async () => {
    const tx = makeTx();
    tx.campReservation.findFirst = jest.fn().mockResolvedValue({ id: 'clash' });
    const service = makeService(tx);
    await expect(service.create({ ...baseDto })).rejects.toBeInstanceOf(ConflictException);
  });

  it('โยน NotFoundException เมื่อ pitch ไม่มี', async () => {
    const tx = makeTx();
    tx.campPitch.findFirst = jest.fn().mockResolvedValue(null);
    const service = makeService(tx);
    await expect(service.create({ ...baseDto })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('add-on: รวมราคา + ตัด stock', async () => {
    const tx = makeTx();
    tx.campAddon.findFirst = jest.fn().mockResolvedValue({
      id: 'addon-1',
      name: 'เต็นท์ 3 คน',
      active: true,
      stockQty: 5,
      pricePerUnit: 300,
    });
    const service = makeService(tx);
    const res = await service.create({
      ...baseDto,
      addons: [{ addonId: 'addon-1', qty: 2 }],
    });
    // 2400 + (2 * 300) = 3000
    expect(res.data.totalPrice).toBe(3000);
    expect(tx.campAddon.update).toHaveBeenCalledWith({
      where: { id: 'addon-1' },
      data: { stockQty: { decrement: 2 } },
    });
  });

  it('add-on: stock ไม่พอ → ConflictException', async () => {
    const tx = makeTx();
    tx.campAddon.findFirst = jest.fn().mockResolvedValue({
      id: 'addon-1',
      name: 'เต็นท์',
      active: true,
      stockQty: 1,
      pricePerUnit: 300,
    });
    const service = makeService(tx);
    await expect(
      service.create({ ...baseDto, addons: [{ addonId: 'addon-1', qty: 3 }] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ReservationsService.cancel', () => {
  it('คืน stock อุปกรณ์กลับคลังตอนยกเลิก', async () => {
    const tx = makeTx();
    tx.campReservation.findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'res-1',
      addonItems: [{ addonId: 'addon-1', qty: 2 }],
    });
    const service = makeService(tx);
    await service.cancel('res-1');
    expect(tx.campAddon.update).toHaveBeenCalledWith({
      where: { id: 'addon-1' },
      data: { stockQty: { increment: 2 } },
    });
  });
});
