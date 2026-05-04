import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DemandForecastService } from '../demand-forecast.service';
import { PrismaService } from '@/prisma/prisma.service';
import { withPrismaFallback } from '@/common/test';

describe('DemandForecastService', () => {
  let service: DemandForecastService;
  let prismaService: PrismaService;

  const mockTenantId = 'tenant-123';
  const mockPropertyId = 'property-456';

  const mockPrismaService = withPrismaFallback({
    booking: {
      findMany: jest.fn(),
    },
    warehouseStock: {
      aggregate: jest.fn(),
    },
    roomType: {
      findMany: jest.fn(),
    },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemandForecastService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<DemandForecastService>(DemandForecastService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('forecastByDateRange', () => {
    it('should forecast inventory demand for a date range', async () => {
      const startDate = '2026-04-15';
      const endDate = '2026-04-22';

      const mockBookings = [
        {
          id: 'booking-1',
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
          scheduledCheckIn: new Date('2026-04-16'),
          status: 'CONFIRMED',
          room: {
            id: 'room-1',
            roomTypeId: 'roomtype-1',
            roomType: {
              id: 'roomtype-1',
              name: 'Deluxe Room',
              roomTypeAmenityTemplates: [
                {
                  id: 'template-1',
                  quantity: 2,
                  taskType: 'checkout',
                  amenity: {
                    id: 'amenity-1',
                    name: 'Pillow',
                    sku: 'SKU-PILLOW-001',
                    unit: 'pieces',
                  },
                },
              ],
            },
          },
        },
      ];

      mockPrismaService.booking.findMany.mockResolvedValue(mockBookings);
      mockPrismaService.warehouseStock.aggregate.mockResolvedValue({
        _sum: { quantity: 5 },
      });

      const result = await service.forecastByDateRange(
        mockTenantId,
        mockPropertyId,
        startDate,
        endDate,
      );

      expect(result).toEqual({
        propertyId: mockPropertyId,
        startDate,
        endDate,
        totalBookings: 1,
        items: [
          {
            itemId: 'amenity-1',
            itemName: 'Pillow',
            sku: 'SKU-PILLOW-001',
            totalRequired: 2,
            currentStock: 5,
            deficit: 0,
            unit: 'pieces',
            roomType: 'Deluxe Room',
            bookingCount: 1,
          },
        ],
        itemsWithDeficit: 0,
        generatedAt: expect.any(String),
      });

      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
          scheduledCheckIn: {
            gte: new Date(startDate),
            lt: new Date('2026-04-23'),
          },
          status: {
            in: ['CONFIRMED', 'CHECKED_IN'],
          },
        },
        include: {
          room: {
            include: {
              roomType: {
                include: {
                  roomTypeAmenityTemplates: {
                    where: {
                      taskType: 'checkout',
                    },
                    include: {
                      amenity: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    it('should calculate deficit when current stock is less than required', async () => {
      const startDate = '2026-04-15';
      const endDate = '2026-04-22';

      const mockBookings = [
        {
          id: 'booking-1',
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
          scheduledCheckIn: new Date('2026-04-16'),
          status: 'CONFIRMED',
          room: {
            id: 'room-1',
            roomTypeId: 'roomtype-1',
            roomType: {
              id: 'roomtype-1',
              name: 'Standard Room',
              roomTypeAmenityTemplates: [
                {
                  id: 'template-1',
                  quantity: 10,
                  taskType: 'checkout',
                  amenity: {
                    id: 'amenity-1',
                    name: 'Towel',
                    sku: 'SKU-TOWEL-001',
                    unit: 'pieces',
                  },
                },
              ],
            },
          },
        },
      ];

      mockPrismaService.booking.findMany.mockResolvedValue(mockBookings);
      mockPrismaService.warehouseStock.aggregate.mockResolvedValue({
        _sum: { quantity: 5 },
      });

      const result = await service.forecastByDateRange(
        mockTenantId,
        mockPropertyId,
        startDate,
        endDate,
      );

      expect(result.items[0].deficit).toBe(5);
      expect(result.itemsWithDeficit).toBe(1);
    });

    it('should throw BadRequestException when start date is after end date', async () => {
      const startDate = '2026-04-22';
      const endDate = '2026-04-15';

      await expect(
        service.forecastByDateRange(mockTenantId, mockPropertyId, startDate, endDate),
      ).rejects.toThrow(BadRequestException);
    });

    it('should aggregate demand from multiple bookings', async () => {
      const startDate = '2026-04-15';
      const endDate = '2026-04-22';

      const mockBookings = [
        {
          id: 'booking-1',
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
          scheduledCheckIn: new Date('2026-04-16'),
          status: 'CONFIRMED',
          room: {
            id: 'room-1',
            roomTypeId: 'roomtype-1',
            roomType: {
              id: 'roomtype-1',
              name: 'Deluxe Room',
              roomTypeAmenityTemplates: [
                {
                  id: 'template-1',
                  quantity: 2,
                  taskType: 'checkout',
                  amenity: {
                    id: 'amenity-1',
                    name: 'Pillow',
                    sku: 'SKU-PILLOW-001',
                    unit: 'pieces',
                  },
                },
              ],
            },
          },
        },
        {
          id: 'booking-2',
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
          scheduledCheckIn: new Date('2026-04-17'),
          status: 'CHECKED_IN',
          room: {
            id: 'room-2',
            roomTypeId: 'roomtype-1',
            roomType: {
              id: 'roomtype-1',
              name: 'Deluxe Room',
              roomTypeAmenityTemplates: [
                {
                  id: 'template-1',
                  quantity: 2,
                  taskType: 'checkout',
                  amenity: {
                    id: 'amenity-1',
                    name: 'Pillow',
                    sku: 'SKU-PILLOW-001',
                    unit: 'pieces',
                  },
                },
              ],
            },
          },
        },
      ];

      mockPrismaService.booking.findMany.mockResolvedValue(mockBookings);
      mockPrismaService.warehouseStock.aggregate.mockResolvedValue({
        _sum: { quantity: 2 },
      });

      const result = await service.forecastByDateRange(
        mockTenantId,
        mockPropertyId,
        startDate,
        endDate,
      );

      expect(result.totalBookings).toBe(2);
      expect(result.items[0].totalRequired).toBe(4);
      expect(result.items[0].bookingCount).toBe(2);
    });

    it('should handle bookings with no amenity templates', async () => {
      const startDate = '2026-04-15';
      const endDate = '2026-04-22';

      const mockBookings = [
        {
          id: 'booking-1',
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
          scheduledCheckIn: new Date('2026-04-16'),
          status: 'CONFIRMED',
          room: {
            id: 'room-1',
            roomTypeId: 'roomtype-1',
            roomType: {
              id: 'roomtype-1',
              name: 'Suite',
              roomTypeAmenityTemplates: [],
            },
          },
        },
      ];

      mockPrismaService.booking.findMany.mockResolvedValue(mockBookings);

      const result = await service.forecastByDateRange(
        mockTenantId,
        mockPropertyId,
        startDate,
        endDate,
      );

      expect(result.totalBookings).toBe(1);
      expect(result.items.length).toBe(0);
      expect(result.itemsWithDeficit).toBe(0);
    });
  });

  describe('forecastWeekly', () => {
    it('should forecast for the next 7 days', async () => {
      mockPrismaService.booking.findMany.mockResolvedValue([]);

      const result = await service.forecastWeekly(mockTenantId, mockPropertyId);

      expect(result.totalBookings).toBe(0);
      expect(result.items).toEqual([]);
      expect(mockPrismaService.booking.findMany).toHaveBeenCalled();

      const callArgs = mockPrismaService.booking.findMany.mock.calls[0][0];
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      expect(callArgs.where.scheduledCheckIn.gte.toDateString()).toBe(startDate.toDateString());
    });
  });

  describe('forecastMonthly', () => {
    it('should forecast for the next 30 days', async () => {
      mockPrismaService.booking.findMany.mockResolvedValue([]);

      const result = await service.forecastMonthly(mockTenantId, mockPropertyId);

      expect(result.totalBookings).toBe(0);
      expect(result.items).toEqual([]);
      expect(mockPrismaService.booking.findMany).toHaveBeenCalled();

      const callArgs = mockPrismaService.booking.findMany.mock.calls[0][0];
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);

      expect(callArgs.where.scheduledCheckIn.gte.toDateString()).toBe(startDate.toDateString());
    });
  });

  describe('getOccupancyForecast', () => {
    it('should calculate occupancy forecast for date range', async () => {
      const startDate = '2026-04-15';
      const endDate = '2026-04-22';

      const mockRoomTypes = [
        {
          id: 'roomtype-1',
          name: 'Deluxe Room',
          propertyId: mockPropertyId,
          rooms: [
            { id: 'room-1', roomTypeId: 'roomtype-1', propertyId: mockPropertyId },
            { id: 'room-2', roomTypeId: 'roomtype-1', propertyId: mockPropertyId },
          ],
        },
        {
          id: 'roomtype-2',
          name: 'Standard Room',
          propertyId: mockPropertyId,
          rooms: [{ id: 'room-3', roomTypeId: 'roomtype-2', propertyId: mockPropertyId }],
        },
      ];

      const mockBookings = [
        {
          id: 'booking-1',
          tenantId: mockTenantId,
          propertyId: mockPropertyId,
          scheduledCheckIn: new Date('2026-04-16'),
          status: 'CONFIRMED',
          room: {
            id: 'room-1',
            roomTypeId: 'roomtype-1',
            roomType: { id: 'roomtype-1', name: 'Deluxe Room' },
          },
        },
      ];

      mockPrismaService.roomType.findMany.mockResolvedValue(mockRoomTypes);
      mockPrismaService.booking.findMany.mockResolvedValue(mockBookings);

      const result = await service.getOccupancyForecast(
        mockTenantId,
        mockPropertyId,
        startDate,
        endDate,
      );

      expect(result.propertyId).toBe(mockPropertyId);
      expect(result.startDate).toBe(startDate);
      expect(result.endDate).toBe(endDate);
      expect(result.totalRooms).toBe(3);
      expect(result.bookedRooms).toBe(1);
      expect(result.occupancyPercentage).toBe(33);
      expect(result.totalBookings).toBe(1);
      expect(result.byRoomType.length).toBe(2);
    });

    it('should throw BadRequestException when start date is after end date', async () => {
      const startDate = '2026-04-22';
      const endDate = '2026-04-15';

      await expect(
        service.getOccupancyForecast(mockTenantId, mockPropertyId, startDate, endDate),
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle property with no bookings', async () => {
      const startDate = '2026-04-15';
      const endDate = '2026-04-22';

      const mockRoomTypes = [
        {
          id: 'roomtype-1',
          name: 'Deluxe Room',
          propertyId: mockPropertyId,
          rooms: [{ id: 'room-1', roomTypeId: 'roomtype-1', propertyId: mockPropertyId }],
        },
      ];

      mockPrismaService.roomType.findMany.mockResolvedValue(mockRoomTypes);
      mockPrismaService.booking.findMany.mockResolvedValue([]);

      const result = await service.getOccupancyForecast(
        mockTenantId,
        mockPropertyId,
        startDate,
        endDate,
      );

      expect(result.totalRooms).toBe(1);
      expect(result.bookedRooms).toBe(0);
      expect(result.occupancyPercentage).toBe(0);
      expect(result.byRoomType[0].occupancyPercentage).toBe(0);
    });

    it('should handle property with no room types', async () => {
      const startDate = '2026-04-15';
      const endDate = '2026-04-22';

      mockPrismaService.roomType.findMany.mockResolvedValue([]);
      mockPrismaService.booking.findMany.mockResolvedValue([]);

      const result = await service.getOccupancyForecast(
        mockTenantId,
        mockPropertyId,
        startDate,
        endDate,
      );

      expect(result.totalRooms).toBe(0);
      expect(result.bookedRooms).toBe(0);
      expect(result.occupancyPercentage).toBe(0);
      expect(result.byRoomType.length).toBe(0);
    });
  });
});
