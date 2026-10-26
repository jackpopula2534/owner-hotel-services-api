import { BadRequestException, ConflictException } from '@nestjs/common';
import { CampOpsService } from './camp-ops.service';
import { ReservationsService } from './reservations.service';
import { extraChargesTotal, nonLodgingCharges, parseExtraCharges } from './camp-ops-shared';
import { buildRevenuePostingStub } from '../revenue/__tests__/revenue-posting.stub';
import { buildCampRevenueInput } from '../revenue/sources/camp-revenue.source';

/* eslint-disable @typescript-eslint/no-explicit-any */

const zone = { basePrice: 500, weekendPrice: null, pricingMode: 'per_night', hasElectricity: false, electricityFee: null };

function opsTx(overrides: Record<string, any> = {}) {
  const tx: any = {
    campPitch: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    campFacility: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    campReservation: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'res-1', ...data, pitch: { code: 'A1' } })),
      findUniqueOrThrow: jest.fn(),
    },
    campOpsTask: {
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'task-new', cost: null, ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'task-1', cost: null, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    campOpsEvent: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    campground: { findFirst: jest.fn().mockResolvedValue({ id: 'cg-1', name: 'ลาน', warehouseId: null }) },
    campAddon: { update: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  tx.$transaction = jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx));
  return tx;
}

function reservations(tx: any) {
  return new ReservationsService(
    tx,
    { postPaymentJournal: jest.fn().mockResolvedValue(undefined) } as any,
    buildRevenuePostingStub() as any,
    { addPointsForStay: jest.fn().mockResolvedValue(null) } as any,
  );
}

const stay = (o: Record<string, any> = {}) => ({
  id: 'res-1',
  tenantId: 't1',
  campgroundId: 'cg-1',
  pitchId: 'pitch-1',
  guestFirstName: 'สมชาย',
  guestLastName: null,
  status: 'confirmed',
  checkIn: new Date('2026-10-23T00:00:00.000Z'),
  checkOut: new Date('2026-10-25T00:00:00.000Z'),
  numGuests: 2,
  totalPrice: 1000,
  amountPaid: 0,
  extraCharges: null,
  addonItems: [],
  pitch: { id: 'pitch-1', code: 'A1', status: 'available', zone },
  ...o,
});

describe('extra charges helpers', () => {
  it('อ่านแถวที่ถูกต้อง ทิ้งแถวเสีย และแยกส่วนที่ไม่ใช่ค่าที่พัก', () => {
    const list = parseExtraCharges([
      { id: 'a', label: 'ค่าเสียหาย', amount: 300, kind: 'damage' },
      { id: 'b', label: 'ส่วนลด', amount: -100, kind: 'adjustment' },
      { label: 42 },
      'junk',
    ]);
    expect(list).toHaveLength(2);
    expect(extraChargesTotal(list)).toBe(200);
    expect(nonLodgingCharges(list)).toBe(300);
  });

  it('รายได้: ค่าเสียหายลง OTHER ไม่ปนค่าที่พัก', () => {
    const input = buildCampRevenueInput(
      {
        id: 'r',
        tenantId: 't1',
        campgroundId: 'cg-1',
        reservationNo: 'CMP-1',
        paymentMethod: 'cash',
        checkOut: new Date(),
        actualCheckOut: new Date(),
        totalPrice: 1300,
        addonItems: [],
        extraCharges: [{ id: 'a', label: 'ค่าเสียหาย', amount: 300, kind: 'damage' }],
      },
      { campgroundId: 'cg-1', campgroundName: 'ลาน' },
    );
    expect(input.lines).toEqual([
      expect.objectContaining({ revenueType: 'ROOM', grossAmount: 1000 }),
      expect.objectContaining({ revenueType: 'OTHER', grossAmount: 300 }),
    ]);
  });
});

