import { RevenueSegment, RevenueType, SettlementType } from '@prisma/client';
import { round2 } from '@/common/utils/bangkok-day.util';
import { hasPostableRevenue, segmentOf, type PostRevenueInput } from '../revenue-posting.service';
import {
  buildOrderRevenueInput,
  menuRevenueTypeOf,
  type OrderRevenueRow,
} from '../sources/order-revenue.source';
import { buildRetailSaleRevenueInput } from '../sources/retail-sale-revenue.source';
import { buildBookingRevenueInput } from '../sources/booking-revenue.source';
import { buildCampRevenueInput } from '../sources/camp-revenue.source';
import { isKnownPaymentMethod, settlementOf } from '../sources/settlement.util';

/**
 * ยอดที่สมุดรายได้จะบันทึกจริงของทั้งเอกสาร
 *
 * เป็นตัวเดียวกับที่ `normalize()` คำนวณ (net + ค่าบริการ + ภาษี) — ทุกเทสต์ในไฟล์นี้
 * วัดกับยอดบนหน้าเอกสาร เพราะกติกาข้อเดียวที่ห้ามพลาดคือ **ผลรวมในสมุดต้องเท่ากับ
 * ยอดที่ลูกค้าจ่าย** ถ้าตัวแปลงแตกยอดผิด เงินจะหายหรืองอกโดยไม่มีอะไรฟ้อง
 */
const documentTotal = (input: PostRevenueInput): number =>
  round2(
    input.lines.reduce(
      (sum, line) =>
        sum +
        (line.grossAmount ?? 0) -
        (line.discount ?? 0) +
        (line.serviceCharge ?? 0) +
        (line.taxAmount ?? 0),
      0,
    ),
  );

const netOf = (input: PostRevenueInput, type: RevenueType): number =>
  round2(
    input.lines
      .filter((l) => l.revenueType === type)
      .reduce((sum, l) => sum + (l.grossAmount ?? 0) - (l.discount ?? 0), 0),
  );

const OUTLET = { restaurantId: 'rest-1', restaurantName: 'ห้องอาหารริมสระ', propertyId: 'prop-1' };

const orderItem = (totalPrice: number, revenueType: RevenueType | null, status = 'SERVED') => ({
  status,
  totalPrice,
  menuItem: { category: revenueType === null ? null : { revenueType } },
});

const makeOrder = (overrides: Partial<OrderRevenueRow> = {}): OrderRevenueRow => ({
  id: 'order-1',
  tenantId: 'tenant-1',
  orderNumber: 'ORD-20260817-0001',
  restaurantId: 'rest-1',
  paymentMethod: 'CASH',
  paymentStatus: 'PAID',
  folioChargeId: null,
  subtotal: 1000,
  discount: 0,
  serviceCharge: 100,
  taxAmount: 77,
  total: 1177,
  completedAt: new Date('2026-08-17T05:30:00.000Z'),
  createdAt: new Date('2026-08-17T04:00:00.000Z'),
  items: [orderItem(700, RevenueType.FOOD), orderItem(300, RevenueType.BEVERAGE)],
  ...overrides,
});

