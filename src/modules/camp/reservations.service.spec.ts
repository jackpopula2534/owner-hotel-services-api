import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/reservation.dto';
import { buildRevenuePostingStub } from '../revenue/__tests__/revenue-posting.stub';

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
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // ลานที่เชื่อมคลังกลาง (มี warehouseId) — create/cancel ถามตัวนี้เพื่อตัดสินว่า
    // จะบริหาร stock ของอุปกรณ์เช่าหรือไม่
    campground: {
      findFirst: jest.fn().mockResolvedValue({ warehouseId: 'wh-1' }),
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
  // การลงบัญชีเป็น side effect ที่ไม่บล็อกการรับเงิน — mock ทิ้งใน spec ชุดนี้
  const campAccounting = { postPaymentJournal: jest.fn().mockResolvedValue(undefined) };
  const revenuePosting = buildRevenuePostingStub();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ReservationsService(prisma as any, campAccounting as any, revenuePosting as any);
}

/** เหมือน {@link makeService} แต่คืนตัวโพสต์รายได้มาให้ตรวจว่าถูกเรียกด้วยอะไร */
function makeServiceWithRevenue(tx: ReturnType<typeof makeTx>) {
  const prisma = {
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    campReservation: {
      findFirst: jest.fn().mockResolvedValue({ id: 'res-1' }),
      update: jest.fn().mockResolvedValue({ id: 'res-1' }),
    },
  };
  const campAccounting = { postPaymentJournal: jest.fn().mockResolvedValue(undefined) };
  const revenuePosting = buildRevenuePostingStub();
  const service = new ReservationsService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    campAccounting as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    revenuePosting as any,
  );
  return { service, revenuePosting };
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

