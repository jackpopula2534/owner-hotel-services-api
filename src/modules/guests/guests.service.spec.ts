import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { GuestsService } from './guests.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('GuestsService', () => {
  let service: GuestsService;
  let prismaService: PrismaService;

  const testTenantId = 'tenant-1';

  const mockPrismaService = {
    guest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<GuestsService>(GuestsService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated guests', async () => {
      const mockGuests = [
        { id: '1', firstName: 'John', lastName: 'Doe' },
        { id: '2', firstName: 'Jane', lastName: 'Smith' },
      ];

      mockPrismaService.guest.findMany.mockResolvedValue(mockGuests);
      mockPrismaService.guest.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 10 }, testTenantId);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('limit');
      expect(result.data).toEqual(mockGuests);
      expect(mockPrismaService.guest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: testTenantId,
          }),
        }),
      );
    });

    it('should handle search query', async () => {
      const mockGuests = [{ id: '1', firstName: 'John', lastName: 'Doe' }];

      mockPrismaService.guest.findMany.mockResolvedValue(mockGuests);
      mockPrismaService.guest.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10, search: 'John' }, testTenantId);

      expect(mockPrismaService.guest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: testTenantId,
            OR: expect.any(Array),
          }),
        }),
      );
      expect(result.data).toEqual(mockGuests);
    });

    it('should return empty data when tenantId is not provided', async () => {
      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual([]);
      expect(result.total).toEqual(0);
      expect(mockPrismaService.guest.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should throw BadRequestException when tenantId is not provided', async () => {
      await expect(service.findOne('1')).rejects.toThrow(BadRequestException);
    });

    it('should return a guest by id', async () => {
      const mockGuest = {
        id: '1',
        firstName: 'John',
        lastName: 'Doe',
        bookings: [],
      };

      mockPrismaService.guest.findFirst.mockResolvedValue(mockGuest);

      const result = await service.findOne('1', testTenantId);

      expect(result).toEqual(mockGuest);
      expect(mockPrismaService.guest.findFirst).toHaveBeenCalledWith({
        where: { id: '1', tenantId: testTenantId },
        include: { bookings: true },
      });
    });

    it('should throw NotFoundException if guest not found', async () => {
      mockPrismaService.guest.findFirst.mockResolvedValue(null);

      await expect(service.findOne('1', testTenantId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should throw BadRequestException when tenantId is not provided', async () => {
      const createGuestDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      };

      await expect(service.create(createGuestDto)).rejects.toThrow(BadRequestException);
    });

    it('should create a new guest', async () => {
      const createGuestDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      };

      const mockGuest = {
        id: '1',
        ...createGuestDto,
        tenantId: testTenantId,
        createdAt: new Date(),
      };

      mockPrismaService.guest.create.mockResolvedValue(mockGuest);

      const result = await service.create(createGuestDto, testTenantId);

      expect(result).toEqual(mockGuest);
      expect(mockPrismaService.guest.create).toHaveBeenCalledWith({
        data: {
          ...createGuestDto,
          tenantId: testTenantId,
        },
      });
    });
  });

  describe('update', () => {
    it('should throw BadRequestException when tenantId is not provided', async () => {
      const updateDto = { firstName: 'Jane' };

      await expect(service.update('1', updateDto)).rejects.toThrow(BadRequestException);
    });

    it('should update a guest', async () => {
      const updateDto = { firstName: 'Jane' };
      const mockGuest = {
        id: '1',
        firstName: 'Jane',
        lastName: 'Doe',
        tenantId: testTenantId,
      };

      mockPrismaService.guest.findFirst.mockResolvedValue({ id: '1', tenantId: testTenantId });
      mockPrismaService.guest.update.mockResolvedValue(mockGuest);

      const result = await service.update('1', updateDto, testTenantId);

      expect(result).toEqual(mockGuest);
      expect(mockPrismaService.guest.findFirst).toHaveBeenCalledWith({
        where: { id: '1', tenantId: testTenantId },
        include: { bookings: true },
      });
      expect(mockPrismaService.guest.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: updateDto,
      });
    });
  });

  describe('remove', () => {
    it('should throw BadRequestException when tenantId is not provided', async () => {
      await expect(service.remove('1')).rejects.toThrow(BadRequestException);
    });

    it('should delete a guest', async () => {
      const mockGuest = { id: '1', tenantId: testTenantId };

      mockPrismaService.guest.findFirst.mockResolvedValue(mockGuest);
      mockPrismaService.guest.delete.mockResolvedValue(mockGuest);

      const result = await service.remove('1', testTenantId);

      expect(result).toEqual(mockGuest);
      expect(mockPrismaService.guest.findFirst).toHaveBeenCalledWith({
        where: { id: '1', tenantId: testTenantId },
        include: { bookings: true },
      });
      expect(mockPrismaService.guest.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });
  });
});
