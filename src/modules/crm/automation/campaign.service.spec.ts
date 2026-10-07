import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { CampaignService } from './campaign.service';
import { AudienceResolver } from './audience.resolver';
import { PrismaService } from '../../../prisma/prisma.service';
import { CRM_CAMPAIGN_QUEUE } from './campaign.constants';
import { CampaignPromoCodeService } from './campaign-promo-code.service';

describe('CampaignService', () => {
  let service: CampaignService;

  const mockPrisma = {
    crmCampaign: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockResolver = {
    estimateSize: jest.fn(),
    resolve: jest.fn(),
  };

  const mockPromoCodes = {
    assertLinkable: jest.fn(),
    listForPromotion: jest.fn(),
    statsForCampaign: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn(),
    getJob: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AudienceResolver, useValue: mockResolver },
        { provide: getQueueToken(CRM_CAMPAIGN_QUEUE), useValue: mockQueue },
        { provide: CampaignPromoCodeService, useValue: mockPromoCodes },
      ],
    }).compile();
    service = module.get(CampaignService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('rejects email campaign without subject or template', async () => {
      await expect(service.create({ name: 'x', channel: 'email' }, 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts email campaign with templateKey only', async () => {
      mockPrisma.crmCampaign.create.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
      const r = await service.create({ name: 'x', channel: 'email', templateKey: 'welcome' }, 't1');
      expect(r.channel).toBe('email');
      expect(r.status).toBe('draft');
    });
  });

  describe('create — promo campaign', () => {
    it('checks the promotion is linkable before creating', async () => {
      mockPrisma.crmCampaign.create.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
      const r = await service.create(
        { name: 'x', channel: 'line', promotionId: 'p1', promoCodeValidDays: 14 } as never,
        't1',
      );
      expect(mockPromoCodes.assertLinkable).toHaveBeenCalledWith('t1', 'p1', 'line');
      expect(r).toEqual(expect.objectContaining({ promotionId: 'p1', promoCodeValidDays: 14 }));
    });

    it('does not create when the promotion is not linkable', async () => {
      mockPromoCodes.assertLinkable.mockRejectedValueOnce(new BadRequestException('archived'));
      await expect(
        service.create({ name: 'x', channel: 'line', promotionId: 'p1' } as never, 't1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrisma.crmCampaign.create).not.toHaveBeenCalled();
    });

    it('skips the promo check for a plain campaign', async () => {
      mockPrisma.crmCampaign.create.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
      await service.create({ name: 'x', channel: 'line' } as never, 't1');
      expect(mockPromoCodes.assertLinkable).not.toHaveBeenCalled();
    });
  });

  describe('update — promo campaign', () => {
    it('never changes promotionId after create', async () => {
      mockPrisma.crmCampaign.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', status: 'draft' });
      mockPrisma.crmCampaign.update.mockResolvedValue({ id: 'c1' });
      await service.update('c1', { promotionId: 'p2', promoCodeValidDays: 7 } as never, 't1');
      const data = mockPrisma.crmCampaign.update.mock.calls[0][0].data;
      expect(data.promotionId).toBeUndefined();
      expect(data.promoCodeValidDays).toBe(7);
    });
  });

  describe('estimateAudience', () => {
    it('counts only members reachable on the chosen channel', async () => {
      mockResolver.estimateSize.mockResolvedValue(5);
      mockResolver.resolve.mockResolvedValue([
        { email: 'a@x.com', guestId: 'g1' },
        { email: 'b@x.com', guestId: null },
        { email: null, guestId: 'g3' },
      ]);
      const r = await service.estimateAudience({ segments: ['vip'], channel: 'email' } as never, 't1');
      expect(r).toEqual(expect.objectContaining({ estimatedSize: 5, consented: 3, reachable: 2 }));
    });

    it('requires a tenant', async () => {
      await expect(service.estimateAudience({} as never, '')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('schedule', () => {
    it('enqueues dispatch job with delay 0 if scheduledAt is in the past', async () => {
      const past = new Date(Date.now() - 60_000);
      mockPrisma.crmCampaign.findFirst.mockResolvedValue({
        id: 'c1',
        tenantId: 't1',
        status: 'draft',
        scheduledAt: past,
      });
      mockPrisma.crmCampaign.update.mockResolvedValue({ id: 'c1', status: 'scheduled' });

      await service.schedule('c1', 't1');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'dispatch',
        expect.objectContaining({ campaignId: 'c1', tenantId: 't1' }),
        expect.objectContaining({ delay: 0, jobId: 'dispatch-c1' }),
      );
    });

    it('refuses to schedule a completed campaign', async () => {
      mockPrisma.crmCampaign.findFirst.mockResolvedValue({
        id: 'c1',
        tenantId: 't1',
        status: 'completed',
      });
      await expect(service.schedule('c1', 't1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('refuses to edit running campaign', async () => {
      mockPrisma.crmCampaign.findFirst.mockResolvedValue({
        id: 'c1',
        tenantId: 't1',
        status: 'running',
      });
      await expect(service.update('c1', { name: 'new' }, 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows editing draft campaign', async () => {
      mockPrisma.crmCampaign.findFirst.mockResolvedValue({
        id: 'c1',
        tenantId: 't1',
        status: 'draft',
      });
      mockPrisma.crmCampaign.update.mockResolvedValue({ id: 'c1', name: 'updated' });
      const r = await service.update('c1', { name: 'updated' }, 't1');
      expect(r.name).toBe('updated');
    });
  });

  describe('cancel', () => {
    it('removes scheduled job and updates status', async () => {
      mockPrisma.crmCampaign.findFirst.mockResolvedValue({
        id: 'c1',
        tenantId: 't1',
        status: 'scheduled',
      });
      const mockJob = { remove: jest.fn() };
      mockQueue.getJob.mockResolvedValue(mockJob);
      mockPrisma.crmCampaign.update.mockResolvedValue({ id: 'c1', status: 'cancelled' });

      const r = await service.cancel('c1', 't1');
      expect(mockJob.remove).toHaveBeenCalled();
      expect(r.status).toBe('cancelled');
    });
  });

  describe('previewAudience', () => {
    it('returns estimated size from resolver', async () => {
      mockPrisma.crmCampaign.findFirst.mockResolvedValue({
        id: 'c1',
        tenantId: 't1',
        status: 'draft',
        audienceQuery: '{"segments":["vip"]}',
      });
      mockResolver.estimateSize.mockResolvedValue(42);
      const r = await service.previewAudience('c1', 't1');
      expect(r).toEqual({
        campaignId: 'c1',
        estimatedSize: 42,
        query: { segments: ['vip'] },
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      mockPrisma.crmCampaign.findFirst.mockResolvedValue(null);
      await expect(service.findOne('c1', 't1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