describe('settlementOf', () => {
  it('รวมคำของทั้งสี่โมดูลให้เป็นชุดเดียว', () => {
    expect(settlementOf('CASH')).toBe(SettlementType.CASH);
    expect(settlementOf('cash')).toBe(SettlementType.CASH);
    expect(settlementOf('CREDIT_CARD')).toBe(SettlementType.CARD);
    expect(settlementOf('DEBIT_CARD')).toBe(SettlementType.CARD);
    expect(settlementOf('CARD')).toBe(SettlementType.CARD);
    expect(settlementOf('ROOM_CHARGE')).toBe(SettlementType.ROOM_CHARGE);
    expect(settlementOf('bank transfer')).toBe(SettlementType.TRANSFER);
  });

  it('QR ไม่ใช่เงินสด — เงินเข้าบัญชี ไม่ได้เข้าลิ้นชัก', () => {
    expect(settlementOf('QR_PAYMENT')).toBe(SettlementType.TRANSFER);
    expect(settlementOf('QR')).toBe(SettlementType.TRANSFER);
    expect(settlementOf('promptpay')).toBe(SettlementType.TRANSFER);
  });

  it('คูปอง/วางบิลเป็นลูกหนี้ ไม่ใช่เงินที่ได้แล้ว', () => {
    expect(settlementOf('VOUCHER')).toBe(SettlementType.CITY_LEDGER);
    expect(settlementOf('ota')).toBe(SettlementType.CITY_LEDGER);
  });

  it('ค่าที่ไม่รู้จักตกเป็นเงินสด แต่บอกได้ว่าเป็นการเดา', () => {
    expect(settlementOf('บัตรกำนัลพิเศษ')).toBe(SettlementType.CASH);
    expect(settlementOf(null)).toBe(SettlementType.CASH);
    expect(isKnownPaymentMethod('บัตรกำนัลพิเศษ')).toBe(false);
    expect(isKnownPaymentMethod(null)).toBe(false);
    expect(isKnownPaymentMethod('QR_PAYMENT')).toBe(true);
  });
});

describe('menuRevenueTypeOf', () => {
  it('ผ่านเฉพาะชนิดที่หมวดเมนูตั้งได้', () => {
    expect(menuRevenueTypeOf(RevenueType.FOOD)).toBe(RevenueType.FOOD);
    expect(menuRevenueTypeOf(RevenueType.BEVERAGE)).toBe(RevenueType.BEVERAGE);
    expect(menuRevenueTypeOf(RevenueType.OTHER)).toBe(RevenueType.OTHER);
  });

  it('ค่านอกชุดตกกลับเป็นอาหาร — เงินค่าอาหารต้องไม่ไหลไปแผนกห้องพัก', () => {
    expect(menuRevenueTypeOf(RevenueType.ROOM)).toBe(RevenueType.FOOD);
    expect(menuRevenueTypeOf(RevenueType.SERVICE_CHARGE)).toBe(RevenueType.FOOD);
    expect(menuRevenueTypeOf(null)).toBe(RevenueType.FOOD);
    expect(menuRevenueTypeOf(undefined)).toBe(RevenueType.FOOD);
  });
});

