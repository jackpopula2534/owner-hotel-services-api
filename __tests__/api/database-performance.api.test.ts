import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseOptimizationController } from '../../src/database-optimization/database-optimization.controller';
import { QueryPerformanceService } from '../../src/database-optimization/query-performance.service';

describe('Database Performance API', () => {
  let controller: DatabaseOptimizationController;
  let queryPerformanceService: QueryPerformanceService;

  const mockQueryPerformanceService = {
    getSlowQueryReport: jest.fn(),
    analyzeQueryPatterns: jest.fn(),
    detectN1Queries: jest.fn(),
    getDatabaseHealth: jest.fn(),
    clearMetrics: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DatabaseOptimizationController],
      providers: [
        {
          provide: QueryPerformanceService,
          useValue: mockQueryPerformanceService,
        },
      ],
    }).compile();

    controller = module.get<DatabaseOptimizationController>(DatabaseOptimizationController);
    queryPerformanceService = module.get<QueryPerformanceService>(QueryPerformanceService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/v1/admin/database/slow-queries', () => {
    it('should return slow query report', () => {
      const mockReport = {
        totalQueries: 100,
        slowQueries: 15,
        averageDuration: 2500,
        slowestQueries: [
          {
            query: 'SELECT * FROM bookings WHERE tenant_id = ?',
            duration: 5200,
            timestamp: new Date('2024-01-15T10:30:00Z'),
          },
          {
            query: 'SELECT * FROM rooms JOIN bookings ON ...',
            duration: 4800,
            timestamp: new Date('2024-01-15T10:25:00Z'),
          },
        ],
      };

      mockQueryPerformanceService.getSlowQueryReport.mockReturnValue(mockReport);

      const result = controller.getSlowQueryReport();

      expect(queryPerformanceService.getSlowQueryReport).toHaveBeenCalled();
      expect(result.totalQueries).toBe(100);
      expect(result.slowestQueries).toHaveLength(2);
    });

    it('should return empty report when no slow queries', () => {
      const mockReport = {
        totalQueries: 0,
        slowQueries: 0,
        averageDuration: 0,
        slowestQueries: [],
      };

      mockQueryPerformanceService.getSlowQueryReport.mockReturnValue(mockReport);

      const result = controller.getSlowQueryReport();

      expect(result.totalQueries).toBe(0);
      expect(result.slowestQueries).toHaveLength(0);
    });
  });

  describe('GET /api/v1/admin/database/query-patterns', () => {
    it('should analyze query patterns', async () => {
      const mockPatterns = {
        patterns: [
          {
            query: 'SELECT * FROM bookings WHERE tenant_id = ?',
            count: 500,
            avgDuration: 120,
          },
          {
            query: 'SELECT * FROM rooms WHERE status = ?',
            count: 300,
            avgDuration: 85,
          },
        ],
        recommendations: [
          'Consider adding index on tenant_id',
        ],
      };

      mockQueryPerformanceService.analyzeQueryPatterns.mockResolvedValue(mockPatterns);

      const result = await controller.analyzeQueryPatterns();

      expect(queryPerformanceService.analyzeQueryPatterns).toHaveBeenCalled();
      expect(result.patterns).toHaveLength(2);
      expect(result.recommendations).toHaveLength(1);
    });

    it('should handle no patterns found', async () => {
      const mockPatterns = {
        patterns: [],
        recommendations: [],
      };

      mockQueryPerformanceService.analyzeQueryPatterns.mockResolvedValue(mockPatterns);

      const result = await controller.analyzeQueryPatterns();

      expect(result.patterns).toHaveLength(0);
    });
  });

  describe('GET /api/v1/admin/database/n1-detection', () => {
    it('should detect N+1 query problems', () => {
      const mockDetection = {
        detected: true,
        suspectedQueries: [
          'SELECT * FROM guests WHERE booking_id = ?',
          'SELECT * FROM bookings WHERE room_id = ?',
          'SELECT * FROM rooms WHERE hotel_id = ?',
        ],
      };

      mockQueryPerformanceService.detectN1Queries.mockReturnValue(mockDetection);

      const result = controller.detectN1Queries();

      expect(queryPerformanceService.detectN1Queries).toHaveBeenCalled();
      expect(result.detected).toBe(true);
      expect(result.suspectedQueries).toHaveLength(3);
    });

    it('should return no problems when database is optimized', () => {
      const mockDetection = {
        detected: false,
        suspectedQueries: [],
      };

      mockQueryPerformanceService.detectN1Queries.mockReturnValue(mockDetection);

      const result = controller.detectN1Queries();

      expect(result.detected).toBe(false);
      expect(result.suspectedQueries).toHaveLength(0);
    });
  });

  describe('GET /api/v1/admin/database/health', () => {
    it('should return database health metrics', async () => {
      const mockHealth = {
        connectionPool: {
          active: 5,
          idle: 15,
        },
        avgQueryTime: 45,
        slowQueryPercentage: 2.5,
      };

      mockQueryPerformanceService.getDatabaseHealth.mockResolvedValue(mockHealth);

      const result = await controller.getDatabaseHealth();

      expect(queryPerformanceService.getDatabaseHealth).toHaveBeenCalled();
      expect(result.connectionPool.active).toBe(5);
      expect(result.slowQueryPercentage).toBe(2.5);
    });

    it('should indicate high connection pool usage', async () => {
      const mockHealth = {
        connectionPool: {
          active: 20,
          idle: 0,
        },
        avgQueryTime: 350,
        slowQueryPercentage: 25,
      };

      mockQueryPerformanceService.getDatabaseHealth.mockResolvedValue(mockHealth);

      const result = await controller.getDatabaseHealth();

      expect(result.connectionPool.active).toBe(20);
      expect(result.connectionPool.idle).toBe(0);
    });

    it('should handle high slow query percentage', async () => {
      const mockHealth = {
        connectionPool: {
          active: 8,
          idle: 12,
        },
        avgQueryTime: 200,
        slowQueryPercentage: 15,
      };

      mockQueryPerformanceService.getDatabaseHealth.mockResolvedValue(mockHealth);

      const result = await controller.getDatabaseHealth();

      expect(result.slowQueryPercentage).toBe(15);
      expect(result.avgQueryTime).toBe(200);
    });
  });

  describe('POST /api/v1/admin/database/clear-metrics', () => {
    it('should clear query metrics', () => {
      mockQueryPerformanceService.clearMetrics.mockReturnValue(undefined);

      const result = controller.clearMetrics();

      expect(queryPerformanceService.clearMetrics).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.message).toBe('Query metrics cleared');
    });
  });
});