describe('ReservationsService — งานหน้าลาน', () => {
  it('เช็คอิน: เก็บทะเบียนรถ/ตรวจบัตร จุดเป็น occupied ปิดงานแม่บ้านค้าง และลงกิจกรรม', async () => {
    const tx = opsTx();
    tx.campReservation.findFirst = jest.fn().mockResolvedValueOnce(stay()).mockResolvedValueOnce(null);
    await reservations(tx).checkIn('res-1', 't1', { idVerified: true, vehiclePlate: ' กข 1234 ' }, 'u1');
    const data = tx.campReservation.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ status: 'checked_in', vehiclePlate: 'กข 1234' }));
    expect(data.idVerifiedAt).toBeInstanceOf(Date);
    expect(tx.campPitch.update).toHaveBeenCalledWith({ where: { id: 'pitch-1' }, data: { status: 'occupied' } });
    expect(tx.campOpsTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'done' }) }),
    );
    expect(tx.campOpsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'check_in', actorId: 'u1' }) }),
    );
  });

  it('เช็คอิน: ไม่ให้เข้าจุดที่ยังมีแขกคนอื่น หรือจุดปิดซ่อม', async () => {
    const tx = opsTx();
    tx.campReservation.findFirst = jest
      .fn()
      .mockResolvedValueOnce(stay())
      .mockResolvedValueOnce({ guestFirstName: 'คนเก่า' });
    await expect(reservations(tx).checkIn('res-1', 't1')).rejects.toBeInstanceOf(ConflictException);

    const tx2 = opsTx();
    tx2.campReservation.findFirst = jest
      .fn()
      .mockResolvedValueOnce(stay({ pitch: { id: 'pitch-1', code: 'A1', status: 'maintenance', zone } }));
    await expect(reservations(tx2).checkIn('res-1', 't1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('เช็คเอาท์: ค่าเสียหายเข้าบิล และเปิดงานทำความสะอาดมอบหมายแม่บ้าน', async () => {
    const tx = opsTx();
    tx.campReservation.findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: 'res-1' }) // ensureExists
      .mockResolvedValueOnce({ status: 'checked_in' }) // before
      .mockResolvedValue({ id: 'res-1', addonItems: [] }); // revenue row
    tx.campReservation.findUniqueOrThrow = jest.fn().mockResolvedValue(stay({ status: 'checked_in', amountPaid: 1000 }));
    tx.campReservation.update = jest
      .fn()
      .mockImplementation(({ data }) => ({ ...stay({ status: 'checked_in' }), ...data, pitch: { code: 'A1' } }));
    await reservations(tx).checkOut('res-1', 't1', { damageFee: 300, housekeeperName: 'พี่นิด' }, 'u1');

    const chargeWrite = tx.campReservation.update.mock.calls[0][0].data;
    expect(chargeWrite.totalPrice).toBe(1300);
    expect(chargeWrite.extraCharges).toEqual([expect.objectContaining({ kind: 'damage', amount: 300 })]);
    expect(tx.campOpsTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'cleaning', assigneeName: 'พี่นิด', status: 'in_progress' }),
    });
  });

  it('ยกเลิก No-show แขกที่เช็คอินแล้ว: จุดไปรอแม่บ้าน + เก็บเหตุผล', async () => {
    const tx = opsTx();
    tx.campReservation.findFirst = jest.fn().mockResolvedValue({ id: 'res-1' });
    tx.campReservation.findUniqueOrThrow = jest.fn().mockResolvedValue(stay({ status: 'checked_in', amountPaid: 500, notes: null }));
    tx.campReservation.update = jest.fn().mockImplementation(({ data }) => data);
    const svc = new ReservationsService(
      tx,
      {} as any,
      buildRevenuePostingStub() as any,
      {} as any,
    );
    await svc.cancel('res-1', 't1', { reason: 'no_show', depositAction: 'keep' }, 'u1');
    expect(tx.campPitch.update).toHaveBeenCalledWith({ where: { id: 'pitch-1' }, data: { status: 'cleaning' } });
    const data = tx.campReservation.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ status: 'cancelled', cancelReason: 'no_show' }));
    expect(data.notes).toContain('No-show');
  });

  it('ย้ายแขกที่เช็คอินแล้ว: จุดใหม่ occupied จุดเดิมรอแม่บ้าน และไม่คิดส่วนต่างได้', async () => {
    const tx = opsTx();
    tx.campReservation.findFirst = jest
      .fn()
      .mockResolvedValueOnce(stay({ status: 'checked_in', pitch: { id: 'pitch-1', code: 'A1' } }))
      .mockResolvedValueOnce(null);
    tx.campPitch.findFirst = jest.fn().mockResolvedValue({
      id: 'pitch-2',
      code: 'D1',
      status: 'available',
      zoneId: 'zone-d',
      zone: { ...zone, basePrice: 1800 },
    });
    tx.campReservation.update = jest.fn().mockImplementation(({ data }) => data);
    await reservations(tx).update('res-1', { pitchId: 'pitch-2', waivePriceDifference: true }, 't1', 'u1');

    const data = tx.campReservation.update.mock.calls[0][0].data;
    expect(data.totalPrice).toBe(1000);
    expect(data.extraCharges).toEqual([expect.objectContaining({ kind: 'adjustment', amount: -2600 })]);
    expect(tx.campPitch.update).toHaveBeenCalledWith({ where: { id: 'pitch-2' }, data: { status: 'occupied' } });
    expect(tx.campPitch.update).toHaveBeenCalledWith({ where: { id: 'pitch-1' }, data: { status: 'cleaning' } });
    expect(tx.campOpsTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'cleaning', pitchId: 'pitch-1' }) });
  });

  it('ค่าใช้จ่ายติดลบใช้ได้เฉพาะปรับราคา', async () => {
    const tx = opsTx();
    await expect(
      reservations(tx).addCharge('res-1', { label: 'x', amount: -50, kind: 'damage' }, 't1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CampOpsService', () => {
  it('ทำความสะอาดเสร็จ → จุดพร้อมขาย', async () => {
    const tx = opsTx();
    tx.campOpsTask.findFirst = jest.fn().mockResolvedValue({
      id: 'task-1',
      tenantId: 't1',
      campgroundId: 'cg-1',
      pitchId: 'pitch-1',
      facilityId: null,
      type: 'cleaning',
      status: 'in_progress',
      title: 'ทำความสะอาดจุด',
      assigneeName: 'พี่นิด',
      startedAt: new Date(),
    });
    tx.campPitch.findFirst = jest.fn().mockResolvedValue({ id: 'pitch-1', code: 'B5', status: 'cleaning' });
    await new CampOpsService(tx).updateTask('task-1', { status: 'done' }, 't1', 'u1');
    expect(tx.campPitch.update).toHaveBeenCalledWith({ where: { id: 'pitch-1' }, data: { status: 'available' } });
    expect(tx.campOpsEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ message: 'ทำความสะอาด B5 เสร็จ' }) }),
    );
  });

  it('แจ้งซ่อมแบบปิดจุด → จุดเป็น maintenance, ปิดงานแล้วส่งแม่บ้าน', async () => {
    const tx = opsTx();
    tx.campPitch.findFirst = jest.fn().mockResolvedValue({ id: 'pitch-1', code: 'D3', status: 'available' });
    await new CampOpsService(tx).createTask(
      { campgroundId: 'cg-1', type: 'maintenance', pitchId: 'pitch-1', title: 'ท่อน้ำรั่ว', blocksPitch: true },
      't1',
      'u1',
    );
    expect(tx.campPitch.update).toHaveBeenCalledWith({ where: { id: 'pitch-1' }, data: { status: 'maintenance' } });

    const tx2 = opsTx();
    tx2.campOpsTask.findFirst = jest.fn().mockResolvedValue({
      id: 'task-1',
      campgroundId: 'cg-1',
      pitchId: 'pitch-1',
      type: 'maintenance',
      status: 'open',
      title: 'ท่อน้ำรั่ว',
      assigneeName: null,
    });
    tx2.campPitch.findFirst = jest.fn().mockResolvedValue({ id: 'pitch-1', code: 'D3', status: 'maintenance' });
    await new CampOpsService(tx2).updateTask('task-1', { status: 'done', cost: 350 }, 't1');
    expect(tx2.campPitch.update).toHaveBeenCalledWith({ where: { id: 'pitch-1' }, data: { status: 'cleaning' } });
    expect(tx2.campOpsTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'cleaning' }) });
  });

  it('จุดที่มีแขกพักเปลี่ยนสถานะเองไม่ได้', async () => {
    const tx = opsTx();
    tx.campPitch.findFirst = jest.fn().mockResolvedValue({ id: 'pitch-1', code: 'A2', status: 'occupied', campgroundId: 'cg-1' });
    tx.campReservation.findFirst = jest.fn().mockResolvedValue({ id: 'res-1' });
    await expect(
      new CampOpsService(tx).setPitchStatus('pitch-1', { status: 'closed' }, 't1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('board: คำนวณยอดค้างและยอดรับวันนี้', async () => {
    const tx = opsTx();
    tx.campReservation.findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          ...stay({ status: 'checked_in', totalPrice: 1300, amountPaid: 1000 }),
          reservationNo: 'CMP-1',
          guestPhone: null,
          numVehicles: 1,
          vehiclePlate: null,
          idVerifiedAt: null,
          paymentStatus: 'partial',
          source: 'STAFF',
          notes: null,
          addonItems: [],
        },
      ])
      .mockResolvedValueOnce([{ payments: [{ at: new Date().toISOString(), amount: 1000 }, { at: '2020-01-01', amount: 5 }] }]);
    const res = await new CampOpsService(tx).board('cg-1', 't1');
    expect(res.data.stays[0]).toEqual(expect.objectContaining({ balance: 300, guestName: 'สมชาย', checkIn: '2026-10-23' }));
    expect(res.data.revenueToday).toBe(1000);
  });
});
