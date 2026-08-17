/**
 * What a restaurant bill charges.
 *
 * Two defects are pinned here. The first is legal: VAT was charged on food
 * alone, while the Revenue Code counts the service charge as part of the
 * taxable value of the sale — every bill the system had ever printed under-
 * declared VAT. The second is arithmetic: a discount was subtracted from the
 * total after VAT had already been worked out on the undiscounted amount, so a
 * discounted guest paid tax on money they never spent.
 *
 * The third group covers the outlet policy that replaced the hardcoded 7/10:
 * a bill must be able to carry no service charge, or no VAT at all, and must
 * keep the rates it was opened under when it is later recalculated.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderService } from '../order.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MenuService } from '../../menu/menu.service';
import { AuditLogService } from '../../../../audit-log/audit-log.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { buildFolioPostingStub } from './folio-posting.stub';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import { buildRevenuePostingStub } from '@/modules/revenue/__tests__/revenue-posting.stub';
import {
  calculateOrderTotals,
  resolveChargeRates,
  roundMoney,
} from '../order-totals.util';

describe('calculateOrderTotals', () => {
  it('charges VAT on the service charge as well as the food', () => {
    // The bill from the reported screenshot: ฿1,100 of food, 10% service, 7% VAT.
    const totals = calculateOrderTotals({ subtotal: 1100, taxRate: 7, serviceRate: 10 });

    expect(totals.serviceCharge).toBe(110);
    expect(totals.taxableBase).toBe(1210);
    // The old code produced 77 here — 7% of the food only.
    expect(totals.taxAmount).toBe(84.7);
    expect(totals.total).toBe(1294.7);
  });

  it('never leaves VAT at the old food-only figure', () => {
    const totals = calculateOrderTotals({ subtotal: 280, taxRate: 7, serviceRate: 10 });

    expect(totals.taxAmount).not.toBe(19.6);
    expect(totals.taxAmount).toBe(21.56);
  });

  it('takes the discount off before service charge and VAT', () => {
    const totals = calculateOrderTotals({
      subtotal: 1000,
      taxRate: 7,
      serviceRate: 10,
      discount: 100,
    });

    // net 900 → service 90 → base 990 → VAT 69.30
    expect(totals.serviceCharge).toBe(90);
    expect(totals.taxableBase).toBe(990);
    expect(totals.taxAmount).toBe(69.3);
    expect(totals.total).toBe(1059.3);
  });

  it('keeps every figure on the two-decimal grid the money columns store', () => {
    const totals = calculateOrderTotals({ subtotal: 333.33, taxRate: 7, serviceRate: 10 });

    for (const value of Object.values(totals)) {
      expect(roundMoney(value)).toBe(value);
    }
    // And the parts still add up to the total that gets charged.
    expect(roundMoney(totals.taxableBase + totals.taxAmount)).toBe(totals.total);
  });

  it('drops the service charge line when the rate is zero', () => {
    const totals = calculateOrderTotals({ subtotal: 500, taxRate: 7, serviceRate: 0 });

    expect(totals.serviceCharge).toBe(0);
    expect(totals.taxableBase).toBe(500);
    expect(totals.taxAmount).toBe(35);
    expect(totals.total).toBe(535);
  });

  it('charges nothing on top when both rates are zero', () => {
    const totals = calculateOrderTotals({ subtotal: 500, taxRate: 0, serviceRate: 0 });

    expect(totals.total).toBe(500);
    expect(totals.taxAmount).toBe(0);
  });

  it('refuses to turn an oversized discount into negative VAT', () => {
    const totals = calculateOrderTotals({
      subtotal: 200,
      taxRate: 7,
      serviceRate: 10,
      discount: 500,
    });

    expect(totals.discount).toBe(200);
    expect(totals.taxAmount).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('survives the Decimal strings and nulls Prisma hands back', () => {
    const totals = calculateOrderTotals({
      subtotal: Number('1100.00'),
      taxRate: Number('7.00'),
      serviceRate: Number(undefined as unknown as string),
    });

    expect(Number.isNaN(totals.total)).toBe(false);
    expect(totals.serviceCharge).toBe(0);
  });
});

describe('resolveChargeRates', () => {
  it('reads the rates off the outlet', () => {
    expect(
      resolveChargeRates({
        vatEnabled: true,
        vatRate: '7.00',
        serviceChargeEnabled: true,
        serviceRate: '10.00',
      }),
    ).toEqual({ taxRate: 7, serviceRate: 10 });
  });

  it('forces the rate to zero when the charge is switched off', () => {
    // The stored rate stays 10 so switching the charge back on restores it.
    expect(
      resolveChargeRates({
        vatEnabled: false,
        vatRate: '7.00',
        serviceChargeEnabled: false,
        serviceRate: '10.00',
      }),
    ).toEqual({ taxRate: 0, serviceRate: 0 });
  });

  it('ignores a per-bill override for a charge the outlet has switched off', () => {
    expect(
      resolveChargeRates(
        { serviceChargeEnabled: false, serviceRate: '10.00' },
        { serviceRate: 10 },
      ).serviceRate,
    ).toBe(0);
  });

  it('lets an explicit per-bill rate win while the charge is on', () => {
    expect(
      resolveChargeRates({ serviceChargeEnabled: true, serviceRate: '10.00' }, { serviceRate: 5 })
        .serviceRate,
    ).toBe(5);
  });

  it('falls back to 7/10 for an outlet created before the settings existed', () => {
    expect(resolveChargeRates(null)).toEqual({ taxRate: 7, serviceRate: 10 });
    expect(resolveChargeRates({})).toEqual({ taxRate: 7, serviceRate: 10 });
  });

  it('clamps a nonsense rate instead of writing it to the bill', () => {
    expect(resolveChargeRates({ vatRate: 5000 }).taxRate).toBe(100);
    expect(resolveChargeRates({ serviceRate: -5 }).serviceRate).toBe(0);
  });
});

describe('OrderService — outlet charge policy on a new bill', () => {
  let service: OrderService;

  const prisma = {
    restaurant: { findFirst: jest.fn() },
    restaurantTable: { findFirst: jest.fn(), update: jest.fn() },
    tableReservation: { findFirst: jest.fn() },
    menuItem: { findMany: jest.fn() },
    orderItem: { findMany: jest.fn() },
    order: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    documentSequence: { findFirst: jest.fn(), create: jest.fn(), upsert: jest.fn() },
  };

  const RESTAURANT = 'rest-1';
  const TENANT = 'tenant-1';
  const MENU_ITEM = 'menu-1';

  /** The `data` Prisma was asked to write for the new bill. */
  const createdData = () => prisma.order.create.mock.calls[0][0].data;

  const outlet = (policy: Record<string, unknown>) => ({
    id: RESTAURANT,
    tenantId: TENANT,
    vatEnabled: true,
    vatRate: '7.00',
    serviceChargeEnabled: true,
    serviceRate: '10.00',
    ...policy,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:9010' } },
        { provide: MenuService, useValue: {} },
        { provide: AuditLogService, useValue: { logOrderCreate: jest.fn() } },
        { provide: FolioPostingService, useValue: buildFolioPostingStub() },
        { provide: RevenuePostingService, useValue: buildRevenuePostingStub() },
      ],
    }).compile();
    service = moduleRef.get(OrderService);

    prisma.restaurant.findFirst.mockResolvedValue(outlet({}));
    prisma.tableReservation.findFirst.mockResolvedValue(null);
    prisma.menuItem.findMany.mockResolvedValue([
      { id: MENU_ITEM, price: '550.00', restaurantId: RESTAURANT, tenantId: TENANT },
    ]);
    prisma.order.count.mockResolvedValue(0);
    prisma.documentSequence.findFirst.mockResolvedValue({ id: 'seq-1' });
    prisma.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
    prisma.order.create.mockImplementation(({ data }: any) => ({ id: 'order-1', ...data }));
  });

  const createBill = () =>
    service.create(RESTAURANT, { items: [{ menuItemId: MENU_ITEM, quantity: 2 }] }, TENANT);

  it('taxes the service charge on a bill it opens', async () => {
    await createBill();

    expect(createdData()).toMatchObject({
      subtotal: 1100,
      serviceCharge: 110,
      taxAmount: 84.7,
      total: 1294.7,
    });
  });

  it('opens the bill with no service charge when the outlet takes none', async () => {
    prisma.restaurant.findFirst.mockResolvedValue(outlet({ serviceChargeEnabled: false }));

    await createBill();

    expect(createdData()).toMatchObject({
      serviceRate: 0,
      serviceCharge: 0,
      taxAmount: 77,
      total: 1177,
    });
  });

  it('charges no VAT for an outlet that is not VAT registered', async () => {
    prisma.restaurant.findFirst.mockResolvedValue(outlet({ vatEnabled: false }));

    await createBill();

    expect(createdData()).toMatchObject({
      taxRate: 0,
      taxAmount: 0,
      serviceCharge: 110,
      total: 1210,
    });
  });

  it('honours a rate the outlet has configured away from the default', async () => {
    prisma.restaurant.findFirst.mockResolvedValue(outlet({ serviceRate: '5.00' }));

    await createBill();

    // net 1100 → service 55 → base 1155 → VAT 80.85
    expect(createdData()).toMatchObject({
      serviceRate: 5,
      serviceCharge: 55,
      taxAmount: 80.85,
    });
  });

  it('snapshots the rates onto the bill so later policy changes cannot rewrite it', async () => {
    await createBill();

    expect(createdData()).toMatchObject({ taxRate: 7, serviceRate: 10 });
  });

  it('recalculates a bill from its own snapshot, not the outlet policy', async () => {
    // The outlet has since switched service charge off; this bill was opened at 10%.
    prisma.restaurant.findFirst.mockResolvedValue(outlet({ serviceChargeEnabled: false }));
    prisma.order.findFirst.mockResolvedValue({
      id: 'order-1',
      restaurantId: RESTAURANT,
      tenantId: TENANT,
      taxRate: '7.00',
      serviceRate: '10.00',
      discount: '0.00',
      status: 'PENDING',
      items: [],
    });
    prisma.orderItem.findMany.mockResolvedValue([{ totalPrice: '1100.00' }]);
    prisma.order.update.mockResolvedValue({});

    await service['recalculateTotals']('order-1', {
      taxRate: '7.00',
      serviceRate: '10.00',
      discount: '0.00',
    });

    expect(prisma.order.update.mock.calls[0][0].data).toMatchObject({
      serviceCharge: 110,
      taxAmount: 84.7,
      total: 1294.7,
    });
  });
});
