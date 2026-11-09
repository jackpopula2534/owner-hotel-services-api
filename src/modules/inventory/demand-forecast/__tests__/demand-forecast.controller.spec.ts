import { Test, TestingModule } from '@nestjs/testing';
import { DemandForecastController } from '../demand-forecast.controller';
import { DemandForecastService } from '../demand-forecast.service';
import { DemandForecastResponseDto, OccupancyForecastResponseDto } from '../dto';
import { AddonGuard } from '@/common/guards/addon.guard';

describe('DemandForecastController', () => {
  let controller: DemandForecastController;
  let service: DemandForecastService;

  const mockTenantId = 'tenant-123';
  const mockPropertyId = 'property-456';

  const mockForecastResponse: DemandForecastResponseDto = {
    propertyId: mockPropertyId,
    startDate: '2026-04-15',
    endDate: '2026-04-22',
    totalBookings: 5,
    items: [
      {
        itemId: 'item-1',
        itemName: 'Pillow',
        sku: 'SKU-PILLOW-001',
        totalRequired: 10,
        currentStock: 8,
        deficit: 2,
        unit: 'pieces',
        roomType: 'Deluxe Room',
        bookingCount: 5,
      },
    ],
    itemsWithDeficit: 1,
    generatedAt: new Date().toISOString(),
  };

  const mockOccupancyResponse: OccupancyForecastResponseDto = {
    propertyId: mockPropertyId,
    startDate: '2026-04-15',
    endDate: '2026-04-22',
    totalRooms: 50,
    bookedRooms: 42,
    occupancyPercentage: 84,
    totalBookings: 45,
    byRoomType: [
      {
        roomType: 'Deluxe Room',
        totalRooms: 20,
        bookedRooms: 18,
        occupancyPercentage: 90,
      },
      {
        roomType: 'Standard Room',
        totalRooms: 30,
        bookedRooms: 24,
        occupancyPercentage: 80,
      },
    ],
    generatedAt: new Date().toISOString(),
  };

  const mockDemandForecastService = {
    forecastWeekly: jest.fn(),
    forecastMonthly: jest.fn(),
    forecastByDateRange: jest.fn(),
    getOccupancyForecast: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DemandForecastController],
      providers: [
        {
          provide: DemandForecastService,
          useValue: mockDemandForecastService,
        },
      ],
    })
      .overrideGuard(AddonGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DemandForecastController>(DemandForecastController);
    service = module.get<DemandForecastService>(DemandForecastService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getWeeklyForecast', () => {
    it('should return weekly forecast', async () => {
      mockDemandForecastService.forecastWeekly.mockResolvedValue(mockForecastResponse);

      const mockReq = {
        user: { tenantId: mockTenantId },
      } as any;

      const result = await controller.getWeeklyForecast({ propertyId: mockPropertyId }, mockReq);

      expect(result).toEqual(mockForecastResponse);
      expect(mockDemandForecastService.forecastWeekly).toHaveBeenCalledWith(
        mockTenantId,
        mockPropertyId,
      );
    });
  });

  describe('getMonthlyForecast', () => {
    it('should return monthly forecast', async () => {
      mockDemandForecastService.forecastMonthly.mockResolvedValue(mockForecastResponse);

      const mockReq = {
        user: { tenantId: mockTenantId },
      } as any;

      const result = await controller.getMonthlyForecast({ propertyId: mockPropertyId }, mockReq);

      expect(result).toEqual(mockForecastResponse);
      expect(mockDemandForecastService.forecastMonthly).toHaveBeenCalledWith(
        mockTenantId,
        mockPropertyId,
      );
    });
  });

  describe('getCustomForecast', () => {
    it('should return custom date range forecast', async () => {
      mockDemandForecastService.forecastByDateRange.mockResolvedValue(mockForecastResponse);

      const mockReq = {
        user: { tenantId: mockTenantId },
      } as any;

      const result = await controller.getCustomForecast(
        {
          propertyId: mockPropertyId,
          startDate: '2026-04-15',
          endDate: '2026-04-22',
        },
        mockReq,
      );

      expect(result).toEqual(mockForecastResponse);
      expect(mockDemandForecastService.forecastByDateRange).toHaveBeenCalledWith(
        mockTenantId,
        mockPropertyId,
        '2026-04-15',
        '2026-04-22',
      );
    });

    it('should use current date as default start date', async () => {
      mockDemandForecastService.forecastByDateRange.mockResolvedValue(mockForecastResponse);

      const mockReq = {
        user: { tenantId: mockTenantId },
      } as any;

      const today = new Date().toISOString().split('T')[0];

      await controller.getCustomForecast(
        {
          propertyId: mockPropertyId,
          startDate: undefined,
          endDate: '2026-04-22',
        },
        mockReq,
      );

      const callArgs = mockDemandForecastService.forecastByDateRange.mock.calls[0];
      expect(callArgs[2]).toBe(today);
    });
  });

  describe('getOccupancyForecast', () => {
    it('should return occupancy forecast', async () => {
      mockDemandForecastService.getOccupancyForecast.mockResolvedValue(mockOccupancyResponse);

      const mockReq = {
        user: { tenantId: mockTenantId },
      } as any;

      const result = await controller.getOccupancyForecast(
        {
          propertyId: mockPropertyId,
          startDate: '2026-04-15',
          endDate: '2026-04-22',
        },
        mockReq,
      );

      expect(result).toEqual(mockOccupancyResponse);
      expect(mockDemandForecastService.getOccupancyForecast).toHaveBeenCalledWith(
        mockTenantId,
        mockPropertyId,
        '2026-04-15',
        '2026-04-22',
      );
    });

    it('should include room type occupancy details', async () => {
      mockDemandForecastService.getOccupancyForecast.mockResolvedValue(mockOccupancyResponse);

      const mockReq = {
        user: { tenantId: mockTenantId },
      } as any;

      const result = await controller.getOccupancyForecast(
        {
          propertyId: mockPropertyId,
          startDate: '2026-04-15',
          endDate: '2026-04-22',
        },
        mockReq,
      );

      expect(result.byRoomType.length).toBe(2);
      expect(result.byRoomType[0].roomType).toBe('Deluxe Room');
      expect(result.byRoomType[0].occupancyPercentage).toBe(90);
    });
  });
});
