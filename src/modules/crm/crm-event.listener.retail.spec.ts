import { CrmEventListener, PROMO_REDEEMER_TAG } from './crm-event.listener';
import { CrmContactsService } from './crm-contacts.service';
import { CrmTicketsService } from './crm-tickets.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { IntegrationsService } from '../integrations/integrations.service';

describe('CrmEventListener — retail POS events', () => {
  const contacts = { recordRetailSale: jest.fn(), addTags: jest.fn() };
  const listener = new CrmEventListener(
    contacts as unknown as CrmContactsService,
    {} as CrmTicketsService,
    {} as LoyaltyService,
    {} as IntegrationsService,
  );
  const sale = { tenantId: 't1', guestId: 'g1', contactId: 'ct1', saleId: 's1', receiptNo: 'RS-1', amount: 450 };

  afterEach(() => jest.clearAllMocks());

  it('adds a member sale to lifetime value', async () => {
    await listener.onRetailMemberSale(sale);
    expect(contacts.recordRetailSale).toHaveBeenCalledWith('t1', 'g1', 450);
  });

  it('subtracts a voided member sale', async () => {
    await listener.onRetailMemberSaleVoided(sale);
    expect(contacts.recordRetailSale).toHaveBeenCalledWith('t1', 'g1', -450);
  });

  it('tags members who redeem a promo code', async () => {
    await listener.onPromoRedeemed({
      tenantId: 't1',
      guestId: 'g1',
      contactId: 'ct1',
      saleId: 's1',
      promotionId: 'p1',
      code: 'ABCD1234',
      discountAmount: 50,
    });
    expect(contacts.addTags).toHaveBeenCalledWith('t1', 'g1', [PROMO_REDEEMER_TAG]);
  });

  it('ignores payloads without a member', async () => {
    await listener.onRetailMemberSale({ ...sale, guestId: '' });
    await listener.onPromoRedeemed({ tenantId: 't1' } as never);
    expect(contacts.recordRetailSale).not.toHaveBeenCalled();
    expect(contacts.addTags).not.toHaveBeenCalled();
  });
});
