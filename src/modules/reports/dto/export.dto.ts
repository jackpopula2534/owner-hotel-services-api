import { IsEnum, IsOptional, IsString, IsArray, ValidateNested, IsBoolean, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ExportFormat {
  EXCEL = 'excel',
  CSV = 'csv',
  PDF = 'pdf',
}

export enum PdfOrientation {
  PORTRAIT = 'portrait',
  LANDSCAPE = 'landscape',
}

export enum PdfPageSize {
  A4 = 'A4',
  LETTER = 'Letter',
  LEGAL = 'Legal',
}

export class ExportColumnDto {
  @ApiProperty({ description: 'Column key in data object' })
  @IsString()
  key: string;

  @ApiProperty({ description: 'Column header label' })
  @IsString()
  label: string;

  @ApiPropertyOptional({ description: 'Column width (for Excel/PDF)' })
  @IsOptional()
  width?: number;
}

export class ExportRequestDto {
  @ApiProperty({
    enum: ExportFormat,
    description: 'Export format',
    example: ExportFormat.EXCEL,
  })
  @IsEnum(ExportFormat)
  format: ExportFormat;

  @ApiProperty({
    description: 'Data to export',
    type: 'array',
    example: [{ id: 1, name: 'John' }],
  })
  @IsArray()
  data: any[];

  @ApiPropertyOptional({
    description: 'Column configuration',
    type: [ExportColumnDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExportColumnDto)
  columns?: ExportColumnDto[];

  @ApiPropertyOptional({
    description: 'Filename (without extension)',
    example: 'report',
  })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({
    description: 'Sheet name (for Excel)',
    example: 'Sheet1',
  })
  @IsOptional()
  @IsString()
  sheetName?: string;

  @ApiPropertyOptional({
    enum: PdfOrientation,
    description: 'PDF orientation',
    example: PdfOrientation.PORTRAIT,
  })
  @IsOptional()
  @IsEnum(PdfOrientation)
  orientation?: PdfOrientation;

  @ApiPropertyOptional({
    enum: PdfPageSize,
    description: 'PDF page size',
    example: PdfPageSize.A4,
  })
  @IsOptional()
  @IsEnum(PdfPageSize)
  pageSize?: PdfPageSize;

  @ApiPropertyOptional({
    description: 'Report title (for PDF)',
    example: 'Monthly Revenue Report',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Send file via email',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @ApiPropertyOptional({
    description: 'Recipient email address (if sendEmail is true)',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsString()
  emailTo?: string;
}

export class ExportResponseDto {
  @ApiProperty({ description: 'Success status' })
  success: boolean;

  @ApiProperty({ description: 'Generated filename' })
  filename: string;

  @ApiProperty({ description: 'File size in bytes' })
  fileSize: number;

  @ApiProperty({ description: 'Download URL or base64 data' })
  data: string;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  error?: string;
}

// ==========================================
// Revenue Report DTOs
// ==========================================

export class RevenueReportQueryDto {
  @ApiProperty({ description: 'Start date for the report period (ISO string)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date for the report period (ISO string)' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: 'Property ID to filter by' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Group by: day, week, month', default: 'day' })
  @IsOptional()
  @IsString()
  groupBy?: 'day' | 'week' | 'month';

  @ApiPropertyOptional({ description: 'Include breakdown by room type', default: true })
  @IsOptional()
  @IsBoolean()
  includeRoomTypeBreakdown?: boolean;

  @ApiPropertyOptional({ description: 'Include breakdown by channel', default: true })
  @IsOptional()
  @IsBoolean()
  includeChannelBreakdown?: boolean;
}

export class RevenueDataPoint {
  @ApiProperty({ description: 'Date or period label' })
  date: string;

  @ApiProperty({ description: 'Total revenue for the period' })
  revenue: number;

  @ApiProperty({ description: 'Number of bookings' })
  bookings: number;

  @ApiProperty({ description: 'Average Daily Rate (ADR)' })
  adr: number;
}

export class RoomTypeRevenue {
  @ApiProperty({ description: 'Room type name' })
  roomType: string;

  @ApiProperty({ description: 'Revenue from this room type' })
  revenue: number;

  @ApiProperty({ description: 'Number of bookings' })
  bookings: number;

  @ApiProperty({ description: 'Percentage of total revenue' })
  percentage: number;
}

export class ChannelRevenue {
  @ApiProperty({ description: 'Channel name' })
  channel: string;

  @ApiProperty({ description: 'Revenue from this channel' })
  revenue: number;

  @ApiProperty({ description: 'Number of bookings' })
  bookings: number;

  @ApiProperty({ description: 'Percentage of total revenue' })
  percentage: number;
}

export class RevenueReportResponseDto {
  @ApiProperty({ description: 'Report period start' })
  startDate: string;

  @ApiProperty({ description: 'Report period end' })
  endDate: string;

  @ApiProperty({ description: 'Total revenue in the period' })
  totalRevenue: number;

  @ApiProperty({ description: 'Total number of bookings' })
  totalBookings: number;

  @ApiProperty({ description: 'Average Daily Rate (ADR)' })
  averageAdr: number;

  @ApiProperty({ description: 'Revenue Per Available Room (RevPAR)' })
  revpar: number;

  @ApiProperty({ description: 'Revenue trend data', type: [RevenueDataPoint] })
  trend: RevenueDataPoint[];

  @ApiPropertyOptional({ description: 'Revenue by room type', type: [RoomTypeRevenue] })
  byRoomType?: RoomTypeRevenue[];

  @ApiPropertyOptional({ description: 'Revenue by channel', type: [ChannelRevenue] })
  byChannel?: ChannelRevenue[];

  @ApiProperty({ description: 'Comparison with previous period' })
  comparison: {
    revenueChange: number;
    revenueChangePercent: number;
    bookingsChange: number;
    bookingsChangePercent: number;
  };
}

// ==========================================
// Occupancy Report DTOs
// ==========================================

export class OccupancyReportQueryDto {
  @ApiProperty({ description: 'Start date for the report period (ISO string)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date for the report period (ISO string)' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ description: 'Property ID to filter by' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Group by: day, week, month', default: 'day' })
  @IsOptional()
  @IsString()
  groupBy?: 'day' | 'week' | 'month';

  @ApiPropertyOptional({ description: 'Include breakdown by room type', default: true })
  @IsOptional()
  @IsBoolean()
  includeRoomTypeBreakdown?: boolean;
}

export class OccupancyDataPoint {
  @ApiProperty({ description: 'Date or period label' })
  date: string;

  @ApiProperty({ description: 'Occupancy rate as percentage' })
  occupancyRate: number;

  @ApiProperty({ description: 'Number of occupied rooms' })
  occupiedRooms: number;

  @ApiProperty({ description: 'Total available rooms' })
  totalRooms: number;

  @ApiProperty({ description: 'Number of check-ins' })
  checkIns: number;

  @ApiProperty({ description: 'Number of check-outs' })
  checkOuts: number;
}

export class RoomTypeOccupancy {
  @ApiProperty({ description: 'Room type name' })
  roomType: string;

  @ApiProperty({ description: 'Occupancy rate for this room type' })
  occupancyRate: number;

  @ApiProperty({ description: 'Number of occupied rooms' })
  occupiedRooms: number;

  @ApiProperty({ description: 'Total rooms of this type' })
  totalRooms: number;
}

export class RoomStatusSummary {
  @ApiProperty({ description: 'Total rooms' })
  total: number;

  @ApiProperty({ description: 'Currently occupied rooms' })
  occupied: number;

  @ApiProperty({ description: 'Available rooms' })
  available: number;

  @ApiProperty({ description: 'Out of order rooms' })
  outOfOrder: number;

  @ApiProperty({ description: 'Rooms being cleaned' })
  cleaning: number;
}

export class OccupancyReportResponseDto {
  @ApiProperty({ description: 'Report period start' })
  startDate: string;

  @ApiProperty({ description: 'Report period end' })
  endDate: string;

  @ApiProperty({ description: 'Average occupancy rate in the period' })
  averageOccupancy: number;

  @ApiProperty({ description: 'Peak occupancy rate' })
  peakOccupancy: number;

  @ApiProperty({ description: 'Lowest occupancy rate' })
  lowestOccupancy: number;

  @ApiProperty({ description: 'Total room nights sold' })
  totalRoomNights: number;

  @ApiProperty({ description: 'Total available room nights' })
  availableRoomNights: number;

  @ApiProperty({ description: 'Current room status summary', type: RoomStatusSummary })
  currentStatus: RoomStatusSummary;

  @ApiProperty({ description: 'Occupancy trend data', type: [OccupancyDataPoint] })
  trend: OccupancyDataPoint[];

  @ApiPropertyOptional({ description: 'Occupancy by room type', type: [RoomTypeOccupancy] })
  byRoomType?: RoomTypeOccupancy[];

  @ApiProperty({ description: 'Comparison with previous period' })
  comparison: {
    occupancyChange: number;
    occupancyChangePercent: number;
    roomNightsChange: number;
    roomNightsChangePercent: number;
  };
}
