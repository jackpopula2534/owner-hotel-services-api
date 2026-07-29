import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import {
  ExportRequestDto,
  ExportResponseDto,
  ExportFormat,
  RevenueReportQueryDto,
  RevenueReportResponseDto,
  OccupancyReportQueryDto,
  OccupancyReportResponseDto,
} from './dto/export.dto';
import { PrismaService } from '../../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import { Parser } from 'json2csv';
import PDFDocument from 'pdfkit';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Main export function
   */
  async exportData(dto: ExportRequestDto): Promise<ExportResponseDto> {
    try {
      this.logger.log(`Exporting data in ${dto.format} format`);

      // Validate data
      if (!dto.data || dto.data.length === 0) {
        throw new BadRequestException('No data to export');
      }

      let buffer: Buffer;
      let filename: string;
      let mimeType: string;

      switch (dto.format) {
        case ExportFormat.EXCEL:
          ({ buffer, filename } = await this.exportToExcel(dto));
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          break;

        case ExportFormat.CSV:
          ({ buffer, filename } = await this.exportToCSV(dto));
          mimeType = 'text/csv';
          break;

        case ExportFormat.PDF:
          ({ buffer, filename } = await this.exportToPDF(dto));
          mimeType = 'application/pdf';
          break;

        default:
          throw new BadRequestException(`Unsupported format: ${dto.format}`);
      }

      // Convert buffer to base64
      const base64Data = buffer.toString('base64');

      // TODO: If sendEmail is true, send via email (BE-EMAIL-004)
      if (dto.sendEmail && dto.emailTo) {
        this.logger.log(`Email export requested to: ${dto.emailTo}`);
        // await this.emailService.sendExportEmail(dto.emailTo, buffer, filename, mimeType);
      }

      return {
        success: true,
        filename,
        fileSize: buffer.length,
        data: base64Data,
      };
    } catch (error) {
      this.logger.error('Export error:', error);
      throw error;
    }
  }

  /**
   * Export to Excel (XLSX) using exceljs
   */
  private async exportToExcel(
    dto: ExportRequestDto,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(dto.sheetName || 'Sheet1');

    // Determine columns
    const columns = dto.columns || this.extractColumns(dto.data);

    // Set worksheet columns
    worksheet.columns = columns.map((col) => ({
      header: col.label,
      key: col.key,
      width: col.width || 15,
    }));

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Add data rows
    dto.data.forEach((item) => {
      const row: any = {};
      columns.forEach((col) => {
        row[col.key] = item[col.key];
      });
      worksheet.addRow(row);
    });

    // Add borders to all cells
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    // Auto-filter
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };

    // Generate buffer
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const filename = `${dto.filename || 'export'}_${this.getTimestamp()}.xlsx`;

    return { buffer, filename };
  }

  /**
   * Export to CSV
   */
  private async exportToCSV(dto: ExportRequestDto): Promise<{ buffer: Buffer; filename: string }> {
    const columns = dto.columns || this.extractColumns(dto.data);

    // Configure parser
    const fields = columns.map((col) => ({
      label: col.label,
      value: col.key,
    }));

    const parser = new Parser({ fields, withBOM: true });
    const csv = parser.parse(dto.data);

    const buffer = Buffer.from(csv, 'utf-8');
    const filename = `${dto.filename || 'export'}_${this.getTimestamp()}.csv`;

    return { buffer, filename };
  }

  /**
   * Export to PDF using pdfkit
   */
  private async exportToPDF(dto: ExportRequestDto): Promise<{ buffer: Buffer; filename: string }> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: dto.pageSize || 'A4',
          layout: dto.orientation || 'portrait',
          margins: { top: 50, bottom: 50, left: 50, right: 50 },
        });

        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const filename = `${dto.filename || 'export'}_${this.getTimestamp()}.pdf`;
          resolve({ buffer, filename });
        });
        doc.on('error', reject);

        // Title
        if (dto.title) {
          doc.fontSize(18).font('Helvetica-Bold').text(dto.title, { align: 'center' });
          doc.moveDown();
        }

        // Date
        doc
          .fontSize(10)
          .font('Helvetica')
          .text(`Generated: ${new Date().toLocaleString('th-TH')}`, { align: 'right' });
        doc.moveDown();

        // Columns
        const columns = dto.columns || this.extractColumns(dto.data);
        const columnWidth = (doc.page.width - 100) / columns.length;

        // Table header
        let y = doc.y;
        doc.fontSize(10).font('Helvetica-Bold');

        columns.forEach((col, index) => {
          doc.text(col.label, 50 + index * columnWidth, y, {
            width: columnWidth,
            align: 'left',
          });
        });

        doc.moveDown();
        y = doc.y;

        // Draw header line
        doc
          .moveTo(50, y)
          .lineTo(doc.page.width - 50, y)
          .stroke();
        doc.moveDown(0.5);

        // Table rows
        doc.fontSize(9).font('Helvetica');

        dto.data.forEach((item, rowIndex) => {
          y = doc.y;

          // Check if we need a new page
          if (y > doc.page.height - 100) {
            doc.addPage();
            y = 50;
          }

          columns.forEach((col, colIndex) => {
            const value = item[col.key];
            const text = value !== null && value !== undefined ? String(value) : '';

            doc.text(text, 50 + colIndex * columnWidth, y, {
              width: columnWidth - 5,
              align: 'left',
              ellipsis: true,
            });
          });

          doc.moveDown(0.5);
        });

        // Footer
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
          doc.switchToPage(i);
          doc.fontSize(8).text(`Page ${i + 1} of ${pages.count}`, 50, doc.page.height - 50, {
            align: 'center',
          });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Extract columns from data
   */
  private extractColumns(data: any[]): Array<{ key: string; label: string; width?: number }> {
    if (data.length === 0) {
      return [];
    }

    const keys = Object.keys(data[0]);
    return keys.map((key) => ({
      key,
      label: this.formatLabel(key),
      width: 15,
    }));
  }

  /**
   * Format label from key
   */
  private formatLabel(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  }

  /**
   * Get timestamp for filename
   */
  private getTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  }

  // ==========================================
  // Revenue Report Methods
  // ==========================================

  /**
   * ป้ายกำกับที่ใช้แทนลานกางเต็นท์ในช่อง byRoomType / byChannel
   * (CampReservation ไม่มี room.type และไม่มี channel — จึงต้องมีถังของตัวเอง
   * ไม่งั้นเปอร์เซ็นต์ในกราฟแยกประเภทจะรวมกันไม่ครบ 100% ของรายได้)
   */
  private static readonly CAMP_LABEL = 'ลานกางเต็นท์';

  /**
   * เงื่อนไข where ของ camp_reservations ที่ปลอดภัยข้าม tenant
   *
   * `CampReservation.tenantId` เป็น nullable — ข้อมูลเก่าบางแถวไม่มีค่า ถ้า query ด้วย
   * `{ tenantId }` ตรงๆ แถวเหล่านั้นจะหายไปจากรายงาน จึงยอมรับกรณี tenantId = null
   * โดยบังคับว่า "ลานที่แถวนั้นสังกัดอยู่" ต้องเป็นของ tenant นี้ (ไม่ fail open)
   */
  private campReservationWhere(tenantId: string) {
    return {
      status: { in: ['confirmed', 'checked_in', 'checked_out', 'completed'] },
      OR: [{ tenantId }, { tenantId: null, campground: { tenantId } }],
    };
  }

  /**
   * แปลง CampReservation ให้มีหน้าตาเหมือน Booking เท่าที่ helper ของรายงานใช้จริง
   * (checkIn / checkOut / totalPrice / room.type / channel.name)
   */
  private normalizeCampReservations(reservations: any[]) {
    return reservations.map((r) => ({
      ...r,
      room: { type: ReportsService.CAMP_LABEL },
      channel: { name: ReportsService.CAMP_LABEL },
    }));
  }

  /**
   * Generate revenue report
   */
  async getRevenueReport(
    query: RevenueReportQueryDto,
    tenantId?: string,
  ): Promise<RevenueReportResponseDto> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    // Calculate previous period for comparison
    const periodLength = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - periodLength);
    const prevEndDate = new Date(startDate.getTime() - 1);

    // Base query conditions
    const baseWhere: any = {
      tenantId,
      status: { in: ['confirmed', 'checked_in', 'checked_out', 'completed'] },
    };

    if (query.propertyId) {
      baseWhere.propertyId = query.propertyId;
    }

    // รายงานรวมลานกางเต็นท์ด้วย ยกเว้นตอนกรองเฉพาะ property เพราะ Campground
    // ไม่มี propertyId จึงระบุไม่ได้ว่าลานไหนอยู่ property ไหน
    const includeCamp = !query.propertyId;
    const campWhere = this.campReservationWhere(tenantId);

    // Get current period bookings
    const [hotelBookings, campReservations] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          ...baseWhere,
          checkIn: { gte: startDate, lte: endDate },
        },
        include: {
          room: true,
          channel: true,
        },
      }),
      includeCamp
        ? this.prisma.campReservation.findMany({
            where: { ...campWhere, checkIn: { gte: startDate, lte: endDate } },
          })
        : Promise.resolve([]),
    ]);

    const currentBookings = [
      ...hotelBookings,
      ...this.normalizeCampReservations(campReservations),
    ];

    // Get previous period bookings for comparison
    const [prevHotelBookings, prevCampReservations] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          ...baseWhere,
          checkIn: { gte: prevStartDate, lte: prevEndDate },
        },
      }),
      includeCamp
        ? this.prisma.campReservation.findMany({
            where: { ...campWhere, checkIn: { gte: prevStartDate, lte: prevEndDate } },
          })
        : Promise.resolve([]),
    ]);

    const previousBookings = [...prevHotelBookings, ...prevCampReservations];

    // Calculate totals
    const totalRevenue = currentBookings.reduce((sum, b) => sum + Number(b.totalPrice), 0);
    const totalBookings = currentBookings.length;

    const prevRevenue = previousBookings.reduce((sum, b) => sum + Number(b.totalPrice), 0);
    const prevBookings = previousBookings.length;

    // Calculate unit count for RevPAR — รายได้รวมลานแล้ว ตัวหารจึงต้องรวมแปลงกางเต็นท์ด้วย
    // ไม่งั้น RevPAR จะสูงเกินจริง
    const [roomCount, pitchCount] = await Promise.all([
      this.prisma.room.count({ where: { tenantId } }),
      includeCamp
        ? this.prisma.campPitch.count({
            where: { OR: [{ tenantId }, { tenantId: null, campground: { tenantId } }] },
          })
        : Promise.resolve(0),
    ]);

    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 1;
    const availableRoomNights = (roomCount + pitchCount) * days;

    // Calculate metrics
    const averageAdr = totalBookings > 0 ? totalRevenue / totalBookings : 0;
    const revpar = availableRoomNights > 0 ? totalRevenue / availableRoomNights : 0;

    // Generate trend data
    const trend = this.generateRevenueTrend(
      currentBookings,
      startDate,
      endDate,
      query.groupBy || 'day',
    );

    // Build response
    const response: RevenueReportResponseDto = {
      startDate: query.startDate,
      endDate: query.endDate,
      totalRevenue,
      totalBookings,
      averageAdr: Math.round(averageAdr * 100) / 100,
      revpar: Math.round(revpar * 100) / 100,
      trend,
      comparison: {
        revenueChange: totalRevenue - prevRevenue,
        revenueChangePercent:
          prevRevenue > 0
            ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100 * 100) / 100
            : 0,
        bookingsChange: totalBookings - prevBookings,
        bookingsChangePercent:
          prevBookings > 0
            ? Math.round(((totalBookings - prevBookings) / prevBookings) * 100 * 100) / 100
            : 0,
      },
    };

    // Add room type breakdown if requested
    if (query.includeRoomTypeBreakdown !== false) {
      response.byRoomType = this.calculateRoomTypeRevenue(currentBookings, totalRevenue);
    }

    // Add channel breakdown if requested
    if (query.includeChannelBreakdown !== false) {
      response.byChannel = this.calculateChannelRevenue(currentBookings, totalRevenue);
    }

    return response;
  }

  /**
   * Generate revenue trend data
   */
  private generateRevenueTrend(
    bookings: any[],
    startDate: Date,
    endDate: Date,
    groupBy: 'day' | 'week' | 'month',
  ) {
    const trend: any[] = [];
    const bookingsByDate = new Map<string, { revenue: number; count: number }>();

    // Group bookings by date
    for (const booking of bookings) {
      const date = new Date(booking.checkIn);
      let key: string;

      if (groupBy === 'month') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else if (groupBy === 'week') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
      } else {
        key = date.toISOString().split('T')[0];
      }

      const existing = bookingsByDate.get(key) || { revenue: 0, count: 0 };
      existing.revenue += Number(booking.totalPrice);
      existing.count += 1;
      bookingsByDate.set(key, existing);
    }

    // Generate all dates in range
    const current = new Date(startDate);
    while (current <= endDate) {
      let key: string;

      if (groupBy === 'month') {
        key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        current.setMonth(current.getMonth() + 1);
      } else if (groupBy === 'week') {
        const weekStart = new Date(current);
        weekStart.setDate(current.getDate() - current.getDay());
        key = weekStart.toISOString().split('T')[0];
        current.setDate(current.getDate() + 7);
      } else {
        key = current.toISOString().split('T')[0];
        current.setDate(current.getDate() + 1);
      }

      if (!trend.find((t) => t.date === key)) {
        const data = bookingsByDate.get(key) || { revenue: 0, count: 0 };
        trend.push({
          date: key,
          revenue: data.revenue,
          bookings: data.count,
          adr: data.count > 0 ? Math.round((data.revenue / data.count) * 100) / 100 : 0,
        });
      }
    }

    return trend.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate revenue by room type
   */
  private calculateRoomTypeRevenue(bookings: any[], totalRevenue: number) {
    const byType = new Map<string, { revenue: number; count: number }>();

    for (const booking of bookings) {
      const type = booking.room?.type || 'Unknown';
      const existing = byType.get(type) || { revenue: 0, count: 0 };
      existing.revenue += Number(booking.totalPrice);
      existing.count += 1;
      byType.set(type, existing);
    }

    return Array.from(byType.entries()).map(([roomType, data]) => ({
      roomType,
      revenue: data.revenue,
      bookings: data.count,
      percentage:
        totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 100 * 100) / 100 : 0,
    }));
  }

  /**
   * Calculate revenue by channel
   */
  private calculateChannelRevenue(bookings: any[], totalRevenue: number) {
    const byChannel = new Map<string, { revenue: number; count: number }>();

    for (const booking of bookings) {
      const channel = booking.channel?.name || 'Direct';
      const existing = byChannel.get(channel) || { revenue: 0, count: 0 };
      existing.revenue += Number(booking.totalPrice);
      existing.count += 1;
      byChannel.set(channel, existing);
    }

    return Array.from(byChannel.entries()).map(([channel, data]) => ({
      channel,
      revenue: data.revenue,
      bookings: data.count,
      percentage:
        totalRevenue > 0 ? Math.round((data.revenue / totalRevenue) * 100 * 100) / 100 : 0,
    }));
  }

  // ==========================================
  // Occupancy Report Methods
  // ==========================================

  /**
   * Generate occupancy report
   */
  async getOccupancyReport(
    query: OccupancyReportQueryDto,
    tenantId?: string,
  ): Promise<OccupancyReportResponseDto> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    // Calculate previous period for comparison
    const periodLength = endDate.getTime() - startDate.getTime();
    const prevStartDate = new Date(startDate.getTime() - periodLength);
    const prevEndDate = new Date(startDate.getTime() - 1);

    // Base query conditions
    const roomWhere: any = { tenantId };
    const bookingWhere: any = {
      tenantId,
      status: { in: ['confirmed', 'checked_in', 'checked_out', 'completed'] },
    };

    if (query.propertyId) {
      roomWhere.propertyId = query.propertyId;
      bookingWhere.propertyId = query.propertyId;
    }

    // เช่นเดียวกับรายงานรายได้: รวมลานกางเต็นท์ ยกเว้นตอนกรองเฉพาะ property
    const includeCamp = !query.propertyId;
    const campWhere = this.campReservationWhere(tenantId);
    const campUnitWhere = { OR: [{ tenantId }, { tenantId: null, campground: { tenantId } }] };

    // ช่วงวันที่ทับซ้อนกับงวดรายงาน — ใช้ซ้ำทั้ง booking และ camp
    const overlaps = (from: Date, to: Date) => [
      { checkIn: { gte: from, lte: to } },
      { checkOut: { gte: from, lte: to } },
      { AND: [{ checkIn: { lte: from } }, { checkOut: { gte: to } }] },
    ];

    // Get all rooms + pitches (ลานกางเต็นท์นับเป็นหน่วยที่ขายได้เหมือนห้อง)
    const [rooms, pitches] = await Promise.all([
      this.prisma.room.findMany({ where: roomWhere }),
      includeCamp
        ? this.prisma.campPitch.findMany({ where: campUnitWhere })
        : Promise.resolve([] as any[]),
    ]);

    const campUnits = pitches.map((p) => ({ ...p, type: ReportsService.CAMP_LABEL }));
    const totalRooms = rooms.length + campUnits.length;

    // Get bookings in the period
    const [hotelBookings, campReservations] = await Promise.all([
      this.prisma.booking.findMany({
        where: { ...bookingWhere, OR: overlaps(startDate, endDate) },
        include: { room: true },
      }),
      includeCamp
        ? this.prisma.campReservation.findMany({
            where: { ...campWhere, AND: [{ OR: overlaps(startDate, endDate) }] },
          })
        : Promise.resolve([]),
    ]);

    const bookings = [...hotelBookings, ...this.normalizeCampReservations(campReservations)];

    // Get previous period bookings for comparison
    const [prevHotelBookings, prevCampReservations] = await Promise.all([
      this.prisma.booking.findMany({
        where: { ...bookingWhere, OR: overlaps(prevStartDate, prevEndDate) },
      }),
      includeCamp
        ? this.prisma.campReservation.findMany({
            where: { ...campWhere, AND: [{ OR: overlaps(prevStartDate, prevEndDate) }] },
          })
        : Promise.resolve([]),
    ]);

    const prevBookings = [...prevHotelBookings, ...prevCampReservations];

    // Calculate days in period
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 1;
    const availableRoomNights = totalRooms * days;

    // Calculate room nights sold
    const roomNightsSold = this.calculateRoomNights(bookings, startDate, endDate);
    const prevRoomNightsSold = this.calculateRoomNights(prevBookings, prevStartDate, prevEndDate);

    // Calculate occupancy rate
    const averageOccupancy =
      availableRoomNights > 0
        ? Math.round((roomNightsSold / availableRoomNights) * 100 * 100) / 100
        : 0;

    // Generate trend data
    const trend = this.generateOccupancyTrend(
      bookings,
      totalRooms,
      startDate,
      endDate,
      query.groupBy || 'day',
    );

    // Find peak and lowest occupancy
    const occupancyRates = trend.map((t) => t.occupancyRate);
    const peakOccupancy = Math.max(...occupancyRates, 0);
    const lowestOccupancy = Math.min(...occupancyRates.filter((r) => r > 0), 0);

    // Get current room status (รวมสถานะแปลงกางเต็นท์)
    const currentStatus = await this.getCurrentRoomStatus(
      roomWhere,
      includeCamp ? campUnitWhere : null,
    );

    // Build response
    const response: OccupancyReportResponseDto = {
      startDate: query.startDate,
      endDate: query.endDate,
      averageOccupancy,
      peakOccupancy,
      lowestOccupancy: lowestOccupancy === Infinity ? 0 : lowestOccupancy,
      totalRoomNights: roomNightsSold,
      availableRoomNights,
      currentStatus,
      trend,
      comparison: {
        occupancyChange: averageOccupancy - ((prevRoomNightsSold / availableRoomNights) * 100 || 0),
        occupancyChangePercent:
          prevRoomNightsSold > 0
            ? Math.round(((roomNightsSold - prevRoomNightsSold) / prevRoomNightsSold) * 100 * 100) /
              100
            : 0,
        roomNightsChange: roomNightsSold - prevRoomNightsSold,
        roomNightsChangePercent:
          prevRoomNightsSold > 0
            ? Math.round(((roomNightsSold - prevRoomNightsSold) / prevRoomNightsSold) * 100 * 100) /
              100
            : 0,
      },
    };

    // Add room type breakdown if requested
    if (query.includeRoomTypeBreakdown !== false) {
      response.byRoomType = await this.calculateRoomTypeOccupancy(
        [...rooms, ...campUnits],
        bookings,
        startDate,
        endDate,
      );
    }

    return response;
  }

  /**
   * Calculate room nights from bookings
   */
  private calculateRoomNights(bookings: any[], startDate: Date, endDate: Date): number {
    let total = 0;

    for (const booking of bookings) {
      const checkIn = new Date(booking.checkIn);
      const checkOut = new Date(booking.checkOut);

      // Clamp dates to the report period
      const effectiveStart = checkIn < startDate ? startDate : checkIn;
      const effectiveEnd = checkOut > endDate ? endDate : checkOut;

      const nights = Math.ceil(
        (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (nights > 0) {
        total += nights;
      }
    }

    return total;
  }

  /**
   * Generate occupancy trend data
   */
  private generateOccupancyTrend(
    bookings: any[],
    totalRooms: number,
    startDate: Date,
    endDate: Date,
    groupBy: 'day' | 'week' | 'month',
  ) {
    const trend: any[] = [];

    const current = new Date(startDate);
    while (current <= endDate) {
      let key: string;
      let periodEnd: Date;

      if (groupBy === 'month') {
        key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        periodEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
        current.setMonth(current.getMonth() + 1);
      } else if (groupBy === 'week') {
        const weekStart = new Date(current);
        weekStart.setDate(current.getDate() - current.getDay());
        key = weekStart.toISOString().split('T')[0];
        periodEnd = new Date(weekStart);
        periodEnd.setDate(periodEnd.getDate() + 6);
        current.setDate(current.getDate() + 7);
      } else {
        key = current.toISOString().split('T')[0];
        periodEnd = new Date(current);
        current.setDate(current.getDate() + 1);
      }

      // Count occupied rooms for this period
      const periodDate = new Date(key);
      let occupiedRooms = 0;
      let checkIns = 0;
      let checkOuts = 0;

      for (const booking of bookings) {
        const checkIn = new Date(booking.checkIn);
        const checkOut = new Date(booking.checkOut);

        // Check if booking overlaps with this day/period
        if (checkIn <= periodEnd && checkOut > periodDate) {
          occupiedRooms++;
        }

        // Count check-ins on this day
        if (checkIn.toISOString().split('T')[0] === key) {
          checkIns++;
        }

        // Count check-outs on this day
        if (checkOut.toISOString().split('T')[0] === key) {
          checkOuts++;
        }
      }

      if (!trend.find((t) => t.date === key)) {
        trend.push({
          date: key,
          occupancyRate:
            totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100 * 100) / 100 : 0,
          occupiedRooms,
          totalRooms,
          checkIns,
          checkOuts,
        });
      }
    }

    return trend.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate occupancy by room type
   */
  private async calculateRoomTypeOccupancy(
    rooms: any[],
    bookings: any[],
    startDate: Date,
    endDate: Date,
  ) {
    const byType = new Map<string, { total: number; occupied: number }>();

    // Count rooms by type
    for (const room of rooms) {
      const type = room.type || 'Unknown';
      const existing = byType.get(type) || { total: 0, occupied: 0 };
      existing.total += 1;
      byType.set(type, existing);
    }

    // Count occupied rooms by type
    for (const booking of bookings) {
      const type = booking.room?.type || 'Unknown';
      const existing = byType.get(type);
      if (existing) {
        existing.occupied += 1;
      }
    }

    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 1;

    return Array.from(byType.entries()).map(([roomType, data]) => ({
      roomType,
      occupancyRate:
        data.total > 0 ? Math.round((data.occupied / (data.total * days)) * 100 * 100) / 100 : 0,
      occupiedRooms: data.occupied,
      totalRooms: data.total,
    }));
  }

  /**
   * Get current room status summary
   */
  private async getCurrentRoomStatus(where: any, campWhere: any = null) {
    // แปลงกางเต็นท์ใช้ status ชุดเดียวกับห้อง (available | occupied | cleaning | maintenance | closed)
    // จึงนับรวมในตารางเดียวกันได้ — 'closed' ถือเป็น out of order
    const [hotelRooms, pitches] = await Promise.all([
      this.prisma.room.findMany({ where }),
      campWhere ? this.prisma.campPitch.findMany({ where: campWhere }) : Promise.resolve([] as any[]),
    ]);

    const rooms = [...hotelRooms, ...pitches];

    const statusCount = {
      total: rooms.length,
      occupied: 0,
      available: 0,
      outOfOrder: 0,
      cleaning: 0,
    };

    for (const room of rooms) {
      switch (room.status) {
        case 'occupied':
          statusCount.occupied++;
          break;
        case 'available':
          statusCount.available++;
          break;
        case 'out_of_order':
        case 'maintenance':
        case 'closed':
          statusCount.outOfOrder++;
          break;
        case 'cleaning':
          statusCount.cleaning++;
          break;
        default:
          statusCount.available++;
      }
    }

    return statusCount;
  }
}
