import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { DemandForecastModule } from '../demand-forecast.module';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';

describe('DemandForecast Integration Tests', () => {
  let app: INestApplication;
  let prismaService: PrismaService;

  const mockTenantId = 'tenant-123';
  const mockPropertyId = 'property-456';
  const mockUserId = 'user-789';

  const mockPrismaService = {
    booking: {
      findMany: jest.fn(),
    },
    warehouseStock: {
      aggregate: jest.fn(),
    },
    roomType: {
      findMany: jest.fn(),
    },
  };

  // Mock guards
  class MockJwtAuthGuard {
    canActivate(context) {
      const request = context.switchToHttp().getRequest();
      request.user = {
        id: mockUserId,
        tenantId: mockTenantId,
        email: 'test@example.com',
      };
      return true;
    }
  }

  class MockAddonGuard {
    canActivate() {
      return true;
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DemandForecastModule],
      providers: [
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(AddonGuard)
      .useClass(MockAddonGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prismaService = moduleFixture.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /inventory/demand-forecast/weekly', () => {
    it('should return 200 with weekly forecast data', async () => {
      mockPrismaService.booking.findMany.mockResolvedValue([
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
      ]);

      mockPrismaService.warehouseStock.aggregate.mockResolvedValue({
        _sum: { quantity: 5 },
      });

      const response = await request(app.getHttpServer())
        .get('/inventory/demand-forecast/weekly')
        .query({ propertyId: mockPropertyId })
        .expect(200);

      expect(response.body).toHaveProperty('propertyId', mockPropertyId);
      expect(response.body).toHaveProperty('startDate');
      expect(response.body).toHaveProperty('endDate');
      expect(response.body).toHaveProperty('totalBookings', 1);
      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('should return 400 when propertyId is missing', async () => {
      await request(app.getHttpServer()).get('/inventory/demand-forecast/weekly').expect(400);
    });

    it('should return 400 when propertyId is invalid UUID', async () => {
      await request(app.getHttpServer())
        .get('/inventory/demand-forecast/weekly')
        .query({ propertyId: 'invalid-uuid' })
        .expect(400);
    });
  });

  describe('GET /inventory/demand-forecast/monthly', () => {
    it('should return 200 with monthly forecast data', async () => {
      mockPrismaService.booking.findMany.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/inventory/demand-forecast/monthly')
        .query({ propertyId: mockPropertyId })
        .expect(200);

      expect(response.body).toHaveProperty('propertyId', mockPropertyId);
      expect(response.body).toHaveProperty('totalBookings', 0);
      expect(response.body.items).toEqual([]);
    });
  });

  describe('GET /inventory/demand-forecast/custom', () => {
    it('should return 200 with custom date range forecast', async () => {
      mockPrismaService.booking.findMany.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/inventory/demand-forecast/custom')
        .query({
          propertyId: mockPropertyId,
          startDate: '2026-04-15',
          endDate: '2026-04-22',
        })
        .expect(200);

      expect(response.body).toHaveProperty('propertyId', mockPropertyId);
      expect(response.body.startDate).toBe('2026-04-15');
      expect(response.body.endDate).toBe('2026-04-22');
    });

    it('should return 400 when startDate is after endDate', async () => {
      await request(app.getHttpServer())
        .get('/inventory/demand-forecast/custom')
        .query({
          propertyId: mockPropertyId,
          startDate: '2026-04-22',
          endDate: '2026-04-15',
        })
        .expect(400);
    });

    it('should use current date when startDate is not provided', async () => {
      mockPrismaService.booking.findMany.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/inventory/demand-forecast/custom')
        .query({
          propertyId: mockPropertyId,
          endDate: '2026-05-15',
        })
        .expect(200);

      expect(response.body).toHaveProperty('startDate');
      expect(response.body).toHaveProperty('endDate', '2026-05-15');
    });

    it('should validate ISO 8601 date format', async () => {
      await request(app.getHttpServer())
        .get('/inventory/demand-forecast/custom')
        .query({
          propertyId: mockPropertyId,
          startDate: 'invalid-date',
          endDate: '2026-04-22',
        })
        .expect(400);
    });
  });

  describe('GET /inventory/demand-forecast/occupancy', () => {
    it('should return 200 with occupancy forecast data', async () => {
      mockPrismaService.roomType.findMany.mockResolvedValue([
        {
          id: 'roomtype-1',
          name: 'Deluxe Room',
          propertyId: mockPropertyId,
          rooms: [
            { id: 'room-1', roomTypeId: 'roomtype-1', propertyId: mockPropertyId },
            { id: 'room-2', roomTypeId: 'roomtype-1', propertyId: mockPropertyId },
          ],
        },
      ]);

      mockPrismaService.booking.findMany.mockResolvedValue([
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
      ]);

      const response = await request(app.getHttpServer())
        .get('/inventory/demand-forecast/occupancy')
        .query({
          propertyId: mockPropertyId,
          startDate: '2026-04-15',
          endDate: '2026-04-22',
        })
        .expect(200);

      expect(response.body).toHaveProperty('propertyId', mockPropertyId);
      expect(response.body).toHaveProperty('totalRooms', 2);
      expect(response.body).toHaveProperty('bookedRooms');
      expect(response.body).toHaveProperty('occupancyPercentage');
      expect(response.body).toHaveProperty('totalBookings', 1);
      expect(Array.isArray(response.body.byRoomType)).toBe(true);
    });

    it('should return 400 when startDate is after endDate', async () => {
      await request(app.getHttpServer())
        .get('/inventory/demand-forecast/occupancy')
        .query({
          propertyId: mockPropertyId,
          startDate: '2026-04-22',
          endDate: '2026-04-15',
        })
        .expect(400);
    });

    it('should return 400 when required parameters are missing', async () => {
      await request(app.getHttpServer())
        .get('/inventory/demand-forecast/occupancy')
        .query({
          propertyId: mockPropertyId,
          startDate: '2026-04-15',
        })
        .expect(400);
    });

    it('should handle occupancy with zero bookings', async () => {
      mockPrismaService.roomType.findMany.mockResolvedValue([
        {
          id: 'roomtype-1',
          name: 'Standard Room',
          propertyId: mockPropertyId,
          rooms: [{ id: 'room-1', roomTypeId: 'roomtype-1', propertyId: mockPropertyId }],
        },
      ]);

      mockPrismaService.booking.findMany.mockResolvedValue([]);

      const response = await request(app.getHttpServer())
        .get('/inventory/demand-forecast/occupancy')
        .query({
          propertyId: mockPropertyId,
          startDate: '2026-04-15',
          endDate: '2026-04-22',
        })
        .expect(200);

      expect(response.body.occupancyPercentage).toBe(0);
      expect(response.body.bookedRooms).toBe(0);
    });
  });

  describe('Demand Item Sorting and Filtering', () => {
    it('should sort items by deficit in descending order', async () => {
      mockPrismaService.booking.findMany.mockResolvedValue([
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
                  quantity: 100,
                  taskType: 'checkout',
                  amenity: {
                    id: 'amenity-1',
                    name: 'Item A',
                    sku: 'SKU-A',
                    unit: 'pieces',
                  },
                },
                {
                  id: 'template-2',
                  quantity: 50,
                  taskType: 'checkout',
                  amenity: {
                    id: 'amenity-2',
                    name: 'Item B',
                    sku: 'SKU-B',
                    unit: 'pieces',
                  },
                },
              ],
            },
          },
        },
      ]);

      mockPrismaService.warehouseStock.aggregate
        .mockResolvedValueOnce({ _sum: { quantity: 50 } })
        .mockResolvedValueOnce({ _sum: { quantity: 60 } });

      const response = await request(app.getHttpServer())
        .get('/inventory/demand-forecast/custom')
        .query({
          propertyId: mockPropertyId,
          startDate: '2026-04-15',
          endDate: '2026-04-22',
        })
        .expect(200);

      expect(response.body.items.length).toBe(2);
      expect(response.body.items[0].deficit).toBeGreaterThanOrEqual(response.body.items[1].deficit);
    });
  });
});
