import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

describe('HealthService', () => {
  let service: HealthService;
  let prismaService: PrismaService;
  let cacheService: CacheService;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
  };

  const mockCacheService = {
    isAvailable: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    prismaService = module.get<PrismaService>(PrismaService);
    cacheService = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should return liveness check with correct structure', async () => {
      const result = await service.check();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('version');
      expect(typeof result.timestamp).toBe('string');
      expect(typeof result.uptime).toBe('number');
    });

    it('should have valid ISO timestamp', async () => {
      const result = await service.check();

      const timestamp = new Date(result.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it('should have positive uptime', async () => {
      const result = await service.check();

      expect(result.uptime).toBeGreaterThan(0);
    });
  });

  describe('readinessCheck', () => {
    it('should return ok status when all dependencies are up', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      mockCacheService.isAvailable.mockReturnValue(true);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.del.mockResolvedValue(undefined);

      const result = await service.readinessCheck();

      expect(result.status).toBe('ok');
      expect(result.checks.database.status).toBe('up');
      expect(result.checks.redis.status).toBe('up');
    });

    it('should return degraded status when database is down', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(
        new Error('Connection timeout'),
      );
      mockCacheService.isAvailable.mockReturnValue(true);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.del.mockResolvedValue(undefined);

      const result = await service.readinessCheck();

      expect(result.checks.database.status).toBe('down');
      expect(result.checks.database.error).toBe('Connection failed');
    });

    it('should return degraded status when cache is unavailable', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      mockCacheService.isAvailable.mockReturnValue(false);

      const result = await service.readinessCheck();

      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('up');
      expect(result.checks.redis.status).toBe('degraded');
    });

    it('should throw ServiceUnavailableException when database is down', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(
        new Error('Connection refused'),
      );
      mockCacheService.isAvailable.mockReturnValue(true);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.del.mockResolvedValue(undefined);

      await expect(service.readinessCheck()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should include timestamp in response', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      mockCacheService.isAvailable.mockReturnValue(true);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.del.mockResolvedValue(undefined);

      const result = await service.readinessCheck();

      expect(result).toHaveProperty('timestamp');
      const timestamp = new Date(result.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it('should test cache connection with get/set operations', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      mockCacheService.isAvailable.mockReturnValue(true);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.del.mockResolvedValue(undefined);

      await service.readinessCheck();

      expect(mockCacheService.set).toHaveBeenCalledWith(
        '__health_check__',
        'test',
        { ttl: 5 },
      );
      expect(mockCacheService.del).toHaveBeenCalledWith('__health_check__');
    });
  });
});
