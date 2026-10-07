import { JourneyEventListener } from './journey-event.listener';
import { JourneyService } from './journey.service';
import { IntegrationsService } from '../../integrations/integrations.service';

describe('JourneyEventListener — retail.promo_redeemed', () => {
  const journeys = { enrollByTrigger: jest.fn() };
  const listener = new JourneyEventListener(journeys as unknown as JourneyService, {} as IntegrationsService);
  const payload = {
    tenantId: 't1',
    guestId: 'g1',
    contactId: 'ct1',
    saleId: 's1',
    promotionId: 'p1',
    code: 'ABCD1234',
    discountAmount: 50,
  };

  afterEach(() => jest.clearAllMocks());

  it('enrolls the member into journeys triggered by promo redemption', async () => {
    journeys.enrollByTrigger.mockResolvedValue(1);
    await listener.onPromoRedeemed(payload);
    expect(journeys.enrollByTrigger).toHaveBeenCalledWith('retail.promo_redeemed', 't1', 'g1', {
      metadata: { saleId: 's1', promotionId: 'p1', code: 'ABCD1234' },
    });
  });

  it('swallows enrollment failures (never breaks the sale)', async () => {
    journeys.enrollByTrigger.mockRejectedValue(new Error('db down'));
    await expect(listener.onPromoRedeemed(payload)).resolves.toBeUndefined();
  });

  it('ignores events without a member', async () => {
    await listener.onPromoRedeemed({ ...payload, guestId: '' });
    expect(journeys.enrollByTrigger).not.toHaveBeenCalled();
  });
});