describe('buildOrderRevenueInput', () => {
  it('แยกอาหารกับเครื่องดื่มตามหมวดเมนู แล้วผลรวมเท่ายอดบิล', () => {
    const input = buildOrderRevenueInput(makeOrder(), OUTLET);

    expect(netOf(input, RevenueType.FOOD)).toBe(700);
    expect(netOf(input, RevenueType.BEVERAGE)).toBe(300);
    expect(documentTotal(input)).toBe(1177);
  });

  it('ค่าบริการเป็นบรรทัดของตัวเอง และตกลงแผนก F&B', () => {
    const input = buildOrderRevenueInput(makeOrder(), OUTLET);
    const sc = input.lines.find((l) => l.revenueType === RevenueType.SERVICE_CHARGE);

    expect(sc?.grossAmount).toBe(100);
    expect(segmentOf(RevenueType.SERVICE_CHARGE, input.sourceModule)).toBe(
      RevenueSegment.FOOD_BEVERAGE,
    );
  });

  it('VAT เฉลี่ยลงทั้งอาหาร เครื่องดื่ม และค่าบริการ ตามฐานภาษีจริง', () => {
    const input = buildOrderRevenueInput(makeOrder(), OUTLET);
    const taxTotal = round2(input.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0));

    expect(taxTotal).toBe(77);
    // ฐานภาษี = 700 + 300 + 100 = 1100 → ค่าบริการต้องแบก 7 บาท ไม่ใช่ 0
    expect(input.lines.find((l) => l.revenueType === RevenueType.SERVICE_CHARGE)?.taxAmount).toBe(7);
  });

  it('ส่วนลดท้ายบิลเฉลี่ยตามสัดส่วนยอดขาย ไม่ไปกองที่บรรทัดเดียว', () => {
    const input = buildOrderRevenueInput(
      makeOrder({ discount: 100, taxAmount: 70, total: 1070 }),
      OUTLET,
    );

    expect(netOf(input, RevenueType.FOOD)).toBe(630);
    expect(netOf(input, RevenueType.BEVERAGE)).toBe(270);
    expect(documentTotal(input)).toBe(1070);
  });

  it('รายการที่ถูกยกเลิกไม่มีน้ำหนักในการแบ่งยอด', () => {
    const input = buildOrderRevenueInput(
      makeOrder({
        items: [
          orderItem(700, RevenueType.FOOD),
          orderItem(300, RevenueType.BEVERAGE),
          orderItem(500, RevenueType.BEVERAGE, 'CANCELLED'),
        ],
      }),
      OUTLET,
    );

    expect(netOf(input, RevenueType.BEVERAGE)).toBe(300);
    expect(documentTotal(input)).toBe(1177);
  });

  it('ยอดบิลเป็นตัวจริง ไม่ใช่ผลบวกของรายการ — บิลที่ถูกแก้ยอดด้วยมือยังกระทบยอดตรง', () => {
    // รายการรวม 1000 แต่ subtotal ถูกแก้เป็น 900 → สมุดต้องบันทึก 900 ตามที่เก็บเงินได้
    const input = buildOrderRevenueInput(
      makeOrder({ subtotal: 900, serviceCharge: 90, taxAmount: 69.3, total: 1059.3 }),
      OUTLET,
    );

    expect(round2(netOf(input, RevenueType.FOOD) + netOf(input, RevenueType.BEVERAGE))).toBe(900);
    expect(documentTotal(input)).toBe(1059.3);
  });

  it('บิลที่ไม่มีรายการเหลือเลยยังลงบัญชีเป็นอาหาร ไม่ทำเงินหาย', () => {
    const input = buildOrderRevenueInput(makeOrder({ items: [] }), OUTLET);

    expect(netOf(input, RevenueType.FOOD)).toBe(1000);
    expect(documentTotal(input)).toBe(1177);
  });

  it('หมวดเมนูที่ตั้งค่าเพี้ยนไม่ทำให้เงินค่าอาหารไปโผล่แผนกห้องพัก', () => {
    const input = buildOrderRevenueInput(
      makeOrder({ items: [orderItem(1000, RevenueType.ROOM)] }),
      OUTLET,
    );

    expect(input.lines.some((l) => l.revenueType === RevenueType.ROOM)).toBe(false);
    expect(netOf(input, RevenueType.FOOD)).toBe(1000);
  });

  it('บิลที่ชาร์จเข้าห้องบันทึกเป็น ROOM_CHARGE ไม่ใช่เงินสด', () => {
    const input = buildOrderRevenueInput(
      makeOrder({ paymentStatus: 'CHARGED_TO_ROOM', paymentMethod: 'ROOM_CHARGE' }),
      OUTLET,
    );

    expect(input.settlement).toBe(SettlementType.ROOM_CHARGE);
  });

  it('ใช้เวลาปิดบิลเป็นเวลาที่รายได้เกิด — โต๊ะที่นั่งข้ามเที่ยงคืนเป็นยอดของวันที่จ่าย', () => {
    const input = buildOrderRevenueInput(makeOrder(), OUTLET);
    expect(input.occurredAt).toEqual(new Date('2026-08-17T05:30:00.000Z'));
  });

  it('บิลที่ยังไม่มี completedAt ใช้เวลาที่เปิดบิลแทน', () => {
    const input = buildOrderRevenueInput(makeOrder({ completedAt: null }), OUTLET);
    expect(input.occurredAt).toEqual(new Date('2026-08-17T04:00:00.000Z'));
  });

  it('บิลเปล่าไม่ต้องลงสมุด', () => {
    const input = buildOrderRevenueInput(
      makeOrder({ subtotal: 0, discount: 0, serviceCharge: 0, taxAmount: 0, total: 0, items: [] }),
      OUTLET,
    );
    expect(hasPostableRevenue(input)).toBe(false);
  });

  it('ตัวเลขที่ Prisma ส่งมาเป็น Decimal/string ให้ผลเดียวกับ number', () => {
    const asDecimal = buildOrderRevenueInput(
      makeOrder({
        subtotal: '1000.00',
        serviceCharge: '100.00',
        taxAmount: '77.00',
        items: [orderItem('700.00' as never, RevenueType.FOOD), orderItem('300.00' as never, RevenueType.BEVERAGE)],
      }),
      OUTLET,
    );
    expect(documentTotal(asDecimal)).toBe(1177);
    expect(netOf(asDecimal, RevenueType.FOOD)).toBe(700);
  });
});

