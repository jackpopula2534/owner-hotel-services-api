/**
 * ปิดบิลแล้วส่วนลดเดิมต้องไม่หายไป
 *
 * `applyLoyaltyDiscount` หักส่วนลดลูกค้าประจำ 2% ลง `order.discount` และหักออกจาก
 * `order.total` ไปแล้ว แต่ `processPayment` เขียนทับด้วย `dto.discount ?? 0` ตรง ๆ
 * → พอเก็บเงิน คอลัมน์ discount กลายเป็น 0 ทั้งที่ total ยังเป็นยอดหลังหักส่วนลด
 * ใบเสร็จจึงกระทบยอดไม่ตรงแบบเงียบ ๆ (subtotal − discount ≠ total)
 *
 * สเปกชุดนี้ตรึงว่า ส่วนลดตอนรับชำระเป็นส่วนลด "เพิ่มเติม" ที่บวกทับของเดิม
 * และตัวเลขเงินทุกตัวที่เขียนลง DB ต้องปัดเหลือ 2 ตำแหน่ง
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { OrderService } from '../order.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MenuService } from '../../menu/menu.service';
import { menuStockProvider } from './menu-stock.stub';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { buildFolioPostingStub } from './folio-posting.stub';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import {
  buildRevenuePostingStub,
  postedRevenueInput,
  type RevenuePostingStub,
} from '@/modules/revenue/__tests__/revenue-posting.stub';
import { PaymentMethodEnum, ProcessPaymentDto } from '../dto/process-payment.dto';

describe('OrderService — processPayment', () => {
  let service: OrderService;

  const prisma = {
    order: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
    restaurant: { findFirst: jest.fn() },
    restaurantTable: { update: jest.fn() },
    tableReservation: { updateMany: jest.fn() },
    // ปิดบิลกับลงสมุดรายได้อยู่ในทรานแซกชันเดียวกัน — mock ส่ง client ตัวเดิมกลับไป
    // ให้ callback ทำงานจริง ไม่งั้นการเขียนทั้งก้อนจะเงียบหายไปทั้งชุด
    $transaction: jest.fn(async (run: (tx: unknown) => unknown) => run(prisma)),
  };

  const audit = { logOrderUpdate: jest.fn() };
  let folioPosting: ReturnType<typeof buildFolioPostingStub>;
  let revenuePosting: RevenuePostingStub;

  const RESTAURANT = 'rest-1';
  const TENANT = 'tenant-1';
  const ORDER_ID = 'order-1';

  /** บิลที่หักส่วนลดลูกค้าประจำ 2% ไปแล้ว (subtotal 1000 → discount 20 → total 980) */
  const loyaltyBill = {
    id: ORDER_ID,
    restaurantId: RESTAURANT,
    tenantId: TENANT,
    status: 'SERVED',
    paymentStatus: 'UNPAID',
    subtotal: 1000,
    discount: 20,
    total: 980,
    tableId: null,
    reservationId: null,
    guestRoom: null,
  };

  /** ค่าที่ Prisma ถูกสั่งให้เขียนตอนปิดบิล */
  const writtenData = () => prisma.order.update.mock.calls[0][0].data;

  const pay = (dto: Partial<ProcessPaymentDto>) =>
    service.processPayment(
      RESTAURANT,
      ORDER_ID,
      { paymentMethod: PaymentMethodEnum.CASH, paidAmount: 980, ...dto } as ProcessPaymentDto,
      TENANT,
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    folioPosting = buildFolioPostingStub();
    revenuePosting = buildRevenuePostingStub();

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:9010' } },
        { provide: MenuService, useValue: {} },
        menuStockProvider(),
        { provide: AuditLogService, useValue: audit },
        { provide: FolioPostingService, useValue: folioPosting },
        { provide: RevenuePostingService, useValue: revenuePosting },
      ],
    }).compile();
    service = moduleRef.get(OrderService);

    prisma.order.findFirst.mockResolvedValue(loyaltyBill);
    prisma.order.update.mockImplementation(({ data }: any) => ({ id: ORDER_ID, ...data }));
    prisma.order.count.mockResolvedValue(0);
    prisma.restaurant.findFirst.mockResolvedValue({ propertyId: 'prop-1' });
  });

  it('เก็บส่วนลดเดิมของบิลไว้เมื่อไม่ได้ให้ส่วนลดเพิ่มตอนรับชำระ', async () => {
    await pay({ paidAmount: 1000 });

    expect(writtenData()).toMatchObject({
      paymentStatus: 'PAID',
      paymentMethod: PaymentMethodEnum.CASH,
      discount: 20, // ← เดิมโดนเขียนทับเป็น 0
      total: 980,
      paidAmount: 1000,
      changeAmount: 20,
    });
  });

  it('ส่วนลดตอนรับชำระบวกทับของเดิม และหักออกจากยอดที่ต้องจ่าย', async () => {
    await pay({ discount: 30, paidAmount: 950 });

    expect(writtenData()).toMatchObject({
      discount: 50, // 20 เดิม + 30 ที่เพิ่งให้
      total: 950, // 980 − 30
      changeAmount: 0,
    });
  });

  it('ปัดตัวเลขเงินเหลือ 2 ตำแหน่ง ไม่ปล่อยเศษทศนิยมลอยตัวลงคอลัมน์เงิน', async () => {
    prisma.order.findFirst.mockResolvedValue({ ...loyaltyBill, discount: 0, total: 842.4 });

    await pay({ discount: 0.1, paidAmount: 1000 });

    // 842.4 − 0.1 ในเลขทศนิยมลอยตัวได้ 842.3000000000001
    expect(writtenData()).toMatchObject({
      total: 842.3,
      discount: 0.1,
      changeAmount: 157.7,
    });
  });

  it('ปฏิเสธส่วนลดที่มากกว่ายอดบิล แทนที่จะเขียน total ติดลบ', async () => {
    await expect(pay({ discount: 2000, paidAmount: 0 })).rejects.toThrow(BadRequestException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('ปฏิเสธเมื่อจ่ายไม่ครบยอด', async () => {
    await expect(pay({ paidAmount: 500 })).rejects.toThrow(BadRequestException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('บิลที่ชำระแล้วห้ามชำระซ้ำ', async () => {
    prisma.order.findFirst.mockResolvedValue({ ...loyaltyBill, paymentStatus: 'PAID' });

    await expect(pay({ paidAmount: 980 })).rejects.toThrow('Order is already paid');
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  describe('ROOM_CHARGE — บิลต้องไปตกที่ folio ของแขก', () => {
    const roomCharge = (dto: Partial<ProcessPaymentDto> = {}) =>
      pay({ paymentMethod: PaymentMethodEnum.ROOM_CHARGE, paidAmount: 0, ...dto });

    it('ปฏิเสธเมื่อไม่ได้ระบุทั้งการจองและเลขห้อง', async () => {
      await expect(roomCharge()).rejects.toThrow(
        'ต้องเลือกห้องพัก (การจอง) สำหรับการชาร์จเข้าห้อง',
      );
      expect(folioPosting.postCharge).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('โพสต์ยอดเข้า folio แล้วเก็บ id กลับมาที่บิล', async () => {
      await roomCharge({ guestRoom: '301' });

      expect(folioPosting.postCharge).toHaveBeenCalledTimes(1);
      expect(folioPosting.postCharge.mock.calls[0][0]).toMatchObject({
        tenantId: TENANT,
        roomNumber: '301',
        propertyId: 'prop-1',
        chargeType: 'FB_CHARGE',
        sourceType: 'RESTAURANT_ORDER',
        sourceId: ORDER_ID,
        totalAmount: 980,
      });

      expect(writtenData()).toMatchObject({
        // แยกจาก PAID: เป็นรายได้แล้วแต่ยังไม่ได้เงิน — เงินไปเก็บตอนเช็คเอาต์
        paymentStatus: 'CHARGED_TO_ROOM',
        guestRoom: '301',
        bookingId: 'booking-1',
        folioId: 'folio-1',
        folioChargeId: 'charge-1',
        // ลิ้นชักไม่ได้เปิด จึงไม่มีเงินรับและไม่มีเงินทอน
        paidAmount: 0,
        changeAmount: 0,
      });
    });

    it('ไม่ปิดบิลถ้า folio ไม่รับ — เงินเคยหายตรงนี้', async () => {
      folioPosting.postCharge.mockRejectedValue(
        new BadRequestException('ไม่พบการจองที่เช็คอินอยู่สำหรับห้อง 999'),
      );

      await expect(roomCharge({ guestRoom: '999' })).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('ห้ามชาร์จซ้ำบิลที่ยกเข้าห้องไปแล้ว', async () => {
      prisma.order.findFirst.mockResolvedValue({
        ...loyaltyBill,
        paymentStatus: 'CHARGED_TO_ROOM',
      });

      await expect(roomCharge({ guestRoom: '301' })).rejects.toThrow(
        'บิลนี้ถูกชาร์จเข้าห้องพักไปแล้ว',
      );
      expect(folioPosting.postCharge).not.toHaveBeenCalled();
    });

    it('ไม่เรียกเช็คยอดจ่ายให้ครบ เพราะที่เคาน์เตอร์ไม่ได้รับเงิน', async () => {
      // จ่าย 0 บาทกับบิล 980 — ถ้ายังใช้กติกาเงินสดอยู่จะโดนปฏิเสธตรงนี้
      await expect(roomCharge({ guestRoom: '301' })).resolves.toBeDefined();
    });
  });

  // รายงานรายได้ทุกหน้ากรอง status COMPLETED บิลที่เก็บเงินแล้วแต่ค้าง PENDING
  // จึงเป็นเงินที่หายจากยอดขายทั้งที่รับมาจริง
  it('ปิดบิลที่ยังไม่ทันเดินสถานะถึง SERVED ด้วย ไม่งั้นยอดหลุดจากรายงาน', async () => {
    prisma.order.findFirst.mockResolvedValue({ ...loyaltyBill, status: 'PENDING' });

    await pay({ paidAmount: 980 });

    expect(writtenData()).toMatchObject({ status: 'COMPLETED' });
  });

  it('บิลที่เสิร์ฟแล้วปิดเป็น COMPLETED และคืนโต๊ะให้ทีมทำความสะอาด', async () => {
    prisma.order.findFirst.mockResolvedValue({ ...loyaltyBill, tableId: 'table-a1' });

    await pay({ paidAmount: 980 });

    expect(writtenData()).toMatchObject({ status: 'COMPLETED' });
    expect(prisma.restaurantTable.update).toHaveBeenCalledWith({
      where: { id: 'table-a1' },
      data: { status: 'CLEANING' },
    });
  });

  /**
   * สมุดรายได้กลาง — ปิดบิลแล้วต้องมีแถวรายได้เสมอ
   *
   * ตัวเลขจริงถูกพิสูจน์กับฐานข้อมูลจริงใน `scripts/verify-revenue-ledger.ts`
   * ที่นี่ตรึงแค่ว่า "บิลใบไหน ยอดเท่าไร ช่องทางอะไร" ถูกส่งให้สมุด และส่งภายใน
   * ทรานแซกชันเดียวกับที่เขียนบิล — บิลปิดสำเร็จแต่รายได้ไม่ลงคือรูเงินหาย
   */
  describe('สมุดรายได้กลาง', () => {
    /** แถวบิลที่ recordOrderRevenue อ่านกลับมาหลังปิด (findFirst ครั้งที่สอง) */
    const closedBill = (over: Record<string, unknown> = {}) => ({
      ...loyaltyBill,
      orderNumber: 'ORD-0001',
      paymentStatus: 'PAID',
      paymentMethod: PaymentMethodEnum.CASH,
      serviceCharge: 0,
      taxAmount: 0,
      folioChargeId: null,
      completedAt: new Date('2026-08-17T13:00:00.000Z'),
      createdAt: new Date('2026-08-17T11:00:00.000Z'),
      items: [],
      ...over,
    });

    /** ใบที่รับชำระ (ครั้งที่ 1) แล้วใบเดิมหลังปิดสำหรับลงสมุด (ครั้งที่ 2) */
    const billsInOrder = (closed: Record<string, unknown>) => {
      prisma.order.findFirst
        .mockResolvedValueOnce(loyaltyBill)
        .mockResolvedValueOnce(closed);
    };

    it('ส่งบิลที่ปิดแล้วเข้าสมุดรายได้ในทรานแซกชันเดียวกับที่เขียนบิล', async () => {
      billsInOrder(closedBill());

      await pay({ paidAmount: 1000 });

      expect(revenuePosting.postWithin).toHaveBeenCalledTimes(1);
      // อาร์กิวเมนต์แรกคือ tx ที่ $transaction ส่งเข้ามา ไม่ใช่ prisma client คนละตัว
      expect(revenuePosting.postWithin.mock.calls[0][0]).toBe(prisma);
      expect(postedRevenueInput(revenuePosting)).toMatchObject({
        tenantId: TENANT,
        sourceModule: 'RESTAURANT',
        sourceType: 'ORDER',
        sourceId: ORDER_ID,
        documentNo: 'ORD-0001',
        outletId: RESTAURANT,
        propertyId: 'prop-1',
        settlement: 'CASH',
      });
    });

    it('ยอดในสมุดเท่ากับยอดหลังหักส่วนลด ไม่ใช่ยอดก่อนลด', async () => {
      billsInOrder(closedBill({ subtotal: 1000, discount: 20, total: 980 }));

      await pay({ paidAmount: 1000 });

      const { lines } = postedRevenueInput(revenuePosting);
      expect(lines).toEqual([
        { revenueType: 'FOOD', grossAmount: 1000, discount: 20, taxAmount: 0 },
      ]);
    });

    it('แตกยอดอาหาร/เครื่องดื่มตามหมวดเมนู ไม่กองรวมเป็นก้อนเดียว', async () => {
      billsInOrder(
        closedBill({
          subtotal: 1000,
          discount: 0,
          total: 1000,
          items: [
            { status: 'SERVED', totalPrice: 700, menuItem: { category: { revenueType: 'FOOD' } } },
            {
              status: 'SERVED',
              totalPrice: 300,
              menuItem: { category: { revenueType: 'BEVERAGE' } },
            },
            // รายการที่ยกเลิกไม่เคยถูกคิดเงิน จึงต้องไม่มีน้ำหนักในการแบ่งยอด
            { status: 'CANCELLED', totalPrice: 500, menuItem: { category: { revenueType: 'FOOD' } } },
          ],
        }),
      );

      await pay({ paidAmount: 1000 });

      const { lines } = postedRevenueInput(revenuePosting);
      expect(lines).toEqual([
        { revenueType: 'FOOD', grossAmount: 700, discount: 0, taxAmount: 0 },
        { revenueType: 'BEVERAGE', grossAmount: 300, discount: 0, taxAmount: 0 },
      ]);
    });

    it('บิลที่ยกเข้าห้องลงสมุดเป็น ROOM_CHARGE พร้อม folioChargeId', async () => {
      billsInOrder(
        closedBill({ paymentStatus: 'CHARGED_TO_ROOM', folioChargeId: 'charge-1' }),
      );

      await pay({
        paymentMethod: PaymentMethodEnum.ROOM_CHARGE,
        paidAmount: 0,
        guestRoom: '301',
      });

      expect(postedRevenueInput(revenuePosting)).toMatchObject({
        settlement: 'ROOM_CHARGE',
        folioChargeId: 'charge-1',
      });
    });

    it('บิลแจกฟรียอดศูนย์ปิดได้ตามปกติ โดยไม่ยัดแถวศูนย์ลงสมุด', async () => {
      prisma.order.findFirst
        .mockResolvedValueOnce({ ...loyaltyBill, subtotal: 0, discount: 0, total: 0 })
        .mockResolvedValueOnce(closedBill({ subtotal: 0, discount: 0, total: 0 }));

      await expect(pay({ paidAmount: 0 })).resolves.toBeDefined();

      expect(prisma.order.update).toHaveBeenCalledTimes(1);
      expect(revenuePosting.postWithin).not.toHaveBeenCalled();
    });
  });
});
