import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { CRM_EVENTS } from '../../crm/crm.events';
import { emitRetailSaleCompleted, emitRetailSaleVoided } from './retail-sale-events';

describe('retail sale → CRM events', () => {
  const emit = jest.fn();
  const emitter = { emit } as unknown as EventEmitter2;
  const sale = {
    id: 's1',
    tenantId: 't1',
    receiptNo: 'RS-0001',
    grandTotal: new Prisma.Decimal(450),
    memberGuestId: 'g1',
    memberContactId: 'ct1',
    promotionId: 'p1',
    promoCode: 'ABCD1234',
    promoDiscount: new Prisma.Decimal(50),
  };

  afterEach(() => jest.clearAllMocks());

  it('emits member sale + promo redeemed for a member bill with a code', () => {
    emitRetailSaleCompleted(emitter, sale);
    expect(emit).toHaveBeenCalledWith(CRM_EVENTS.RETAIL_MEMBER_SALE, {
      tenantId: 't1',
      guestId: 'g1',
      contactId: 'ct1',
      saleId: 's1',
      receiptNo: 'RS-0001',
      amount: 450,
    });
    expect(emit).toHaveBeenCalledWith(CRM_EVENTS.PROMO_REDEEMED, {
      tenantId: 't1',
      guestId: 'g1',
      contactId: 'ct1',
      saleId: 's1',
      promotionId: 'p1',
      code: 'ABCD1234',
      discountAmount: 50,
    });
  });

  it('emits only the member sale when no code was used', () => {
    emitRetailSaleCompleted(emitter, { ...sale, promotionId: null, promoCode: null });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe(CRM_EVENTS.RETAIL_MEMBER_SALE);
  });

  it('emits nothing for walk-in (non-member) bills', () => {
    emitRetailSaleCompleted(emitter, { ...sale, memberGuestId: null });
    emitRetailSaleVoided(emitter, { ...sale, memberGuestId: null });
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits the void event with the bill amount', () => {
    emitRetailSaleVoided(emitter, sale);
    expect(emit).toHaveBeenCalledWith(
      CRM_EVENTS.RETAIL_MEMBER_SALE_VOIDED,
      expect.objectContaining({ saleId: 's1', amount: 450 }),
    );
  });

  it('never throws when a listener blows up synchronously', () => {
    emit.mockImplementation(() => {
      throw new Error('listener crash');
    });
    expect(() => emitRetailSaleCompleted(emitter, sale)).not.toThrow();
  });
});