describe('buildRetailSaleRevenueInput', () => {
  const SALE = {
    id: 'sale-1',
    tenantId: 'tenant-1',
    receiptNo: 'RS-20260817-0001',
    warehouseId: 'wh-1',
    paymentMethod: 'QR',
    folioChargeId: null,
    subtotal: 500,
    discountTotal: 50,
    vatAmount: 31.5,
    soldAt: new Date('2026-08-17T06:00:00.000Z'),
  };
  const STORE = { warehouseId: 'wh-1', warehouseName: 'ร้านค้าล็อบบี้', propertyId: 'prop-1' };

  it('สินค้าลงแผนกเบ็ดเตล็ด ไม่ปนกับ F&B (ไม่งั้น Food Cost% ดูดีเกินจริง)', () => {
    const input = buildRetailSaleRevenueInput(SALE, STORE);

    expect(input.lines).toHaveLength(1);
    expect(input.lines[0].revenueType).toBe(RevenueType.RETAIL_GOODS);
    expect(segmentOf(RevenueType.RETAIL_GOODS, input.sourceModule)).toBe(
      RevenueSegment.OTHER_OPERATED,
    );
  });

  it('ผลรวมเท่ากับ grandTotal ของใบเสร็จ', () => {
    // grandTotal = (500 − 50) + 31.50
    expect(documentTotal(buildRetailSaleRevenueInput(SALE, STORE))).toBe(481.5);
  });

  it('QR ของร้านค้าถูกนับเป็นการโอน เหมือน QR ของร้านอาหาร', () => {
    expect(buildRetailSaleRevenueInput(SALE, STORE).settlement).toBe(SettlementType.TRANSFER);
  });
});

describe('buildBookingRevenueInput', () => {
  const BOOKING = {
    id: 'booking-1',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    bookingNo: 'BK-0001',
    paymentMethod: 'CREDIT_CARD',
    checkOut: new Date('2026-08-20T05:00:00.000Z'),
    actualCheckOut: new Date('2026-08-20T04:30:00.000Z'),
    totalPrice: 3000,
    roomSubtotal: 3000,
    serviceChargeAmount: 300,
    vatAmount: 231,
    grandTotal: 3531,
  };

  it('แยกค่าห้อง ค่าบริการ และผลรวมเท่ากับ grandTotal', () => {
    const input = buildBookingRevenueInput(BOOKING);

    expect(netOf(input, RevenueType.ROOM)).toBe(3000);
    expect(netOf(input, RevenueType.SERVICE_CHARGE)).toBe(300);
    expect(documentTotal(input)).toBe(3531);
  });

  it('VAT แบ่งให้ค่าบริการด้วย ไม่ให้บรรทัดค่าห้องแบกภาษีของค่าบริการ', () => {
    const input = buildBookingRevenueInput(BOOKING);
    const sc = input.lines.find((l) => l.revenueType === RevenueType.SERVICE_CHARGE);

    expect(sc?.taxAmount).toBe(21);
    expect(round2(input.lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0))).toBe(231);
  });

  it('การจองเก่าที่ไม่มีการแยกยอด ถือ grandTotal เป็นค่าห้องทั้งก้อน (กติกาเดียวกับ GL)', () => {
    const input = buildBookingRevenueInput({
      ...BOOKING,
      roomSubtotal: null,
      serviceChargeAmount: 0,
      vatAmount: 0,
      grandTotal: 2500,
    });

    expect(netOf(input, RevenueType.ROOM)).toBe(2500);
    expect(documentTotal(input)).toBe(2500);
  });

  it('ค่าบริการเพิ่มเติมบนบิลห้องเป็นรายได้เบ็ดเตล็ด', () => {
    const input = buildBookingRevenueInput(BOOKING, 450);

    expect(netOf(input, RevenueType.OTHER)).toBe(450);
    expect(documentTotal(input)).toBe(3981);
  });

  it('ใช้เวลาเช็คเอาต์จริงเป็นเวลาที่รายได้เกิด', () => {
    expect(buildBookingRevenueInput(BOOKING).occurredAt).toEqual(
      new Date('2026-08-20T04:30:00.000Z'),
    );
  });

  it('การจองที่ยังไม่ได้กดเช็คเอาต์ใช้วันออกตามกำหนด (backfill ของเก่า)', () => {
    expect(buildBookingRevenueInput({ ...BOOKING, actualCheckOut: null }).occurredAt).toEqual(
      new Date('2026-08-20T05:00:00.000Z'),
    );
  });
});

