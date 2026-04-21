import { Test, TestingModule } from '@nestjs/testing';
import { MenuEngineeringController } from '../menu-engineering.controller';
import { MenuEngineeringService } from '../menu-engineering.service';
import { GenerateSnapshotDto } from '../dto/generate-snapshot.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('MenuEngineeringController', () => {
  let controller: MenuEngineeringController;
  let service: MenuEngineeringService;

  const mockMenuEngineeringService = {
    generateSnapshot: jest.fn(),
    getSnapshot: jest.fn(),
    getLatestSnapshot: jest.fn(),
    getSnapshots: jest.fn(),
    getClassificationSummary: jest.fn(),
    compareSnapshots: jest.fn(),
  };

  const mockJwtPayload = {
    sub: 'user-1',
    tenantId: 'tenant-1',
    email: 'test@example.com',
    role: 'admin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MenuEngineeringController],
      providers: [
        {
          provide: MenuEngineeringService,
          useValue: mockMenuEngineeringService,
        },
      ],
    }).compile();

    controller = module.get<MenuEngineeringController>(MenuEngineeringController);
    service = module.get<MenuEngineeringService>(MenuEngineeringService);

    jest.clearAllMocks();
  });

  describe('generateSnapshot', () => {
    it('should generate a new snapshot', async () => {
      const dto: GenerateSnapshotDto = {
        propertyId: 'prop-123',
        period: '2026-04',
      };

      const mockSnapshot = {
        id: 'snapshot-1',
        tenantId: 'tenant-1',
        propertyId: 'prop-123',
        period: '2026-04',
        snapshotDate: new Date(),
        avgPopularity: new Decimal('45.5'),
        avgMargin: new Decimal('35.2'),
        totalItems: 28,
        starsCount: 7,
        plowhorsesCount: 8,
        puzzlesCount: 5,
        dogsCount: 8,
        createdBy: 'user-1',
        createdAt: new Date(),
        items: [],
      };

      jest.spyOn(service, 'generateSnapshot').mockResolvedValue(mockSnapshot as any);

      const result = await controller.generateSnapshot(mockJwtPayload, dto);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.id).toBe('snapshot-1');
      expect(service.generateSnapshot).toHaveBeenCalledWith(dto, 'user-1', 'tenant-1');
    });
  });

  describe('listSnapshots', () => {
    it('should throw BadRequestException if propertyId is missing', async () => {
      await expect(controller.listSnapshots(mockJwtPayload, '', '0', '20')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return paginated snapshots', async () => {
      const mockSnapshots = [
        {
          id: 'snapshot-1',
          tenantId: 'tenant-1',
          propertyId: 'prop-123',
          period: '2026-04',
          totalItems: 28,
          starsCount: 7,
          plowhorsesCount: 8,
          puzzlesCount: 5,
          dogsCount: 8,
          createdAt: new Date(),
        },
      ];

      jest.spyOn(service, 'getSnapshots').mockResolvedValue({
        data: mockSnapshots as any,
        total: 1,
      });

      const result = await controller.listSnapshots(mockJwtPayload, 'prop-123', '0', '20');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(0);
      expect(result.meta.limit).toBe(20);
    });

    it('should handle default pagination values', async () => {
      jest.spyOn(service, 'getSnapshots').mockResolvedValue({
        data: [],
        total: 0,
      });

      await controller.listSnapshots(mockJwtPayload, 'prop-123');

      expect(service.getSnapshots).toHaveBeenCalledWith('tenant-1', 'prop-123', 0, 20);
    });
  });

  describe('getLatestSnapshot', () => {
    it('should throw BadRequestException if propertyId is missing', async () => {
      await expect(controller.getLatestSnapshot(mockJwtPayload, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return latest snapshot', async () => {
      const mockSnapshot = {
        id: 'snapshot-1',
        tenantId: 'tenant-1',
        propertyId: 'prop-123',
        period: '2026-04',
        avgPopularity: new Decimal('45.5'),
        avgMargin: new Decimal('35.2'),
        totalItems: 28,
        starsCount: 7,
        plowhorsesCount: 8,
        puzzlesCount: 5,
        dogsCount: 8,
        createdBy: 'user-1',
        createdAt: new Date(),
        snapshotDate: new Date(),
        items: [],
      };

      jest.spyOn(service, 'getLatestSnapshot').mockResolvedValue(mockSnapshot as any);

      const result = await controller.getLatestSnapshot(mockJwtPayload, 'prop-123');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.period).toBe('2026-04');
    });

    it('should return null if no snapshots exist', async () => {
      jest.spyOn(service, 'getLatestSnapshot').mockResolvedValue(null);

      const result = await controller.getLatestSnapshot(mockJwtPayload, 'prop-123');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('getSnapshot', () => {
    it('should return snapshot by ID', async () => {
      const mockSnapshot = {
        id: 'snapshot-1',
        tenantId: 'tenant-1',
        propertyId: 'prop-123',
        period: '2026-04',
        avgPopularity: new Decimal('45.5'),
        avgMargin: new Decimal('35.2'),
        totalItems: 28,
        starsCount: 7,
        plowhorsesCount: 8,
        puzzlesCount: 5,
        dogsCount: 8,
        createdBy: 'user-1',
        createdAt: new Date(),
        snapshotDate: new Date(),
        items: [
          {
            id: 'item-1',
            menuItemName: 'Caesar Salad',
            categoryName: 'Salads',
            quantitySold: 100,
            sellingPrice: new Decimal('10'),
            ingredientCost: new Decimal('4.5'),
            contributionMargin: new Decimal('5.5'),
            marginPercent: new Decimal('55'),
            totalRevenue: new Decimal('1000'),
            totalCost: new Decimal('450'),
            totalProfit: new Decimal('550'),
            popularityIndex: new Decimal('120'),
            classification: 'STAR',
            recommendation: 'Maintain quality...',
          },
        ],
      };

      jest.spyOn(service, 'getSnapshot').mockResolvedValue(mockSnapshot as any);

      const result = await controller.getSnapshot(mockJwtPayload, 'snapshot-1');

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items?.[0].classification).toBe('STAR');
    });

    it('should throw NotFoundException if snapshot not found', async () => {
      jest.spyOn(service, 'getSnapshot').mockRejectedValue(new NotFoundException());

      await expect(controller.getSnapshot(mockJwtPayload, 'snapshot-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getClassificationSummary', () => {
    it('should return classification summary', async () => {
      const mockSnapshot = {
        id: 'snapshot-1',
        tenantId: 'tenant-1',
        propertyId: 'prop-123',
        period: '2026-04',
        avgPopularity: new Decimal('45.5'),
        avgMargin: new Decimal('35.2'),
        totalItems: 28,
        createdBy: 'user-1',
        createdAt: new Date(),
        snapshotDate: new Date(),
        starsCount: 7,
        plowhorsesCount: 8,
        puzzlesCount: 5,
        dogsCount: 8,
      };

      const mockSummary = {
        stars: [
          {
            name: 'Caesar Salad',
            marginPercent: new Decimal('55'),
            quantitySold: 100,
            totalProfit: new Decimal('5500'),
          },
        ],
        plowhorses: [],
        puzzles: [],
        dogs: [],
        summary: {
          totalItems: 28,
          avgMargin: new Decimal('35.2'),
          avgPopularity: new Decimal('45.5'),
        },
      };

      jest.spyOn(service, 'getSnapshot').mockResolvedValue(mockSnapshot as any);
      jest.spyOn(service, 'getClassificationSummary').mockResolvedValue(mockSummary as any);

      const result = await controller.getClassificationSummary(mockJwtPayload, 'snapshot-1');

      expect(result.success).toBe(true);
      expect(result.data.stars).toHaveLength(1);
      expect(result.data.summary.totalItems).toBe(28);
    });
  });

  describe('compareSnapshots', () => {
    it('should throw BadRequestException if snapshot IDs are missing', async () => {
      await expect(controller.compareSnapshots(mockJwtPayload, '', '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should compare two snapshots', async () => {
      const mockComparison = {
        improved: [
          {
            name: 'Caesar Salad',
            fromClassification: 'PLOWHORSE',
            toClassification: 'STAR',
            marginChange: new Decimal('5.2'),
          },
        ],
        declined: [],
        unchanged: 20,
      };

      jest.spyOn(service, 'compareSnapshots').mockResolvedValue(mockComparison as any);

      const result = await controller.compareSnapshots(mockJwtPayload, 'snapshot-1', 'snapshot-2');

      expect(result.success).toBe(true);
      expect(result.data.improved).toHaveLength(1);
      expect(result.data.unchanged).toBe(20);
      expect(service.compareSnapshots).toHaveBeenCalledWith('tenant-1', 'snapshot-1', 'snapshot-2');
    });
  });
});
