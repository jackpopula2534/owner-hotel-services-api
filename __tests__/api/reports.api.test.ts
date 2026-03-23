import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { ReportsController } from '../../src/modules/reports/reports.controller';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { ExportFormat } from '../../src/modules/reports/dto/export.dto';

describe('Reports API', () => {
  let controller: ReportsController;
  let reportsService: ReportsService;

  const mockReportsService = {
    exportData: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: ReportsService,
          useValue: mockReportsService,
        },
      ],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
    reportsService = module.get<ReportsService>(ReportsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /api/v1/reports/export', () => {
    it('should export data to Excel format', async () => {
      const dto = {
        format: ExportFormat.EXCEL,
        data: [{ guestName: 'John', roomNumber: '101', checkIn: '2024-01-15', checkOut: '2024-01-17', status: 'confirmed' }],
        columns: [
          { key: 'guestName', label: 'Guest Name' },
          { key: 'roomNumber', label: 'Room Number' },
          { key: 'checkIn', label: 'Check In' },
          { key: 'checkOut', label: 'Check Out' },
          { key: 'status', label: 'Status' },
        ],
      };

      const mockResult = {
        success: true,
        filename: 'bookings-2024-01-01-2024-01-31.xlsx',
        data: 'base64-encoded-excel-data',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };

      mockReportsService.exportData.mockResolvedValue(mockResult);

      const result = await controller.exportData(dto);

      expect(reportsService.exportData).toHaveBeenCalledWith(dto);
      expect(result.filename).toContain('.xlsx');
      expect(result.success).toBe(true);
    });

    it('should export data to CSV format', async () => {
      const dto = {
        format: ExportFormat.CSV,
        data: [{ number: '101', type: 'Standard', status: 'available', price: 1500 }],
        columns: [
          { key: 'number', label: 'Number' },
          { key: 'type', label: 'Type' },
          { key: 'status', label: 'Status' },
          { key: 'price', label: 'Price' },
        ],
      };

      const mockResult = {
        success: true,
        filename: 'rooms-export.csv',
        data: 'base64-encoded-csv-data',
        mimeType: 'text/csv',
      };

      mockReportsService.exportData.mockResolvedValue(mockResult);

      const result = await controller.exportData(dto);

      expect(reportsService.exportData).toHaveBeenCalledWith(dto);
      expect(result.filename).toContain('.csv');
    });

    it('should export data to PDF format', async () => {
      const dto = {
        format: ExportFormat.PDF,
        data: [{ date: '2024-01-15', revenue: 50000, bookings: 10 }],
        title: 'Monthly Revenue Report',
      };

      const mockResult = {
        success: true,
        filename: 'revenue-report-2024-01.pdf',
        data: 'base64-encoded-pdf-data',
        mimeType: 'application/pdf',
      };

      mockReportsService.exportData.mockResolvedValue(mockResult);

      const result = await controller.exportData(dto);

      expect(reportsService.exportData).toHaveBeenCalledWith(dto);
      expect(result.filename).toContain('.pdf');
    });

    it('should export booking report with filters', async () => {
      const dto = {
        format: ExportFormat.EXCEL,
        data: [{ guestName: 'John', status: 'confirmed', roomType: 'deluxe' }],
      };

      mockReportsService.exportData.mockResolvedValue({
        success: true,
        filename: 'bookings-filtered.xlsx',
        data: 'base64-data',
      });

      await controller.exportData(dto);

      expect(reportsService.exportData).toHaveBeenCalledWith(
        expect.objectContaining({
          data: dto.data,
        }),
      );
    });

    it('should export guests report', async () => {
      const dto = {
        format: ExportFormat.EXCEL,
        data: [{ name: 'John', email: 'john@example.com', phone: '081', visits: 3, totalSpent: 50000 }],
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'visits', label: 'Visits' },
          { key: 'totalSpent', label: 'Total Spent' },
        ],
      };

      mockReportsService.exportData.mockResolvedValue({
        success: true,
        filename: 'guests-export.xlsx',
        data: 'base64-data',
      });

      const result = await controller.exportData(dto);

      expect(result.filename).toContain('guests');
    });

    it('should handle export error', async () => {
      const dto = {
        format: ExportFormat.EXCEL,
        data: [],
      };

      mockReportsService.exportData.mockRejectedValue(
        new Error('Invalid report type'),
      );

      await expect(controller.exportData(dto)).rejects.toThrow('Invalid report type');
    });
  });

  describe('POST /api/v1/reports/export/download', () => {
    it('should export and download Excel file directly', async () => {
      const dto = {
        format: ExportFormat.EXCEL,
        data: [{ id: 1, name: 'Test' }],
      };

      const mockResult = {
        success: true,
        filename: 'bookings-export.xlsx',
        data: Buffer.from('excel-content').toString('base64'),
      };

      mockReportsService.exportData.mockResolvedValue(mockResult);

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.exportAndDownload(dto, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="bookings-export.xlsx"',
      );
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should export and download CSV file directly', async () => {
      const dto = {
        format: ExportFormat.CSV,
        data: [{ id: 1, number: '101' }],
      };

      const mockResult = {
        success: true,
        filename: 'rooms-export.csv',
        data: Buffer.from('csv-content').toString('base64'),
      };

      mockReportsService.exportData.mockResolvedValue(mockResult);

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.exportAndDownload(dto, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    });

    it('should export and download PDF file directly', async () => {
      const dto = {
        format: ExportFormat.PDF,
        data: [{ id: 1, revenue: 50000 }],
      };

      const mockResult = {
        success: true,
        filename: 'revenue-report.pdf',
        data: Buffer.from('pdf-content').toString('base64'),
      };

      mockReportsService.exportData.mockResolvedValue(mockResult);

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.exportAndDownload(dto, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    });

    it('should set correct content length', async () => {
      const dto = {
        format: ExportFormat.EXCEL,
        data: [{ id: 1 }],
      };

      const content = 'test-content-for-length-check';
      const mockResult = {
        success: true,
        filename: 'test.xlsx',
        data: Buffer.from(content).toString('base64'),
      };

      mockReportsService.exportData.mockResolvedValue(mockResult);

      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.exportAndDownload(dto, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Length',
        content.length,
      );
    });
  });
});
