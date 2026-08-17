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
import { RevenueSourceModule, RevenueSourceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type DayGrouping,
  bucketOfDay,
  round2,
  shiftDate,
  toBangkokDate,
} from '../../common/utils/bangkok-day.util';
import { RevenueDocument, RevenueQueryService } from '../revenue/revenue-query.service';
import * as ExcelJS from 'exceljs';
import { Parser } from 'json2csv';
import PDFDocument from 'pdfkit';

/** มิติของเอกสารต้นทางที่สมุดรายได้ไม่ได้เก็บ แต่รายงานยังต้องแยกให้ดู */
interface DocumentLabels {
  roomType: string;
  channel: string;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueQueryService,
  ) {}

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
   * รายงานรายได้ที่พัก (โรงแรม + ลานกางเต็นท์)
   *
   * ── ตัวเลขเงินทุกตัวมาจากสมุดรายได้ ────────────────────────────────────────
   * เดิมรายงานนี้บวก `booking.totalPrice` ของการจองที่ "เช็คอินในช่วง" เอง ซึ่งให้
   * คนละยอดกับหน้าภาพรวมและกับบัญชี เพราะนับการจองที่ยังไม่เกิดรายได้ (confirmed
   * ที่ยังไม่มาพัก) และไม่หักบิลที่ยกเลิกทีหลัง ตอนนี้ยอดทั้งหมดมาจาก
   * `RevenueQueryService` — วันที่รับรู้คือวันเช็คเอาต์ (วันที่ปิดบิล) ตามที่สมุดลงไว้
   *
   * มิติที่สมุดไม่ได้เก็บ (ประเภทห้อง / ช่องทางจอง) ยังต้องอ่านจากตาราง booking แต่
   * เอาเฉพาะ "ใบที่มีรายได้ในช่วงนี้" ตาม `sourceId` ที่สมุดคืนมา แล้วเทยอดของสมุด
   * ลงถัง ผลรวมของทุกถังจึงเท่ากับ `totalRevenue` เสมอ
   *
   * `totalBookings` = จำนวนเอกสารที่ทำรายได้ในช่วง ไม่ใช่จำนวนการจองที่เช็คอิน
   * และ `averageAdr` = รายได้เฉลี่ยต่อการเข้าพักหนึ่งใบ (ไม่ใช่ต่อคืน — ยอดต่อคืน
   * ต้องใช้จำนวนคืนที่ขายได้ ซึ่งอยู่ในรายงานอัตราเข้าพัก)
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
    const from = toBangkokDate(startDate);
    const to = toBangkokDate(endDate);

    // รายงานรวมลานกางเต็นท์ด้วย ยกเว้นตอนกรองเฉพาะ property เพราะ Campground
    // ไม่มี propertyId จึงระบุไม่ได้ว่าลานไหนอยู่ property ไหน (แถวลานในสมุดก็เก็บ
    // propertyId เป็น null การกรอง property จึงตัดมันออกให้เองอยู่แล้ว)
    const includeCamp = !query.propertyId;

    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 1;

    // งวดก่อนหน้าที่ยาวเท่ากัน จบก่อนวันเริ่มงวดนี้หนึ่งวัน
    const prevTo = shiftDate(from, -1);
    const prevFrom = shiftDate(from, -days);

    const scope = {
      tenantId,
      propertyId: query.propertyId,
      sourceModule: [RevenueSourceModule.HOTEL, RevenueSourceModule.CAMP],
    };

    const [current, previous, documents, prevDocuments, roomCount, pitchCount] = await Promise.all([
      this.revenue.totals({ ...scope, from, to }),
      this.revenue.totals({ ...scope, from: prevFrom, to: prevTo }),
      this.revenue.documents({ ...scope, from, to }),
      this.revenue.countDocuments({ ...scope, from: prevFrom, to: prevTo }),
      // ตัวหารของ RevPAR — รายได้รวมลานแล้ว ตัวหารจึงต้องรวมแปลงกางเต็นท์ด้วย
      // ไม่งั้น RevPAR จะสูงเกินจริง
      this.prisma.room.count({ where: { tenantId } }),
      includeCamp
        ? this.prisma.campPitch.count({
            where: { OR: [{ tenantId }, { tenantId: null, campground: { tenantId } }] },
          })
        : Promise.resolve(0),
    ]);

    const totalRevenue = current.net;
    const totalBookings = new Set(documents.map((d) => d.sourceId)).size;
    const prevRevenue = previous.net;
    const prevBookings = prevDocuments;

    const availableRoomNights = (roomCount + pitchCount) * days;

    const averageAdr = totalBookings > 0 ? totalRevenue / totalBookings : 0;
    const revpar = availableRoomNights > 0 ? totalRevenue / availableRoomNights : 0;

    const trend = this.generateRevenueTrend(documents, from, to, query.groupBy || 'day');

    const response: RevenueReportResponseDto = {
      startDate: query.startDate,
      endDate: query.endDate,
      totalRevenue,
      totalBookings,
      averageAdr: round2(averageAdr),
      revpar: round2(revpar),
      trend,
      comparison: {
        revenueChange: round2(totalRevenue - prevRevenue),
        revenueChangePercent:
          prevRevenue > 0 ? round2(((totalRevenue - prevRevenue) / prevRevenue) * 100) : 0,
        bookingsChange: totalBookings - prevBookings,
        bookingsChangePercent:
          prevBookings > 0 ? round2(((totalBookings - prevBookings) / prevBookings) * 100) : 0,
      },
    };

    const wantsRoomType = query.includeRoomTypeBreakdown !== false;
    const wantsChannel = query.includeChannelBreakdown !== false;

    if (wantsRoomType || wantsChannel) {
      const labels = await this.labelDocuments(documents, tenantId);
      if (wantsRoomType) {
        response.byRoomType = this.bucketDocuments(documents, labels, 'roomType').map((b) => ({
          roomType: b.key,
          revenue: b.revenue,
          bookings: b.bookings,
          percentage: totalRevenue > 0 ? round2((b.revenue / totalRevenue) * 100) : 0,
        }));
      }
      if (wantsChannel) {
        response.byChannel = this.bucketDocuments(documents, labels, 'channel').map((b) => ({
          channel: b.key,
          revenue: b.revenue,
          bookings: b.bookings,
          percentage: totalRevenue > 0 ? round2((b.revenue / totalRevenue) * 100) : 0,
        }));
      }
    }

    return response;
  }

  /**
   * หาชื่อประเภทห้อง/ช่องทางจองของเอกสารแต่ละใบที่สมุดคืนมา
   *
   * อ่านเฉพาะใบที่มีรายได้จริงในช่วง (id มาจากสมุด) ไม่ใช่กวาดทั้งตารางตามวันเช็คอิน
   * — การจองที่ยังไม่ปิดบิลไม่ควรโผล่ในรายงานรายได้ตั้งแต่แรก
   *
   * ลานกางเต็นท์ไม่มีทั้งสองมิติ จึงมีถังของตัวเอง ไม่งั้นเปอร์เซ็นต์ในกราฟจะรวมกัน
   * ไม่ครบ 100% ของรายได้
   */
  private async labelDocuments(
    documents: RevenueDocument[],
    tenantId: string,
  ): Promise<Map<string, DocumentLabels>> {
    const labels = new Map<string, DocumentLabels>();

    const bookingIds = [
      ...new Set(
        documents
          .filter((d) => d.sourceType === RevenueSourceType.BOOKING)
          .map((d) => d.sourceId),
      ),
    ];

    if (bookingIds.length > 0) {
      const bookings = await this.prisma.booking.findMany({
        where: { id: { in: bookingIds }, tenantId },
        select: {
          id: true,
          room: { select: { type: true } },
          channel: { select: { name: true } },
        },
      });
      for (const booking of bookings) {
        labels.set(booking.id, {
          roomType: booking.room?.type || 'Unknown',
          channel: booking.channel?.name || 'Direct',
        });
      }
    }

    for (const doc of documents) {
      if (doc.sourceType === RevenueSourceType.CAMP_RESERVATION) {
        labels.set(doc.sourceId, {
          roomType: ReportsService.CAMP_LABEL,
          channel: ReportsService.CAMP_LABEL,
        });
      }
    }

    return labels;
  }

  /** เทยอดของแต่ละเอกสารลงถังตามมิติที่ขอ — ถังรวมกันได้เท่ายอดรวมของสมุดเสมอ */
  private bucketDocuments(
    documents: RevenueDocument[],
    labels: Map<string, DocumentLabels>,
    dimension: keyof DocumentLabels,
  ): Array<{ key: string; revenue: number; bookings: number }> {
    const buckets = new Map<string, { revenue: number; ids: Set<string> }>();

    for (const doc of documents) {
      const key = labels.get(doc.sourceId)?.[dimension] ?? 'Unknown';
      const bucket = buckets.get(key) ?? { revenue: 0, ids: new Set<string>() };
      bucket.revenue += doc.net;
      bucket.ids.add(doc.sourceId);
      buckets.set(key, bucket);
    }

    return [...buckets.entries()].map(([key, bucket]) => ({
      key,
      revenue: round2(bucket.revenue),
      bookings: bucket.ids.size,
    }));
  }

  /**
   * กราฟรายได้ตามช่วงเวลา — ทุกช่องในช่วงต้องมีแถว ถึงจะเป็นศูนย์ก็ตาม
   *
   * เดินทีละวันตามปฏิทินไทยแล้วยุบเป็นถังตาม `groupBy` แทนที่จะกระโดดทีละสัปดาห์/
   * เดือนด้วย `Date` ของเครื่อง เพราะการบวกเดือนบน `Date` ข้ามวันที่ 31 แล้วเลื่อน
   * ไปเดือนถัดไปเงียบ ๆ (31 ม.ค. + 1 เดือน = 2 มี.ค.)
   */
  private generateRevenueTrend(
    documents: RevenueDocument[],
    from: string,
    to: string,
    groupBy: DayGrouping,
  ) {
    const byBucket = new Map<string, { revenue: number; ids: Set<string> }>();

    for (const doc of documents) {
      const key = bucketOfDay(doc.businessDate, groupBy);
      const bucket = byBucket.get(key) ?? { revenue: 0, ids: new Set<string>() };
      bucket.revenue += doc.net;
      bucket.ids.add(doc.sourceId);
      byBucket.set(key, bucket);
    }

    const trend: Array<{ date: string; revenue: number; bookings: number; adr: number }> = [];
    const seen = new Set<string>();

    for (let day = from; day <= to; day = shiftDate(day, 1)) {
      const key = bucketOfDay(day, groupBy);
      if (seen.has(key)) continue;
      seen.add(key);

      const bucket = byBucket.get(key);
      const revenue = round2(bucket?.revenue ?? 0);
      const bookings = bucket?.ids.size ?? 0;
      trend.push({
        date: key,
        revenue,
        bookings,
        adr: bookings > 0 ? round2(revenue / bookings) : 0,
      });
    }

    return trend.sort((a, b) => a.date.localeCompare(b.date));
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
