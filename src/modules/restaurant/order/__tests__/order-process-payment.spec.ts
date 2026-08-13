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
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { PaymentMethodEnum, ProcessPaymentDto } from '../dto/process-payment.dto';

describe('OrderService — processPayment', () => {
  let service: OrderService;

  const prisma = {
    order: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
    restaurantTable: { update: jest.fn() },
    tableReservation: { updateMany: jest.fn() },
  };

  const audit = { logOrderUpdate: jest.fn() };

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

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:9010' } },
        { provide: MenuService, useValue: {} },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(OrderService);

    prisma.order.findFirst.mockResolvedValue(loyaltyBill);
    prisma.order.update.mockImplementation(({ data }: any) => ({ id: ORDER_ID, ...data }));
    prisma.order.count.mockResolvedValue(0);
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

  it('ROOM_CHARGE ต้องมีเลขห้อง และเลขห้องถูกเขียนลงบิล', async () => {
    await expect(
      pay({ paymentMethod: PaymentMethodEnum.ROOM_CHARGE, paidAmount: 980 }),
    ).rejects.toThrow('Room number is required for room charge payment');

    await pay({
      paymentMethod: PaymentMethodEnum.ROOM_CHARGE,
      guestRoom: '301',
      paidAmount: 980,
    });
    expect(writtenData()).toMatchObject({ guestRoom: '301' });
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
});
