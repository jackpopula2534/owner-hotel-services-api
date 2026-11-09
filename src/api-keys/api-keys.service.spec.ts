import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let mockCreate: jest.Mock;
  let mockFindMany: jest.Mock;
  let mockFindUnique: jest.Mock;
  let mockUpdate: jest.Mock;

  beforeEach(async () => {
    mockCreate = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'key-1',
      ...data,
    }));
    mockFindMany = jest.fn().mockResolvedValue([]);
    mockFindUnique = jest.fn();
    mockUpdate = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        {
          provide: PrismaService,
          useValue: {
            api_keys: {
              create: mockCreate,
              findMany: mockFindMany,
              findUnique: mockFindUnique,
              update: mockUpdate,
            },
          },
        },
      ],
    }).compile();

    service = module.get(ApiKeysService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('rejects empty name', async () => {
      await expect(
        service.create({
          tenantId: 't1',
          name: '   ',
          scopes: ['read:bookings'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty scope list', async () => {
      await expect(service.create({ tenantId: 't1', name: 'X', scopes: [] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns plaintext only on creation', async () => {
      const r = await service.create({
        tenantId: 't1',
        name: 'CI key',
        scopes: ['read:bookings', 'read:rooms'],
      });
      expect(r.plaintext).toMatch(/^ssk_/);
      expect(r.prefix).toMatch(/^ssk_/);
      expect(r.scopes).toEqual(['read:bookings', 'read:rooms']);
      // The hash stored is NOT the plaintext
      const data = mockCreate.mock.calls[0][0].data;
      expect(data.key_hash).not.toBe(r.plaintext);
      expect(data.key_hash).toBe(service.hash(r.plaintext));
    });
  });

  describe('verify', () => {
    it('returns tenantId + scopes for active key', async () => {
      const plaintext = 'ssk_' + 'A'.repeat(43);
      mockFindUnique.mockResolvedValue({
        id: 'k1',
        tenant_id: 't1',
        is_active: 1,
        revoked_at: null,
        expires_at: null,
        scopes: ['read:bookings'],
      });

      const r = await service.verify(plaintext);
      expect(r).toEqual({
        keyId: 'k1',
        tenantId: 't1',
        scopes: ['read:bookings'],
      });
    });

    it('rejects when key is revoked', async () => {
      mockFindUnique.mockResolvedValue({
        is_active: 0,
        revoked_at: new Date(),
      });
      const r = await service.verify('ssk_xxx');
      expect(r).toBeNull();
    });

    it('rejects expired key', async () => {
      mockFindUnique.mockResolvedValue({
        is_active: 1,
        revoked_at: null,
        expires_at: new Date('2020-01-01'),
        scopes: [],
      });
      expect(await service.verify('ssk_xxx')).toBeNull();
    });

    it('rejects non-prefixed plaintext', async () => {
      expect(await service.verify('badkey')).toBeNull();
    });

    it('returns null for unknown hash', async () => {
      mockFindUnique.mockResolvedValue(null);
      expect(await service.verify('ssk_xxx')).toBeNull();
    });
  });

  describe('revoke', () => {
    it('marks the key as revoked', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'k1',
        tenant_id: 't1',
        revoked_at: null,
      });
      await service.revoke('k1', 't1');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ is_active: 0 }),
        }),
      );
    });

    it('rejects cross-tenant revoke', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'k1',
        tenant_id: 't1',
        revoked_at: null,
      });
      await expect(service.revoke('k1', 'other')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound for unknown key', async () => {
      mockFindUnique.mockResolvedValue(null);
      await expect(service.revoke('missing', 't1')).rejects.toThrow(NotFoundException);
    });

    it('is idempotent for already-revoked key', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'k1',
        tenant_id: 't1',
        revoked_at: new Date(),
      });
      await service.revoke('k1', 't1');
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('omits the key hash from public-facing rows', async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 'k1',
          name: 'CI',
          key_prefix: 'ssk_abc',
          key_hash: 'super-secret-hash',
          scopes: ['read:bookings'],
          is_active: 1,
          last_used_at: null,
          expires_at: null,
          revoked_at: null,
          created_at: new Date(),
        },
      ]);

      const r = await service.list('t1');
      expect(r).toHaveLength(1);
      expect((r[0] as any).key_hash).toBeUndefined();
      expect((r[0] as any).prefix).toBe('ssk_abc');
      expect((r[0] as any).isActive).toBe(true);
    });
  });
});
