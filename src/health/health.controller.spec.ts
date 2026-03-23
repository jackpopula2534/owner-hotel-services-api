import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  const mockHealthService = {
    check: jest.fn(),
    readinessCheck: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    service = module.get<HealthService>(HealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should return liveness check status', async () => {
      const mockResult = {
        status: 'ok',
        timestamp: '2026-03-23T10:30:00.000Z',
        uptime: 1234.56,
        version: '1.0.0',
      };

      mockHealthService.check.mockResolvedValue(mockResult);

      const result = await controller.check();

      expect(result).toEqual(mockResult);
      expect(service.check).toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('should return readiness check with all dependencies up', async () => {
      const mockResult = {
        status: 'ok',
        timestamp: '2026-03-23T10:30:00.000Z',
        checks: {
          database: { status: 'up' },
          redis: { status: 'up' },
        },
      };

      mockHealthService.readinessCheck.mockResolvedValue(mockResult);

      const result = await controller.ready();

      expect(result).toEqual(mockResult);
      expect(service.readinessCheck).toHaveBeenCalled();
    });

    it('should return degraded status when cache is unavailable', async () => {
      const mockResult = {
        status: 'degraded',
        timestamp: '2026-03-23T10:30:00.000Z',
        checks: {
          database: { status: 'up' },
          redis: {
            status: 'degraded',
            note: 'Cache service initialized but not connected',
          },
        },
      };

      mockHealthService.readinessCheck.mockResolvedValue(mockResult);

      const result = await controller.ready();

      expect(result).toEqual(mockResult);
      expect(result.status).toBe('degraded');
    });
  });
});