describe('buildCampRevenueInput', () => {
  const GROUND = { campgroundId: 'camp-1', campgroundName: 'ลานเขาใหญ่' };
  const RESERVATION = {
    id: 'camp-res-1',
    tenantId: 'tenant-1',
    campgroundId: 'camp-1',
    reservationNo: 'CMP-20260817-1234',
    paymentMethod: 'transfer',
    checkOut: new Date('2026-08-18T05:00:00.000Z'),
    actualCheckOut: null,
    totalPrice: 1800,
    addonItems: [
      { qty: 2, priceSnapshot: 250 },
      { qty: 1, priceSnapshot: 300 },
    ],
  };

  it('แยกค่าที่พักออกจากค่าเช่าอุปกรณ์ แล้วผลรวมเท่ายอดจอง', () => {
    const input = buildCampRevenueInput(RESERVATION, GROUND);

    expect(netOf(input, RevenueType.ROOM)).toBe(1000);
    expect(netOf(input, RevenueType.OTHER)).toBe(800);
    expect(documentTotal(input)).toBe(1800);
  });

  it('ค่าที่พักของลานเป็นแผนกที่พัก ส่วนอุปกรณ์เป็นแผนกเบ็ดเตล็ด', () => {
    const input = buildCampRevenueInput(RESERVATION, GROUND);

    expect(segmentOf(RevenueType.ROOM, input.sourceModule)).toBe(RevenueSegment.ROOMS);
    expect(segmentOf(RevenueType.OTHER, input.sourceModule)).toBe(RevenueSegment.OTHER_OPERATED);
  });

  it('ลานถูกแยกออกจากโรงแรมด้วย sourceModule ไม่ใช่ด้วย segment', () => {
    expect(buildCampRevenueInput(RESERVATION, GROUND).sourceModule).toBe('CAMP');
  });

  it('การจองที่ไม่มีอุปกรณ์เช่า ลงค่าที่พักอย่างเดียว', () => {
    const input = buildCampRevenueInput({ ...RESERVATION, addonItems: [] }, GROUND);

    expect(input.lines).toHaveLength(1);
    expect(netOf(input, RevenueType.ROOM)).toBe(1800);
  });

  it('ค่าอุปกรณ์เกินยอดรวม (ราคาถูกแก้ทีหลัง) ไม่ทำให้สมุดบันทึกเกินที่เก็บได้', () => {
    const input = buildCampRevenueInput(
      { ...RESERVATION, totalPrice: 500, addonItems: [{ qty: 1, priceSnapshot: 900 }] },
      GROUND,
    );

    expect(documentTotal(input)).toBe(500);
    expect(netOf(input, RevenueType.ROOM)).toBe(0);
    expect(netOf(input, RevenueType.OTHER)).toBe(500);
  });

  it('การจองคอมพลิเมนต์ (ยอด 0) ไม่ต้องลงสมุด', () => {
    const input = buildCampRevenueInput(
      { ...RESERVATION, totalPrice: 0, addonItems: [] },
      GROUND,
    );

    expect(hasPostableRevenue(input)).toBe(false);
  });
});