describe('ReservationsService.update', () => {
  /** การจองเดิม: 3 คืน จุด pitch-1 ยังไม่ได้รับเงิน */
  const currentReservation = {
    id: 'res-1',
    status: 'confirmed',
    pitchId: 'pitch-1',
    zoneId: 'zone-1',
    checkIn: new Date('2026-06-12T00:00:00.000Z'),
    checkOut: new Date('2026-06-15T00:00:00.000Z'),
    numGuests: 2,
    amountPaid: 0,
    addonItems: [],
  };

  function updateTx(overrides: Record<string, unknown> = {}) {
    const tx = makeTx();
    tx.campReservation.findFirst = jest
      .fn()
      // ครั้งที่ 1 = โหลดการจองเดิม, ครั้งที่ 2 = ตรวจจองซ้อน (null = ว่าง)
      .mockResolvedValueOnce({ ...currentReservation, ...overrides })
      .mockResolvedValueOnce(null);
    tx.campReservation.update = jest.fn().mockImplementation(({ data }) => ({ id: 'res-1', ...data }));
    return tx;
  }

  it('คิด totalPrice ใหม่เมื่อเปลี่ยนวัน (2 คืน * 800 = 1600)', async () => {
    const tx = updateTx();
    const service = makeService(tx);
    const res = await service.update('res-1', { checkOut: '2026-06-14T00:00:00.000Z' });
    expect(res.data.totalPrice).toBe(1600);
  });

  // Regression: update() เดิมเขียนทับข้อมูลโดยไม่ตรวจคิวของจุดปลายทางเลย
  // การย้ายจุดจึงทับการจองคนอื่นได้เงียบๆ ทั้งที่ create() ตรวจอยู่
  it('โยน ConflictException เมื่อย้ายไปจุดที่มีคนจองทับช่วงเวลา', async () => {
    const tx = makeTx();
    tx.campReservation.findFirst = jest
      .fn()
      .mockResolvedValueOnce(currentReservation)
      .mockResolvedValueOnce({ id: 'other-res' }); // มีคนจองจุดปลายทางอยู่
    const service = makeService(tx);
    await expect(service.update('res-1', { pitchId: 'pitch-2' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('ปฏิเสธเมื่อ checkOut <= checkIn', async () => {
    const service = makeService(updateTx());
    await expect(
      service.update('res-1', { checkOut: '2026-06-12T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('ปฏิเสธเมื่อยอดใหม่ต่ำกว่าเงินที่รับมาแล้ว (ต้องคืนเงินก่อน)', async () => {
    const tx = updateTx({ amountPaid: 2400 });
    const service = makeService(tx);
    // ย่อเหลือ 1 คืน = 800 ซึ่งต่ำกว่ายอดที่จ่ายมาแล้ว 2400
    await expect(
      service.update('res-1', { checkOut: '2026-06-13T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('ปฏิเสธการแก้ไขการจองที่ยกเลิกไปแล้ว', async () => {
    const tx = updateTx({ status: 'cancelled' });
    const service = makeService(tx);
    await expect(service.update('res-1', { numGuests: 3 })).rejects.toBeInstanceOf(Error);
  });

  it('รวมราคา add-on เดิมเข้ายอดใหม่ด้วย', async () => {
    const tx = updateTx({ addonItems: [{ addonId: 'addon-1', qty: 2, priceSnapshot: 300 }] });
    const service = makeService(tx);
    const res = await service.update('res-1', { checkOut: '2026-06-14T00:00:00.000Z' });
    // 2 คืน * 800 + (2 * 300) = 2200
    expect(res.data.totalPrice).toBe(2200);
  });

  it('อัปเดต paymentStatus เป็น partial เมื่อยอดใหม่สูงกว่าที่จ่ายไว้', async () => {
    const tx = updateTx({ amountPaid: 800 });
    const service = makeService(tx);
    const res = await service.update('res-1', { checkOut: '2026-06-14T00:00:00.000Z' });
    expect(res.data.paymentStatus).toBe('partial');
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

  it('ดึงรายได้ที่เคยลงไว้กลับ ในทรานแซกชันเดียวกับการยกเลิก', async () => {
    const tx = makeTx();
    tx.campReservation.findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 'res-1',
      tenantId: 'tenant-1',
      addonItems: [],
    });
    const { service, revenuePosting } = makeServiceWithRevenue(tx);
    await service.cancel('res-1');

    expect(revenuePosting.voidWithin).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: 'tenant-1',
        sourceType: 'CAMP_RESERVATION',
        sourceId: 'res-1',
      }),
    );
  });
});

// ── เช็คเอาต์แล้วรายได้ต้องลงสมุด ────────────────────────────────────
/**
 * แขกออกจากลาน = รายได้เกิดขึ้นแล้ว
 *
 * ก่อนหน้านี้ยอดของลานมีอยู่ที่ `camp_reservations.totalPrice` ที่เดียว ใครอยากได้
 * ยอดขายต้องไปนับเอง คนละเงื่อนไขสถานะ สเปกชุดนี้ตรึงว่าเช็คเอาต์ต้องยิงเข้าสมุด
 * รายได้กลางในทรานแซกชันเดียวกัน และค่าเช่าอุปกรณ์ต้องแยกออกจากค่าที่พัก
 */
describe('ReservationsService.checkOut — สมุดรายได้', () => {
  const checkedOutTx = (row: Record<string, unknown>) => {
    const tx = makeTx();
    tx.campReservation.update = jest
      .fn()
      .mockResolvedValue({ id: 'res-1', pitchId: 'pitch-1', campgroundId: 'cg-1' });
    tx.campReservation.findFirst = jest.fn().mockResolvedValue(row);
    tx.campground.findFirst = jest.fn().mockResolvedValue({ name: 'ลานริมธาร' });
    return tx;
  };

  const baseRow = {
    id: 'res-1',
    tenantId: 'tenant-1',
    campgroundId: 'cg-1',
    reservationNo: 'CMP-20260817-1234',
    paymentMethod: 'transfer',
    checkOut: new Date('2026-08-17T05:00:00.000Z'),
    actualCheckOut: new Date('2026-08-17T04:30:00.000Z'),
    totalPrice: 2400,
    addonItems: [],
  };

  it('ลงค่าที่พักเป็น ROOM พร้อมมิติของลาน', async () => {
    const tx = checkedOutTx(baseRow);
    const { service, revenuePosting } = makeServiceWithRevenue(tx);
    await service.checkOut('res-1');

    expect(revenuePosting.postWithin).toHaveBeenCalledTimes(1);
    const [passedTx, input] = revenuePosting.postWithin.mock.calls[0];
    expect(passedTx).toBe(tx);
    expect(input).toMatchObject({
      tenantId: 'tenant-1',
      sourceModule: 'CAMP',
      sourceType: 'CAMP_RESERVATION',
      sourceId: 'res-1',
      documentNo: 'CMP-20260817-1234',
      outletId: 'cg-1',
      outletName: 'ลานริมธาร',
      settlement: 'TRANSFER',
    });
    expect(input.lines).toEqual([{ revenueType: 'ROOM', grossAmount: 2400 }]);
  });

  it('แยกค่าเช่าอุปกรณ์ออกจากค่าที่พัก (คนละแผนกในผังบัญชี)', async () => {
    const tx = checkedOutTx({
      ...baseRow,
      addonItems: [{ qty: 2, priceSnapshot: 300 }],
    });
    const { service, revenuePosting } = makeServiceWithRevenue(tx);
    await service.checkOut('res-1');

    expect(revenuePosting.postWithin.mock.calls[0][1].lines).toEqual([
      { revenueType: 'ROOM', grossAmount: 1800 },
      { revenueType: 'OTHER', grossAmount: 600 },
    ]);
  });

  it('การจองยอดศูนย์ (คอมพลิเมนต์) เช็คเอาต์ได้โดยไม่ต้องมีแถวในสมุด', async () => {
    const tx = checkedOutTx({ ...baseRow, totalPrice: 0 });
    const { service, revenuePosting } = makeServiceWithRevenue(tx);
    const res = await service.checkOut('res-1');

    expect(res.success).toBe(true);
    expect(revenuePosting.postWithin).not.toHaveBeenCalled();
  });
});

// ── แก้ไขอุปกรณ์เช่า ──────────────────────────────────────────────
interface AddonRow {
  addonId: string;
  qty: number;
  priceSnapshot: number;
}

/** จองที่มีอุปกรณ์เดิมตามที่ระบุ; โซน 800/คืน 3 คืน = 2400 */
function addonsTx(opts: { existing?: AddonRow[]; amountPaid?: number; status?: string } = {}) {
  const tx = makeTx();
  tx.campReservation.findFirst = jest.fn().mockResolvedValue({
    id: 'res-1',
    campgroundId: 'cg-1',
    status: opts.status ?? 'confirmed',
    numGuests: 2,
    amountPaid: opts.amountPaid ?? 0,
    checkIn: new Date('2026-06-12T00:00:00.000Z'),
    checkOut: new Date('2026-06-15T00:00:00.000Z'),
    addonItems: opts.existing ?? [],
    pitch: { zone: { basePrice: 800, weekendPrice: null } },
  });
  tx.campReservation.update = jest
    .fn()
    .mockImplementation(({ data }) => ({ id: 'res-1', ...data }));
  return tx;
}

function addon(over: Record<string, unknown> = {}) {
  return {
    id: 'addon-1',
    name: 'เต็นท์ 3 คน',
    active: true,
    stockQty: 5,
    pricePerUnit: 300,
    ...over,
  };
}

describe('ReservationsService.updateAddons', () => {
  it('เพิ่มอุปกรณ์ใหม่ → คิดยอดรวมใหม่ + ตัด stock ตามจำนวนที่เพิ่ม', async () => {
    const tx = addonsTx();
    tx.campAddon.findFirst = jest.fn().mockResolvedValue(addon());
    const res = await makeService(tx).updateAddons('res-1', {
      addons: [{ addonId: 'addon-1', qty: 2 }],
    });
    expect(res.data.totalPrice).toBe(3000); // 2400 + 2*300
    expect(tx.campAddon.update).toHaveBeenCalledWith({
      where: { id: 'addon-1' },
      data: { stockQty: { decrement: 2 } },
    });
  });

  // จุดสำคัญ: ต้องขยับเฉพาะ "ส่วนต่าง" ไม่ใช่คืนของเดิมทั้งหมดแล้วตัดใหม่
  it('เพิ่มจำนวนของเดิม 1→3 → ตัด stock แค่ 2', async () => {
    const tx = addonsTx({ existing: [{ addonId: 'addon-1', qty: 1, priceSnapshot: 300 }] });
    tx.campAddon.findFirst = jest.fn().mockResolvedValue(addon());
    await makeService(tx).updateAddons('res-1', { addons: [{ addonId: 'addon-1', qty: 3 }] });
    expect(tx.campAddon.update).toHaveBeenCalledWith({
      where: { id: 'addon-1' },
      data: { stockQty: { decrement: 2 } },
    });
  });

  it('ลดจำนวน 3→1 → คืน stock 2 (decrement ติดลบ) แม้คลังเหลือ 0', async () => {
    const tx = addonsTx({ existing: [{ addonId: 'addon-1', qty: 3, priceSnapshot: 300 }] });
    tx.campAddon.findFirst = jest.fn().mockResolvedValue(addon({ stockQty: 0 }));
    await makeService(tx).updateAddons('res-1', { addons: [{ addonId: 'addon-1', qty: 1 }] });
    expect(tx.campAddon.update).toHaveBeenCalledWith({
      where: { id: 'addon-1' },
      data: { stockQty: { decrement: -2 } },
    });
  });

  it('ถอดอุปกรณ์ออกทั้งหมด → คืน stock เต็มจำนวน + ยอดเหลือค่าที่พัก', async () => {
    const tx = addonsTx({ existing: [{ addonId: 'addon-1', qty: 2, priceSnapshot: 300 }] });
    const res = await makeService(tx).updateAddons('res-1', { addons: [] });
    expect(res.data.totalPrice).toBe(2400);
    expect(tx.campAddon.update).toHaveBeenCalledWith({
      where: { id: 'addon-1' },
      data: { stockQty: { increment: 2 } },
    });
  });

  it('คงราคาเดิมของรายการที่จองไว้แล้ว แม้ราคาตั้งขายจะขึ้นไปแล้ว', async () => {
    const tx = addonsTx({ existing: [{ addonId: 'addon-1', qty: 1, priceSnapshot: 300 }] });
    tx.campAddon.findFirst = jest.fn().mockResolvedValue(addon({ pricePerUnit: 500 }));
    const res = await makeService(tx).updateAddons('res-1', {
      addons: [{ addonId: 'addon-1', qty: 2 }],
    });
    expect(res.data.totalPrice).toBe(3000); // 2400 + 2*300 (ไม่ใช่ 500)
  });

  it('stock ไม่พอสำหรับส่วนที่เพิ่ม → ConflictException', async () => {
    const tx = addonsTx();
    tx.campAddon.findFirst = jest.fn().mockResolvedValue(addon({ stockQty: 1 }));
    await expect(
      makeService(tx).updateAddons('res-1', { addons: [{ addonId: 'addon-1', qty: 4 }] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ลานที่ไม่ได้เชื่อมคลัง → ไม่ตรวจและไม่แตะ stock', async () => {
    const tx = addonsTx();
    tx.campground.findFirst = jest.fn().mockResolvedValue({ warehouseId: null });
    tx.campAddon.findFirst = jest.fn().mockResolvedValue(addon({ stockQty: 0 }));
    const res = await makeService(tx).updateAddons('res-1', {
      addons: [{ addonId: 'addon-1', qty: 9 }],
    });
    expect(res.data.totalPrice).toBe(2400 + 9 * 300);
    expect(tx.campAddon.update).not.toHaveBeenCalled();
  });

  it('รวมรายการซ้ำ addonId เดียวกันเป็นก้อนเดียว (กันตัด stock ซ้ำ)', async () => {
    const tx = addonsTx();
    tx.campAddon.findFirst = jest.fn().mockResolvedValue(addon());
    await makeService(tx).updateAddons('res-1', {
      addons: [
        { addonId: 'addon-1', qty: 1 },
        { addonId: 'addon-1', qty: 2 },
      ],
    });
    expect(tx.campAddon.update).toHaveBeenCalledTimes(1);
    expect(tx.campAddon.update).toHaveBeenCalledWith({
      where: { id: 'addon-1' },
      data: { stockQty: { decrement: 3 } },
    });
  });

  // ระบบไม่มีทางคืนเงินอัตโนมัติ — ยอดใหม่ห้ามต่ำกว่าที่รับมาแล้ว
  it('ถอดอุปกรณ์จนยอดต่ำกว่าเงินที่รับชำระมาแล้ว → BadRequestException', async () => {
    const tx = addonsTx({
      existing: [{ addonId: 'addon-1', qty: 2, priceSnapshot: 300 }],
      amountPaid: 3000,
    });
    await expect(
      makeService(tx).updateAddons('res-1', { addons: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.campReservationAddon.deleteMany).not.toHaveBeenCalled();
  });

  it('ยอดใหม่เท่ากับที่จ่ายมาแล้ว → paymentStatus = paid', async () => {
    const tx = addonsTx({ existing: [{ addonId: 'addon-1', qty: 2, priceSnapshot: 300 }] , amountPaid: 2400 });
    const res = await makeService(tx).updateAddons('res-1', { addons: [] });
    expect(res.data.paymentStatus).toBe('paid');
  });

  it('การจองที่ยกเลิกแล้ว → BadRequestException', async () => {
    const tx = addonsTx({ status: 'cancelled' });
    await expect(
      makeService(tx).updateAddons('res-1', { addons: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('เช็คเอาท์แล้ว → แก้อุปกรณ์ไม่ได้', async () => {
    const tx = addonsTx({ status: 'checked_out' });
    await expect(
      makeService(tx).updateAddons('res-1', { addons: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ไม่พบการจอง → NotFoundException', async () => {
    const tx = makeTx();
    tx.campReservation.findFirst = jest.fn().mockResolvedValue(null);
    await expect(
      makeService(tx).updateAddons('nope', { addons: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
