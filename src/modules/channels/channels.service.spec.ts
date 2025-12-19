import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ChannelsService', () => {
  let service: ChannelsService;
  let prisma: jest.Mocked<PrismaService>;

  const createMockPrisma = (): jest.Mocked<PrismaService> =>
    ({
      channel: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      booking: {
        count: jest.fn(),
      },
    } as any);

  beforeEach(async () => {
    const mockPrisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ChannelsService>(ChannelsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated channels', async () => {
      (prisma.channel.findMany as jest.Mock).mockResolvedValue([{ id: '1' }]);
      (prisma.channel.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(prisma.channel.findMany).toHaveBeenCalled();
      expect(result).toEqual({
        data: [{ id: '1' }],
        total: 1,
        page: 1,
        limit: 10,
      });
    });
  });

  describe('findOne', () => {
    it('should return a channel when found', async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({
        id: '1',
      });

      const result = await service.findOne('1');

      expect(result).toEqual({ id: '1' });
    });

    it('should throw NotFoundException when channel not found', async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a new channel when code is unique', async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.channel.create as jest.Mock).mockResolvedValue({ id: '1' });

      const dto = { name: 'Booking', code: 'BK', type: 'ota' } as any;
      const result = await service.create(dto);

      expect(prisma.channel.create).toHaveBeenCalledWith({ data: dto });
      expect(result).toEqual({ id: '1' });
    });

    it('should throw BadRequestException if code already exists', async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({
        id: '1',
        code: 'BK',
      });

      await expect(
        service.create({ name: 'Booking', code: 'BK', type: 'ota' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should update channel successfully', async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValueOnce({
        id: '1',
      });
      (prisma.channel.update as jest.Mock).mockResolvedValue({
        id: '1',
        name: 'Updated',
      });

      const result = await service.update('1', { name: 'Updated' } as any);

      expect(prisma.channel.update).toHaveBeenCalled();
      expect(result).toEqual({ id: '1', name: 'Updated' });
    });

    it('should prevent duplicate code on update', async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValueOnce({
        id: '1',
      });
      (prisma.channel.findUnique as jest.Mock).mockResolvedValueOnce({
        id: '2',
        code: 'BK',
      });

      await expect(
        service.update('1', { code: 'BK' } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should delete channel when no bookings', async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ id: '1' });
      (prisma.booking.count as jest.Mock).mockResolvedValue(0);
      (prisma.channel.delete as jest.Mock).mockResolvedValue({ id: '1' });

      const result = await service.remove('1');

      expect(prisma.channel.delete).toHaveBeenCalledWith({ where: { id: '1' } });
      expect(result).toEqual({ id: '1' });
    });

    it('should throw BadRequestException when channel has bookings', async () => {
      (prisma.channel.findUnique as jest.Mock).mockResolvedValue({ id: '1' });
      (prisma.booking.count as jest.Mock).mockResolvedValue(2);

      await expect(service.remove('1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('sync', () => {
    it('should update lastSyncAt when syncEnabled', async () => {
      const channel = { id: '1', syncEnabled: true };
      jest.spyOn(service, 'findOne').mockResolvedValue(channel as any);
      (prisma.channel.update as jest.Mock).mockResolvedValue({
        ...channel,
        lastSyncAt: new Date(),
      });

      const result = await service.sync('1');

      expect(result).toHaveProperty('message', 'Channel sync initiated');
      expect(result).toHaveProperty('channel');
    });

    it('should throw BadRequestException when sync not enabled', async () => {
      const channel = { id: '1', syncEnabled: false };
      jest.spyOn(service, 'findOne').mockResolvedValue(channel as any);

      await expect(service.sync('1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('toggleActive', () => {
    it('should toggle isActive', async () => {
      const channel = { id: '1', isActive: true };
      jest.spyOn(service, 'findOne').mockResolvedValue(channel as any);
      (prisma.channel.update as jest.Mock).mockResolvedValue({
        ...channel,
        isActive: false,
      });

      const result = await service.toggleActive('1');

      expect(result).toHaveProperty('isActive', false);
    });
  });
});




