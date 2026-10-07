import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { AudienceResolver } from './audience.resolver';
import { ChannelRegistry } from './channels/channel.registry';
import { CampaignPromoCodeService } from './campaign-promo-code.service';
import { CampaignProcessor } from './campaign.processor';
import { DeliverOneJobData } from './campaign.constants';

describe('CampaignProcessor — deliver-one', () => {
  let processor: CampaignProcessor;

  const prisma = {
    crmCampaignDelivery: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
    crmCampaign: { findFirst: jest.fn(), update: jest.fn() },
  };
  const adapter = { send: jest.fn() };
  const channels = { resolve: jest.fn(() => adapter) };
  const promoCodes = { issueForDelivery: jest.fn(), revokeForDelivery: jest.fn() };

  const job = { data: { deliveryId: 'd1', campaignId: 'c1', tenantId: 't1' } } as Job<DeliverOneJobData>;

  const promoCampaign = {
    id: 'c1',
    tenantId: 't1',
    channel: 'line',
    subject: null,
    templateKey: null,
    bodyOverride: 'รับส่วนลดด้วยโค้ด {{promoCode}}',
    promotionId: 'p1',
    promoCodeValidDays: 14,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: AudienceResolver, useValue: {} },
        { provide: ChannelRegistry, useValue: channels },
        { provide: CampaignPromoCodeService, useValue: promoCodes },
      ],
    }).compile();
    processor = module.get(CampaignProcessor);
    prisma.crmCampaignDelivery.findFirst.mockResolvedValue({
      id: 'd1',
      status: 'pending',
      recipient: 'U123',
      guestId: 'g1',
    });
    prisma.crmCampaignDelivery.count.mockResolvedValue(0);
  });

  afterEach(() => jest.clearAllMocks());

  it('issues the member’s code, puts it in the message and records it on the delivery', async () => {
    prisma.crmCampaign.findFirst.mockResolvedValue(promoCampaign);
    promoCodes.issueForDelivery.mockResolvedValue({
      ok: true,
      code: { id: 'pc1', code: 'ABCD1234', expiresAt: null },
    });
    adapter.send.mockResolvedValue({ success: true, providerMessageId: 'm1' });

    await processor.handleDeliverOne(job);

    expect(promoCodes.issueForDelivery).toHaveBeenCalledWith({
      tenantId: 't1',
      campaignId: 'c1',
      promotionId: 'p1',
      deliveryId: 'd1',
      guestId: 'g1',
      validDays: 14,
    });
    const sent = adapter.send.mock.calls[0][0];
    expect(sent.bodyOverride).toBe('รับส่วนลดด้วยโค้ด ABCD1234');
    expect(sent.context).toEqual({ promoCode: 'ABCD1234', promoExpiresAt: null });
    const update = prisma.crmCampaignDelivery.update.mock.calls[0][0];
    expect(update.data.status).toBe('sent');
    expect(JSON.parse(update.data.metadata)).toEqual({
      providerMessageId: 'm1',
      promoCodeId: 'pc1',
      promoCode: 'ABCD1234',
    });
    expect(promoCodes.revokeForDelivery).not.toHaveBeenCalled();
  });

  it('fails the delivery without sending when no code can be issued', async () => {
    prisma.crmCampaign.findFirst.mockResolvedValue(promoCampaign);
    promoCodes.issueForDelivery.mockResolvedValue({ ok: false, reason: 'โปรโมชั่นหมดเขตแล้ว' });

    await processor.handleDeliverOne(job);

    expect(adapter.send).not.toHaveBeenCalled();
    expect(prisma.crmCampaignDelivery.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: 'failed', errorMessage: 'โปรโมชั่นหมดเขตแล้ว' },
    });
    expect(prisma.crmCampaign.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { totalFailed: { increment: 1 } },
    });
    // คิวหมดแล้ว → ปิดแคมเปญ
    expect(prisma.crmCampaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
  });

  it('revokes the issued code when the channel send fails', async () => {
    prisma.crmCampaign.findFirst.mockResolvedValue(promoCampaign);
    promoCodes.issueForDelivery.mockResolvedValue({
      ok: true,
      code: { id: 'pc1', code: 'ABCD1234', expiresAt: null },
    });
    adapter.send.mockResolvedValue({ success: false, errorMessage: 'LINE 400' });

    await processor.handleDeliverOne(job);

    expect(promoCodes.revokeForDelivery).toHaveBeenCalledWith('t1', 'd1');
    expect(prisma.crmCampaignDelivery.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: 'failed', errorMessage: 'LINE 400' },
    });
  });

  it('leaves non-promo campaigns untouched', async () => {
    prisma.crmCampaign.findFirst.mockResolvedValue({ ...promoCampaign, promotionId: null, bodyOverride: 'hi' });
    adapter.send.mockResolvedValue({ success: true });

    await processor.handleDeliverOne(job);

    expect(promoCodes.issueForDelivery).not.toHaveBeenCalled();
    expect(adapter.send.mock.calls[0][0].bodyOverride).toBe('hi');
    expect(prisma.crmCampaignDelivery.update.mock.calls[0][0].data.metadata).toBeNull();
  });

  it('skips deliveries that are no longer pending', async () => {
    prisma.crmCampaignDelivery.findFirst.mockResolvedValue({ id: 'd1', status: 'sent' });
    await processor.handleDeliverOne(job);
    expect(prisma.crmCampaign.findFirst).not.toHaveBeenCalled();
    expect(promoCodes.issueForDelivery).not.toHaveBeenCalled();
  });
});
