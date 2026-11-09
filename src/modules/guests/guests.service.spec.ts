import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { GuestsService } from './guests.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { mockAuditLogService } from '../../common/test/mock-providers';

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
        { provide: AuditLogService, useValue: mockAuditLogService() },
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

    it('should accept specialNotes when updating', async () => {
      const updateDto = {
        firstName: 'Emma',
        specialNotes: 'Allergic to seafood. Prefers high floor.',
      };
      mockPrismaService.guest.findFirst.mockResolvedValue({ id: '1', tenantId: testTenantId });
      mockPrismaService.guest.update.mockResolvedValue({ id: '1', ...updateDto });

      await service.update('1', updateDto, testTenantId);

      expect(mockPrismaService.guest.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({
          firstName: 'Emma',
          specialNotes: 'Allergic to seafood. Prefers high floor.',
        }),
      });
    });

    it('should strip unknown fields before passing to Prisma (defense-in-depth)', async () => {
      // Simulate an internal caller bypassing the ValidationPipe and sending
      // a field that does not exist on the Guest table. The service must
      // sanitize this away to avoid PrismaClientValidationError.
      const updateDtoWithJunk = {
        firstName: 'Jane',
        specialNotes: 'OK note',
        bogusField: 'should-not-reach-prisma',
        anotherJunk: { nested: true },
      } as any;

      mockPrismaService.guest.findFirst.mockResolvedValue({ id: '1', tenantId: testTenantId });
      mockPrismaService.guest.update.mockResolvedValue({ id: '1', firstName: 'Jane' });

      await service.update('1', updateDtoWithJunk, testTenantId);

      const callArgs = mockPrismaService.guest.update.mock.calls[0][0];
      expect(callArgs.data).toEqual({
        firstName: 'Jane',
        specialNotes: 'OK note',
      });
      expect(callArgs.data).not.toHaveProperty('bogusField');
      expect(callArgs.data).not.toHaveProperty('anotherJunk');
    });

    it('should drop undefined fields without sending them to Prisma', async () => {
      const updateDto = {
        firstName: 'Jane',
        email: undefined,
        phone: undefined,
        specialNotes: 'note',
      } as any;

      mockPrismaService.guest.findFirst.mockResolvedValue({ id: '1', tenantId: testTenantId });
      mockPrismaService.guest.update.mockResolvedValue({ id: '1' });

      await service.update('1', updateDto, testTenantId);

      const sentData = mockPrismaService.guest.update.mock.calls[0][0].data;
      expect(sentData).not.toHaveProperty('email');
      expect(sentData).not.toHaveProperty('phone');
      expect(sentData).toHaveProperty('firstName', 'Jane');
      expect(sentData).toHaveProperty('specialNotes', 'note');
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
