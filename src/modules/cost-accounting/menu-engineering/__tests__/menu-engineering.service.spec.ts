import { Test, TestingModule } from '@nestjs/testing';
import { MenuEngineeringService } from '../menu-engineering.service';
import { PrismaService } from '@/prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { GenerateSnapshotDto } from '../dto/generate-snapshot.dto';
import { Decimal } from '@prisma/client/runtime/library';

describe('MenuEngineeringService', () => {
  let service: MenuEngineeringService;
  let prisma: PrismaService;

  const mockPrismaService = {
    foodCostAnalysis: {
      findMany: jest.fn(),
    },
    menuEngineeringSnapshot: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
    },
    menuEngineeringItem: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuEngineeringService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<MenuEngineeringService>(MenuEngineeringService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('generateSnapshot', () => {
    it('should validate period format', async () => {
      const invalidDto: GenerateSnapshotDto = {
        propertyId: 'prop-123',
        period: 'invalid-period',
      };

      await expect(service.generateSnapshot(invalidDto, 'user-1', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw error when no food cost analysis found', async () => {
      jest.spyOn(prisma.foodCostAnalysis, 'findMany').mockResolvedValue([]);

      const dto: GenerateSnapshotDto = {
        propertyId: 'prop-123',
        period: '2026-04',
      };

      await expect(service.generateSnapshot(dto, 'user-1', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should generate snapshot with valid data', async () => {
      const mockAnalyses = [
        {
          menuItemId: 'item-1',
          menuItemName: 'Caesar Salad',
          categoryName: 'Salads',
          quantitySold: 100,
          totalRevenue: new Decimal('1000'),
          ingredientCost: new Decimal('450'),
          sellingPrice: new Decimal('10'),
          periodClose: { period: '2026-04', propertyId: 'prop-123' },
        },
        {
          menuItemId: 'item-2',
          menuItemName: 'Greek Salad',
          categoryName: 'Salads',
          quantitySold: 50,
          totalRevenue: new Decimal('600'),
          ingredientCost: new Decimal('240'),
          sellingPrice: new Decimal('12'),
          periodClose: { period: '2026-04', propertyId: 'prop-123' },
        },
      ];

      jest.spyOn(prisma.foodCostAnalysis, 'findMany').mockResolvedValue(mockAnalyses as any);

      const mockTransaction = jest.fn().mockImplementation((cb) => {
        return cb({
          menuEngineeringSnapshot: {
            upsert: jest.fn().mockResolvedValue({
              id: 'snapshot-1',
              tenantId: 'tenant-1',
              propertyId: 'prop-123',
              period: '2026-04',
              avgPopularity: new Decimal('75'),
              avgMargin: new Decimal('35'),
              totalItems: 2,
              starsCount: 1,
              plowhorsesCount: 1,
              puzzlesCount: 0,
              dogsCount: 0,
              createdBy: 'user-1',
              createdAt: new Date(),
            }),
          },
          menuEngineeringItem: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
        });
      });

      jest.spyOn(prisma, '$transaction' as any).mockImplementation(mockTransaction);

      const dto: GenerateSnapshotDto = {
        propertyId: 'prop-123',
        period: '2026-04',
      };

      const result = await service.generateSnapshot(dto, 'user-1', 'tenant-1');

      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.period).toBe('2026-04');
    });
  });

  describe('getSnapshot', () => {
    it('should return snapshot by ID', async () => {
      const mockSnapshot = {
        id: 'snapshot-1',
        tenantId: 'tenant-1',
        propertyId: 'prop-123',
        period: '2026-04',
        totalItems: 2,
        items: [],
      };

      jest
        .spyOn(prisma.menuEngineeringSnapshot, 'findUnique')
        .mockResolvedValue(mockSnapshot as any);

      const result = await service.getSnapshot('snapshot-1', 'tenant-1');

      expect(result).toEqual(mockSnapshot);
      expect(prisma.menuEngineeringSnapshot.findUnique).toHaveBeenCalledWith({
        where: { id: 'snapshot-1' },
        include: {
          items: {
            orderBy: [{ classification: 'asc' }, { totalProfit: 'desc' }],
          },
        },
      });
    });

    it('should throw NotFoundException if snapshot not found', async () => {
      jest.spyOn(prisma.menuEngineeringSnapshot, 'findUnique').mockResolvedValue(null);

      await expect(service.getSnapshot('snapshot-1', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if tenant does not match', async () => {
      const mockSnapshot = {
        id: 'snapshot-1',
        tenantId: 'tenant-2',
        propertyId: 'prop-123',
      };

      jest
        .spyOn(prisma.menuEngineeringSnapshot, 'findUnique')
        .mockResolvedValue(mockSnapshot as any);

      await expect(service.getSnapshot('snapshot-1', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return latest snapshot for property', async () => {
      const mockSnapshot = {
        id: 'snapshot-1',
        tenantId: 'tenant-1',
        propertyId: 'prop-123',
        period: '2026-04',
        items: [],
      };

      jest
        .spyOn(prisma.menuEngineeringSnapshot, 'findFirst')
        .mockResolvedValue(mockSnapshot as any);

      const result = await service.getLatestSnapshot('tenant-1', 'prop-123');

      expect(result).toEqual(mockSnapshot);
      expect(prisma.menuEngineeringSnapshot.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          propertyId: 'prop-123',
        },
        orderBy: {
          period: 'desc',
        },
        include: {
          items: {
            orderBy: [{ classification: 'asc' }, { totalProfit: 'desc' }],
          },
        },
      });
    });

    it('should return null if no snapshots exist', async () => {
      jest.spyOn(prisma.menuEngineeringSnapshot, 'findFirst').mockResolvedValue(null);

      const result = await service.getLatestSnapshot('tenant-1', 'prop-123');

      expect(result).toBeNull();
    });
  });

  describe('getSnapshots', () => {
    it('should return paginated snapshots', async () => {
      const mockSnapshots = [
        {
          id: 'snapshot-1',
          period: '2026-04',
          totalItems: 2,
        },
      ];

      jest
        .spyOn(prisma.menuEngineeringSnapshot, 'findMany')
        .mockResolvedValue(mockSnapshots as any);
      jest.spyOn(prisma.menuEngineeringSnapshot, 'count').mockResolvedValue(1);

      const result = await service.getSnapshots('tenant-1', 'prop-123', 0, 20);

      expect(result.data).toEqual(mockSnapshots);
      expect(result.total).toBe(1);
      expect(prisma.menuEngineeringSnapshot.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          propertyId: 'prop-123',
        },
        orderBy: {
          period: 'desc',
        },
        skip: 0,
        take: 20,
      });
    });
  });

  describe('getClassificationSummary', () => {
    it('should return classification summary', async () => {
      const mockSnapshot = {
        id: 'snapshot-1',
        totalItems: 4,
        avgMargin: new Decimal('35'),
        avgPopularity: new Decimal('75'),
        items: [
          {
            classification: 'STAR',
            menuItemName: 'Caesar Salad',
            marginPercent: new Decimal('45'),
            quantitySold: 100,
            totalProfit: new Decimal('5500'),
          },
          {
            classification: 'PLOWHORSE',
            menuItemName: 'Pasta',
            marginPercent: new Decimal('25'),
            quantitySold: 80,
            totalProfit: new Decimal('2000'),
          },
          {
            classification: 'PUZZLE',
            menuItemName: 'Steak',
            marginPercent: new Decimal('55'),
            quantitySold: 20,
            totalProfit: new Decimal('1100'),
          },
          {
            classification: 'DOG',
            menuItemName: 'Soup',
            marginPercent: new Decimal('20'),
            quantitySold: 15,
            totalProfit: new Decimal('300'),
          },
        ],
      };

      jest
        .spyOn(prisma.menuEngineeringSnapshot, 'findUnique')
        .mockResolvedValue(mockSnapshot as any);

      const result = await service.getClassificationSummary('tenant-1', 'prop-123', '2026-04');

      expect(result.stars).toHaveLength(1);
      expect(result.plowhorses).toHaveLength(1);
      expect(result.puzzles).toHaveLength(1);
      expect(result.dogs).toHaveLength(1);
      expect(result.summary.totalItems).toBe(4);
    });

    it('should throw NotFoundException if snapshot not found', async () => {
      jest.spyOn(prisma.menuEngineeringSnapshot, 'findUnique').mockResolvedValue(null);

      await expect(
        service.getClassificationSummary('tenant-1', 'prop-123', '2026-04'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('compareSnapshots', () => {
    it('should compare two snapshots', async () => {
      const mockSnapshot1 = {
        id: 'snapshot-1',
        tenantId: 'tenant-1',
        items: [
          {
            menuItemId: 'item-1',
            menuItemName: 'Caesar Salad',
            classification: 'PLOWHORSE',
            marginPercent: new Decimal('25'),
          },
        ],
      };

      const mockSnapshot2 = {
        id: 'snapshot-2',
        tenantId: 'tenant-1',
        items: [
          {
            menuItemId: 'item-1',
            menuItemName: 'Caesar Salad',
            classification: 'STAR',
            marginPercent: new Decimal('30'),
          },
        ],
      };

      const findUniqueSpy = jest.spyOn(prisma.menuEngineeringSnapshot, 'findUnique');
      findUniqueSpy.mockResolvedValueOnce(mockSnapshot1 as any);
      findUniqueSpy.mockResolvedValueOnce(mockSnapshot2 as any);

      const result = await service.compareSnapshots('tenant-1', 'snapshot-1', 'snapshot-2');

      expect(result.improved).toHaveLength(1);
      expect(result.improved[0].fromClassification).toBe('PLOWHORSE');
      expect(result.improved[0].toClassification).toBe('STAR');
    });

    it('should throw NotFoundException if snapshots not found', async () => {
      jest.spyOn(prisma.menuEngineeringSnapshot, 'findUnique').mockResolvedValue(null);

      await expect(
        service.compareSnapshots('tenant-1', 'snapshot-1', 'snapshot-2'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if tenant does not match', async () => {
      const mockSnapshot1 = {
        id: 'snapshot-1',
        tenantId: 'tenant-1',
        items: [],
      };

      const mockSnapshot2 = {
        id: 'snapshot-2',
        tenantId: 'tenant-2',
        items: [],
      };

      const findUniqueSpy2 = jest.spyOn(prisma.menuEngineeringSnapshot, 'findUnique');
      findUniqueSpy2.mockResolvedValueOnce(mockSnapshot1 as any);
      findUniqueSpy2.mockResolvedValueOnce(mockSnapshot2 as any);

      await expect(
        service.compareSnapshots('tenant-1', 'snapshot-1', 'snapshot-2'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
