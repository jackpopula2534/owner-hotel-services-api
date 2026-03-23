import { Test, TestingModule } from '@nestjs/testing';
import { MobileApiController } from '../../src/mobile-api/mobile-api.controller';
import { MobileApiService } from '../../src/mobile-api/mobile-api.service';

describe('Mobile API', () => {
  let controller: MobileApiController;
  let mobileApiService: MobileApiService;

  const mockMobileApiService = {
    getAppConfig: jest.fn(),
    getDashboard: jest.fn(),
    getBookings: jest.fn(),
    getRooms: jest.fn(),
    getGuests: jest.fn(),
    quickSearch: jest.fn(),
    updateRoomStatus: jest.fn(),
    updateBookingStatus: jest.fn(),
  };

  const mockUser = {
    id: 'user-123',
    tenantId: 'tenant-123',
    role: 'tenant_admin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MobileApiController],
      providers: [
        {
          provide: MobileApiService,
          useValue: mockMobileApiService,
        },
      ],
    }).compile();

    controller = module.get<MobileApiController>(MobileApiController);
    mobileApiService = module.get<MobileApiService>(MobileApiService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/v1/mobile/config', () => {
    it('should return app configuration', () => {
      const mockConfig = {
        minVersion: '0.9.0',
        latestVersion: '1.0.0',
        forceUpdate: false,
        maintenanceMode: false,
        features: {
          bookingEnabled: true,
          paymentEnabled: true,
          pushNotifications: true,
        },
      };

      mockMobileApiService.getAppConfig.mockReturnValue(mockConfig);

      const result = controller.getAppConfig();

      expect(mobileApiService.getAppConfig).toHaveBeenCalled();
      expect(result.latestVersion).toBe('1.0.0');
      expect(result.features.bookingEnabled).toBe(true);
    });
  });

  describe('GET /api/v1/mobile/dashboard', () => {
    it('should return dashboard data', async () => {
      const mockDashboard = {
        todayCheckIns: 5,
        todayCheckOuts: 3,
        occupancyRate: 70,
        totalRevenue: 25000,
        pendingBookings: 8,
        availableRooms: 12,
        recentBookings: [
          { id: 'b1', bookingNumber: 'BK001', guestName: 'John Doe', roomNumber: '101', checkIn: new Date(), checkOut: new Date(), status: 'confirmed', totalPrice: 5000 },
          { id: 'b2', bookingNumber: 'BK002', guestName: 'Jane Smith', roomNumber: '205', checkIn: new Date(), checkOut: new Date(), status: 'checked_in', totalPrice: 8000 },
        ],
      };

      mockMobileApiService.getDashboard.mockResolvedValue(mockDashboard);

      const result = await controller.getDashboard(mockUser);

      expect(mobileApiService.getDashboard).toHaveBeenCalledWith('tenant-123');
      expect(result.todayCheckIns).toBe(5);
      expect(result.occupancyRate).toBe(70);
    });
  });

  describe('GET /api/v1/mobile/bookings', () => {
    it('should return bookings list with pagination', async () => {
      const mockBookings = {
        data: [
          {
            id: 'b1',
            guestName: 'John Doe',
            roomNumber: '101',
            checkIn: '2024-01-15',
            checkOut: '2024-01-17',
            status: 'confirmed',
          },
          {
            id: 'b2',
            guestName: 'Jane Smith',
            roomNumber: '205',
            checkIn: '2024-01-15',
            checkOut: '2024-01-18',
            status: 'checked_in',
          },
        ],
        total: 50,
        page: 1,
        limit: 20,
      };

      mockMobileApiService.getBookings.mockResolvedValue(mockBookings);

      const result = await controller.getBookings(mockUser, 1, 20, undefined);

      expect(mobileApiService.getBookings).toHaveBeenCalledWith(
        'tenant-123',
        { page: 1, limit: 20 },
        undefined,
      );
      expect(result.data).toHaveLength(2);
    });

    it('should filter bookings by status', async () => {
      mockMobileApiService.getBookings.mockResolvedValue({
        data: [{ id: 'b1', status: 'checked_in' }],
        total: 1,
      });

      await controller.getBookings(mockUser, 1, 20, 'checked_in');

      expect(mobileApiService.getBookings).toHaveBeenCalledWith(
        'tenant-123',
        { page: 1, limit: 20 },
        'checked_in',
      );
    });

    it('should use default pagination values', async () => {
      mockMobileApiService.getBookings.mockResolvedValue({ data: [], total: 0 });

      await controller.getBookings(mockUser, undefined, undefined, undefined);

      expect(mobileApiService.getBookings).toHaveBeenCalledWith(
        'tenant-123',
        { page: 1, limit: 20 },
        undefined,
      );
    });
  });

  describe('GET /api/v1/mobile/rooms', () => {
    it('should return rooms list with pagination', async () => {
      const mockRooms = {
        data: [
          { id: 'r1', number: '101', type: 'Standard', status: 'available', floor: 1 },
          { id: 'r2', number: '102', type: 'Deluxe', status: 'occupied', floor: 1 },
        ],
        total: 50,
        page: 1,
        limit: 20,
      };

      mockMobileApiService.getRooms.mockResolvedValue(mockRooms);

      const result = await controller.getRooms(mockUser, 1, 20, undefined);

      expect(mobileApiService.getRooms).toHaveBeenCalledWith(
        'tenant-123',
        { page: 1, limit: 20 },
        undefined,
      );
      expect(result.data).toHaveLength(2);
    });

    it('should filter rooms by status', async () => {
      mockMobileApiService.getRooms.mockResolvedValue({
        data: [{ id: 'r1', status: 'available' }],
        total: 1,
      });

      await controller.getRooms(mockUser, 1, 20, 'available');

      expect(mobileApiService.getRooms).toHaveBeenCalledWith(
        'tenant-123',
        { page: 1, limit: 20 },
        'available',
      );
    });
  });

  describe('GET /api/v1/mobile/guests', () => {
    it('should return guests list with pagination', async () => {
      const mockGuests = {
        data: [
          { id: 'g1', name: 'John Doe', email: 'john@example.com', visits: 3 },
          { id: 'g2', name: 'Jane Smith', email: 'jane@example.com', visits: 1 },
        ],
        total: 100,
        page: 1,
        limit: 20,
      };

      mockMobileApiService.getGuests.mockResolvedValue(mockGuests);

      const result = await controller.getGuests(mockUser, 1, 20, undefined);

      expect(mobileApiService.getGuests).toHaveBeenCalledWith(
        'tenant-123',
        { page: 1, limit: 20 },
        undefined,
      );
      expect(result.data).toHaveLength(2);
    });

    it('should search guests by name', async () => {
      mockMobileApiService.getGuests.mockResolvedValue({
        data: [{ id: 'g1', name: 'John Doe' }],
        total: 1,
      });

      await controller.getGuests(mockUser, 1, 20, 'John');

      expect(mobileApiService.getGuests).toHaveBeenCalledWith(
        'tenant-123',
        { page: 1, limit: 20 },
        'John',
      );
    });
  });

  describe('GET /api/v1/mobile/search', () => {
    it('should perform quick search across entities', async () => {
      const mockResults = {
        bookings: [
          { id: 'b1', guestName: 'John', roomNumber: '101', status: 'confirmed' },
        ],
        rooms: [
          { id: 'r1', number: '101', status: 'occupied' },
        ],
        guests: [
          { id: 'g1', name: 'John Doe', email: 'john@example.com' },
        ],
      };

      mockMobileApiService.quickSearch.mockResolvedValue(mockResults);

      const result = await controller.quickSearch(mockUser, 'John');

      expect(mobileApiService.quickSearch).toHaveBeenCalledWith('tenant-123', 'John');
      expect(result.bookings).toHaveLength(1);
      expect(result.guests).toHaveLength(1);
    });

    it('should return empty results for no matches', async () => {
      mockMobileApiService.quickSearch.mockResolvedValue({
        bookings: [],
        rooms: [],
        guests: [],
      });

      const result = await controller.quickSearch(mockUser, 'xyz123');

      expect(result.bookings).toHaveLength(0);
      expect(result.rooms).toHaveLength(0);
      expect(result.guests).toHaveLength(0);
    });
  });

  describe('PATCH /api/v1/mobile/rooms/:id/status', () => {
    it('should update room status', async () => {
      const mockRoom = {
        id: 'r1',
        number: '101',
        status: 'maintenance',
        updatedAt: new Date().toISOString(),
      };

      mockMobileApiService.updateRoomStatus.mockResolvedValue(mockRoom);

      const result = await controller.updateRoomStatus(mockUser, 'r1', 'maintenance');

      expect(mobileApiService.updateRoomStatus).toHaveBeenCalledWith(
        'tenant-123',
        'r1',
        'maintenance',
      );
      expect(result.status).toBe('maintenance');
    });

    it('should update room to available', async () => {
      const mockRoom = { id: 'r1', number: '101', status: 'available' };

      mockMobileApiService.updateRoomStatus.mockResolvedValue(mockRoom);

      const result = await controller.updateRoomStatus(mockUser, 'r1', 'available');

      expect(result.status).toBe('available');
    });
  });

  describe('PATCH /api/v1/mobile/bookings/:id/status', () => {
    it('should update booking status', async () => {
      const mockBooking = {
        id: 'b1',
        guestName: 'John Doe',
        status: 'confirmed',
        updatedAt: new Date().toISOString(),
      };

      mockMobileApiService.updateBookingStatus.mockResolvedValue(mockBooking);

      const result = await controller.updateBookingStatus(mockUser, 'b1', 'confirmed');

      expect(mobileApiService.updateBookingStatus).toHaveBeenCalledWith(
        'tenant-123',
        'b1',
        'confirmed',
      );
      expect(result.status).toBe('confirmed');
    });
  });

  describe('POST /api/v1/mobile/bookings/:id/checkin', () => {
    it('should perform quick check-in', async () => {
      const mockBooking = {
        id: 'b1',
        guestName: 'John Doe',
        status: 'checked_in',
        checkedInAt: new Date().toISOString(),
      };

      mockMobileApiService.updateBookingStatus.mockResolvedValue(mockBooking);

      const result = await controller.checkIn(mockUser, 'b1');

      expect(mobileApiService.updateBookingStatus).toHaveBeenCalledWith(
        'tenant-123',
        'b1',
        'checked_in',
      );
      expect(result.status).toBe('checked_in');
    });
  });

  describe('POST /api/v1/mobile/bookings/:id/checkout', () => {
    it('should perform quick check-out', async () => {
      const mockBooking = {
        id: 'b1',
        guestName: 'John Doe',
        status: 'checked_out',
        checkedOutAt: new Date().toISOString(),
      };

      mockMobileApiService.updateBookingStatus.mockResolvedValue(mockBooking);

      const result = await controller.checkOut(mockUser, 'b1');

      expect(mobileApiService.updateBookingStatus).toHaveBeenCalledWith(
        'tenant-123',
        'b1',
        'checked_out',
      );
      expect(result.status).toBe('checked_out');
    });
  });
});
