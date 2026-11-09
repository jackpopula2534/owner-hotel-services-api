import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrandingService } from './branding.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BrandingService', () => {
  let service: BrandingService;
  let mockUpsert: jest.Mock;
  let mockFindUnique: jest.Mock;
  let mockFindFirst: jest.Mock;
  let mockUpdate: jest.Mock;

  beforeEach(async () => {
    mockUpsert = jest.fn().mockImplementation(async ({ create }) => ({ id: 'b1', ...create }));
    mockFindUnique = jest.fn();
    mockFindFirst = jest.fn();
    mockUpdate = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandingService,
        {
          provide: PrismaService,
          useValue: {
            tenant_brandings: {
              upsert: mockUpsert,
              findUnique: mockFindUnique,
              findFirst: mockFindFirst,
              update: mockUpdate,
            },
          },
        },
      ],
    }).compile();

    service = module.get(BrandingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('upsert', () => {
    it('rejects non-hex primary color', async () => {
      await expect(service.upsert({ tenantId: 't1', primaryColor: 'red' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects malformed email sender', async () => {
      await expect(
        service.upsert({ tenantId: 't1', emailSenderAddress: 'not-an-email' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts valid colors and email', async () => {
      await service.upsert({
        tenantId: 't1',
        primaryColor: '#7c3aed',
        accentColor: '#06b6d4',
        emailSenderAddress: 'noreply@hotel.com',
        emailSenderName: 'Hotel',
      });
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 't1' },
        }),
      );
    });
  });

  describe('requestCustomDomain', () => {
    it('rejects invalid domain shape', async () => {
      await expect(service.requestCustomDomain('t1', 'not a domain')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects domain already used by another tenant', async () => {
      mockFindFirst.mockResolvedValue({ id: 'other' });
      await expect(service.requestCustomDomain('t1', 'app.hotel.com')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns DNS instructions when domain is free', async () => {
      mockFindFirst.mockResolvedValue(null);
      mockUpsert.mockResolvedValueOnce({ id: 'b1' });
      const r = await service.requestCustomDomain('t1', 'app.hotel.com');
      expect(r.domain).toBe('app.hotel.com');
      expect(r.verificationToken).toMatch(/^staysync-verify=/);
      expect(r.cname).toBe('cname.staysync.com');
    });

    it('lowercases the domain', async () => {
      mockFindFirst.mockResolvedValue(null);
      mockUpsert.mockResolvedValueOnce({ id: 'b1' });
      const r = await service.requestCustomDomain('t1', 'APP.HOTEL.COM');
      expect(r.domain).toBe('app.hotel.com');
    });
  });

  describe('setDomainStatus', () => {
    it('updates last_verified_at when status = verified', async () => {
      mockFindUnique.mockResolvedValue({ tenant_id: 't1' });
      await service.setDomainStatus('t1', 'verified');
      const data = mockUpdate.mock.calls[0][0].data;
      expect(data.domain_status).toBe('verified');
      expect(data.last_verified_at).toBeInstanceOf(Date);
    });

    it('throws NotFound for unknown tenant', async () => {
      mockFindUnique.mockResolvedValue(null);
      await expect(service.setDomainStatus('missing', 'failed')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveByDomain', () => {
    it('returns only verified rows', async () => {
      mockFindFirst.mockResolvedValue({ id: 'b1', tenant_id: 't1' });
      const r = await service.resolveByDomain('app.hotel.com');
      expect(r).toBeTruthy();
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ domain_status: 'verified' }),
        }),
      );
    });
  });
});
