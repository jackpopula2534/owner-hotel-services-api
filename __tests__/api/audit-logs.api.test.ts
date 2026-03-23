import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { AuditLogController } from '../../src/audit-log/audit-log.controller';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/dto/audit-log.dto';

describe('Audit Logs API', () => {
  let controller: AuditLogController;
  let auditLogService: AuditLogService;

  const mockAuditLogService = {
    getLogs: jest.fn(),
    getLogById: jest.fn(),
    exportLogs: jest.fn(),
  };

  const mockUser = {
    sub: 'user-123',
    tenantId: 'tenant-123',
    role: 'tenant_admin',
  };

  const mockPlatformAdmin = {
    sub: 'admin-123',
    tenantId: null,
    role: 'platform_admin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogController],
      providers: [
        {
          provide: AuditLogService,
          useValue: mockAuditLogService,
        },
      ],
    }).compile();

    controller = module.get<AuditLogController>(AuditLogController);
    auditLogService = module.get<AuditLogService>(AuditLogService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /api/v1/audit-logs', () => {
    it('should get audit logs with pagination', async () => {
      const query = {
        page: 1,
        limit: 10,
      };

      const mockLogs = {
        data: [
          {
            id: 'log-1',
            action: 'USER_LOGIN',
            userId: 'user-123',
            timestamp: new Date().toISOString(),
            ipAddress: '192.168.1.1',
          },
          {
            id: 'log-2',
            action: 'BOOKING_CREATED',
            userId: 'user-123',
            timestamp: new Date().toISOString(),
            details: { bookingId: 'booking-456' },
          },
        ],
        pagination: { total: 100, page: 1, limit: 10, totalPages: 10 },
      };

      mockAuditLogService.getLogs.mockResolvedValue(mockLogs);

      const result = await controller.getLogs(query, { user: mockUser });

      expect(auditLogService.getLogs).toHaveBeenCalledWith(query, mockUser.tenantId);
      expect(result.data.length).toBe(2);
      expect(result.pagination.total).toBe(100);
    });

    it('should filter by action type', async () => {
      const query = {
        page: 1,
        limit: 10,
        action: AuditAction.LOGIN,
      };

      mockAuditLogService.getLogs.mockResolvedValue({
        data: [{ id: 'log-1', action: 'USER_LOGIN' }],
        total: 1,
      });

      await controller.getLogs(query, { user: mockUser });

      expect(auditLogService.getLogs).toHaveBeenCalledWith(query, mockUser.tenantId);
    });

    it('should filter by user ID', async () => {
      const query = {
        page: 1,
        limit: 10,
        userId: 'specific-user-id',
      };

      mockAuditLogService.getLogs.mockResolvedValue({ data: [], total: 0 });

      await controller.getLogs(query, { user: mockUser });

      expect(auditLogService.getLogs).toHaveBeenCalledWith(query, mockUser.tenantId);
    });

    it('should filter by date range', async () => {
      const query = {
        page: 1,
        limit: 20,
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      mockAuditLogService.getLogs.mockResolvedValue({ data: [], total: 0 });

      await controller.getLogs(query, { user: mockUser });

      expect(auditLogService.getLogs).toHaveBeenCalledWith(query, mockUser.tenantId);
    });

    it('should allow platform_admin to see all logs', async () => {
      const query = { page: 1, limit: 10 };

      mockAuditLogService.getLogs.mockResolvedValue({ data: [], total: 0 });

      await controller.getLogs(query, { user: mockPlatformAdmin });

      expect(auditLogService.getLogs).toHaveBeenCalledWith(query, undefined);
    });

    it('should restrict tenant_admin to their own tenant', async () => {
      const query = { page: 1, limit: 10 };

      mockAuditLogService.getLogs.mockResolvedValue({ data: [], total: 0 });

      await controller.getLogs(query, { user: mockUser });

      expect(auditLogService.getLogs).toHaveBeenCalledWith(query, 'tenant-123');
    });
  });

  describe('GET /api/v1/audit-logs/export', () => {
    it('should export audit logs to CSV', async () => {
      const query = {
        page: 1,
        limit: 1000,
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      const mockCSV = 'id,action,userId,timestamp,ipAddress\nlog-1,USER_LOGIN,user-123,2024-01-15T10:00:00Z,192.168.1.1';

      mockAuditLogService.exportLogs.mockResolvedValue(mockCSV);

      const mockResponse = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.exportLogs(query, { user: mockUser }, mockResponse);

      expect(auditLogService.exportLogs).toHaveBeenCalledWith(query, mockUser.tenantId);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('attachment; filename="audit-logs-'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(mockCSV);
    });

    it('should include all required columns in export', async () => {
      const query = { page: 1, limit: 500 };

      const mockCSV = `id,action,userId,userEmail,tenantId,timestamp,ipAddress,userAgent,details
log-1,USER_LOGIN,user-123,test@example.com,tenant-123,2024-01-15T10:00:00Z,192.168.1.1,Mozilla/5.0,{}`;

      mockAuditLogService.exportLogs.mockResolvedValue(mockCSV);

      const mockResponse = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.exportLogs(query, { user: mockUser }, mockResponse);

      expect(mockResponse.send).toHaveBeenCalledWith(expect.stringContaining('id,action,userId'));
    });

    it('should handle export with filters', async () => {
      const query = {
        page: 1,
        limit: 1000,
        action: AuditAction.BOOKING_CREATE,
      };

      mockAuditLogService.exportLogs.mockResolvedValue('id,action\nlog-1,BOOKING_CREATED');

      const mockResponse = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.exportLogs(query, { user: mockUser }, mockResponse);

      expect(auditLogService.exportLogs).toHaveBeenCalledWith(query, mockUser.tenantId);
    });
  });

  describe('GET /api/v1/audit-logs/:id', () => {
    it('should get audit log by ID', async () => {
      const logId = 'log-123';

      const mockLog = {
        id: logId,
        action: 'USER_LOGIN',
        userId: 'user-123',
        userEmail: 'test@example.com',
        tenantId: 'tenant-123',
        timestamp: '2024-01-15T10:00:00Z',
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        details: {
          browser: 'Chrome',
          os: 'macOS',
        },
      };

      mockAuditLogService.getLogById.mockResolvedValue(mockLog);

      const result = await controller.getLogById(logId, { user: mockUser });

      expect(auditLogService.getLogById).toHaveBeenCalledWith(logId, mockUser.tenantId);
      expect(result).toEqual(mockLog);
    });

    it('should handle non-existent log', async () => {
      const logId = 'non-existent';

      mockAuditLogService.getLogById.mockRejectedValue(
        new Error('Audit log not found'),
      );

      await expect(controller.getLogById(logId, { user: mockUser })).rejects.toThrow(
        'Audit log not found',
      );
    });

    it('should prevent accessing logs from different tenant', async () => {
      const logId = 'log-from-other-tenant';

      mockAuditLogService.getLogById.mockRejectedValue(
        new Error('Access denied'),
      );

      await expect(controller.getLogById(logId, { user: mockUser })).rejects.toThrow(
        'Access denied',
      );
    });

    it('should allow platform_admin to access any log', async () => {
      const logId = 'any-log-id';

      const mockLog = {
        id: logId,
        action: 'USER_LOGIN',
        tenantId: 'other-tenant',
      };

      mockAuditLogService.getLogById.mockResolvedValue(mockLog);

      const result = await controller.getLogById(logId, { user: mockPlatformAdmin });

      expect(auditLogService.getLogById).toHaveBeenCalledWith(logId, undefined);
      expect(result.tenantId).toBe('other-tenant');
    });
  });
});
