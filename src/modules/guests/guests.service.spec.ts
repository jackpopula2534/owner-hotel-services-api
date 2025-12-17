import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GuestsService } from './guests.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('GuestsService', () => {
  let service: GuestsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    guest: {
      findMany: jest.fn(),
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

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('limit');
      expect(result.data).toEqual(mockGuests);
    });

    it('should handle search query', async () => {
      const mockGuests = [{ id: '1', firstName: 'John', lastName: 'Doe' }];

      mockPrismaService.guest.findMany.mockResolvedValue(mockGuests);
      mockPrismaService.guest.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10, search: 'John' });

      expect(mockPrismaService.guest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      );
      expect(result.data).toEqual(mockGuests);
    });
  });

  describe('findOne', () => {
    it('should return a guest by id', async () => {
      const mockGuest = {
        id: '1',
        firstName: 'John',
        lastName: 'Doe',
        bookings: [],
      };

      mockPrismaService.guest.findUnique.mockResolvedValue(mockGuest);

      const result = await service.findOne('1');

      expect(result).toEqual(mockGuest);
      expect(mockPrismaService.guest.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        include: { bookings: true },
      });
    });

    it('should throw NotFoundException if guest not found', async () => {
      mockPrismaService.guest.findUnique.mockResolvedValue(null);

      await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a new guest', async () => {
      const createGuestDto = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      };

      const mockGuest = {
        id: '1',
        ...createGuestDto,
        createdAt: new Date(),
      };

      mockPrismaService.guest.create.mockResolvedValue(mockGuest);

      const result = await service.create(createGuestDto);

      expect(result).toEqual(mockGuest);
      expect(mockPrismaService.guest.create).toHaveBeenCalledWith({
        data: createGuestDto,
      });
    });
  });

  describe('update', () => {
    it('should update a guest', async () => {
      const updateDto = { firstName: 'Jane' };
      const mockGuest = {
        id: '1',
        firstName: 'Jane',
        lastName: 'Doe',
      };

      mockPrismaService.guest.findUnique.mockResolvedValue({ id: '1' });
      mockPrismaService.guest.update.mockResolvedValue(mockGuest);

      const result = await service.update('1', updateDto);

      expect(result).toEqual(mockGuest);
      expect(mockPrismaService.guest.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: updateDto,
      });
    });
  });

  describe('remove', () => {
    it('should delete a guest', async () => {
      mockPrismaService.guest.findUnique.mockResolvedValue({ id: '1' });
      mockPrismaService.guest.delete.mockResolvedValue({ id: '1' });

      const result = await service.remove('1');

      expect(result).toEqual({ id: '1' });
      expect(mockPrismaService.guest.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      });
    });
  });
});

