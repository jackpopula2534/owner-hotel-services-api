import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let mockAnnFindMany: jest.Mock;
  let mockAnnCreate: jest.Mock;
  let mockReadsFindMany: jest.Mock;
  let mockReadsCreate: jest.Mock;

  beforeEach(async () => {
    mockAnnFindMany = jest.fn();
    mockAnnCreate = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'a1',
      ...data,
    }));
    mockReadsFindMany = jest.fn().mockResolvedValue([]);
    mockReadsCreate = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        {
          provide: PrismaService,
          useValue: {
            announcements: {
              findMany: mockAnnFindMany,
              findUnique: jest.fn(),
              create: mockAnnCreate,
              update: jest.fn(),
            },
            announcement_reads: {
              findMany: mockReadsFindMany,
              create: mockReadsCreate,
            },
          },
        },
      ],
    }).compile();

    service = module.get(AnnouncementsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('rejects empty title', async () => {
      await expect(
        service.create({ title: '   ', body: 'x', severity: 'info' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults audience to all and uses now for publishedAt', async () => {
      await service.create({ title: 'Hello', body: 'World' });
      expect(mockAnnCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            audience: 'all',
            severity: 'info',
          }),
        }),
      );
      const data = mockAnnCreate.mock.calls[0][0].data;
      expect(data.published_at).toBeInstanceOf(Date);
    });
  });

  describe('listForTenant', () => {
    const baseAnn = {
      id: 'a1',
      title: 'Maintenance',
      body: '...',
      severity: 'info',
      audience: 'all',
      audience_filter: null,
      published_at: new Date('2026-04-01'),
      expires_at: null,
    };

    it('returns matching announcements with isRead=false when not yet read', async () => {
      mockAnnFindMany.mockResolvedValue([baseAnn]);
      mockReadsFindMany.mockResolvedValue([]);
      const r = await service.listForTenant('t1', 'active');
      expect(r).toHaveLength(1);
      expect(r[0].isRead).toBe(false);
    });

    it('marks isRead=true when read row exists', async () => {
      mockAnnFindMany.mockResolvedValue([baseAnn]);
      mockReadsFindMany.mockResolvedValue([
        { announcement_id: 'a1', tenant_id: 't1' },
      ]);
      const r = await service.listForTenant('t1', 'active');
      expect(r[0].isRead).toBe(true);
    });

    it('filters specific_tenants audience by tenant id', async () => {
      mockAnnFindMany.mockResolvedValue([
        {
          ...baseAnn,
          audience: 'specific_tenants',
          audience_filter: { tenantIds: ['other-tenant'] },
        },
      ]);
      const r = await service.listForTenant('t1', 'active');
      expect(r).toHaveLength(0);
    });

    it('filters tenants_by_status audience by tenant status', async () => {
      mockAnnFindMany.mockResolvedValue([
        {
          ...baseAnn,
          audience: 'tenants_by_status',
          audience_filter: { statuses: ['past_due'] },
        },
      ]);
      const matched = await service.listForTenant('t1', 'past_due');
      expect(matched).toHaveLength(1);
      const notMatched = await service.listForTenant('t1', 'active');
      expect(notMatched).toHaveLength(0);
    });
  });

  describe('markAsRead', () => {
    it('creates a read row', async () => {
      await service.markAsRead({ announcementId: 'a1', tenantId: 't1' });
      expect(mockReadsCreate).toHaveBeenCalled();
    });

    it('is idempotent on unique-constraint race', async () => {
      mockReadsCreate.mockRejectedValue(new Error('Unique constraint failed'));
      await expect(
        service.markAsRead({ announcementId: 'a1', tenantId: 't1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('unreadCount', () => {
    it('counts visible-but-unread announcements', async () => {
      mockAnnFindMany.mockResolvedValue([
        {
          id: 'a1',
          audience: 'all',
          published_at: new Date('2026-04-01'),
          expires_at: null,
          severity: 'info',
        },
        {
          id: 'a2',
          audience: 'all',
          published_at: new Date('2026-04-02'),
          expires_at: null,
          severity: 'info',
        },
      ]);
      mockReadsFindMany.mockResolvedValue([{ announcement_id: 'a1' }]);
      const count = await service.unreadCount('t1', 'active');
      expect(count).toBe(1);
    });
  });
});
