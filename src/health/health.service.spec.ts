import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

describe('HealthService', () => {
  let service: HealthService;
  let prismaService: PrismaService;
  let cacheService: CacheService;
  let dataSource: DataSource;

  const mockPrismaService = {
    $queryRaw: jest.fn(),
  };

  const mockCacheService = {
    isAvailable: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const mockDataSource = {
    isInitialized: true,
    query: jest.fn(),
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
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    prismaService = module.get<PrismaService>(PrismaService);
    cacheService = module.get<CacheService>(CacheService);
    dataSource = module.get<DataSource>(DataSource);
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
      mockDataSource.query.mockResolvedValue([]);

      const result = await service.readinessCheck();

      expect(result.status).toBe('ok');
      expect(result.checks.database.status).toBe('up');
      expect(result.checks.typeorm.status).toBe('up');
      expect(result.checks.cache.status).toBe('up');
    });

    it('should throw when database is down', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection timeout'));
      mockCacheService.isAvailable.mockReturnValue(true);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.del.mockResolvedValue(undefined);
      mockDataSource.query.mockResolvedValue([]);

      await expect(service.readinessCheck()).rejects.toThrow(ServiceUnavailableException);
    });

    it('should return degraded status when cache is unavailable', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      mockCacheService.isAvailable.mockReturnValue(false);
      mockDataSource.query.mockResolvedValue([]);

      const result = await service.readinessCheck();

      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('up');
      expect(result.checks.cache.status).toBe('degraded');
    });

    it('should throw ServiceUnavailableException when database is down', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('Connection refused'));
      mockCacheService.isAvailable.mockReturnValue(true);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.del.mockResolvedValue(undefined);
      mockDataSource.query.mockResolvedValue([]);

      await expect(service.readinessCheck()).rejects.toThrow(ServiceUnavailableException);
    });

    it('should include timestamp in response', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      mockCacheService.isAvailable.mockReturnValue(true);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.del.mockResolvedValue(undefined);
      mockDataSource.query.mockResolvedValue([]);

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
      mockDataSource.query.mockResolvedValue([]);

      await service.readinessCheck();

      expect(mockCacheService.set).toHaveBeenCalledWith('__health_check__', 'ok', { ttl: 5 });
      expect(mockCacheService.del).toHaveBeenCalledWith('__health_check__');
    });
  });
});
