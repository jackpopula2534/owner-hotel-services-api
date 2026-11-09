import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export const TICKET_CHANNELS = [
  'line',
  'email',
  'phone',
  'walk_in',
  'manual',
  'review',
  'web',
] as const;
export const TICKET_CATEGORIES = [
  'maintenance',
  'billing',
  'service',
  'housekeeping',
  'fnb',
  'other',
] as const;

export class CreateTicketDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiProperty({ enum: TICKET_CHANNELS, default: 'manual' })
  @IsOptional()
  @IsEnum(TICKET_CHANNELS)
  channel?: (typeof TICKET_CHANNELS)[number];

  @ApiProperty({ enum: TICKET_CATEGORIES, required: false })
  @IsOptional()
  @IsEnum(TICKET_CATEGORIES)
  category?: (typeof TICKET_CATEGORIES)[number];

  @ApiProperty({ enum: TICKET_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsEnum(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiProperty({ required: false, description: 'ISO datetime for SLA due' })
  @IsOptional()
  @IsDateString()
  slaDueAt?: string;

  @ApiProperty({ required: false, description: 'JSON-encoded source metadata' })
  @IsOptional()
  @IsString()
  metadata?: string;
}

export class UpdateTicketDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: TICKET_STATUSES, required: false })
  @IsOptional()
  @IsEnum(TICKET_STATUSES)
  status?: (typeof TICKET_STATUSES)[number];

  @ApiProperty({ enum: TICKET_PRIORITIES, required: false })
  @IsOptional()
  @IsEnum(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];

  @ApiProperty({ enum: TICKET_CATEGORIES, required: false })
  @IsOptional()
  @IsEnum(TICKET_CATEGORIES)
  category?: (typeof TICKET_CATEGORIES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  slaDueAt?: string;
}

export class CsatScoreDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  score: number;
}

export class QueryTicketsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ enum: TICKET_STATUSES, required: false })
  @IsOptional()
  @IsEnum(TICKET_STATUSES)
  status?: (typeof TICKET_STATUSES)[number];

  @ApiProperty({ enum: TICKET_PRIORITIES, required: false })
  @IsOptional()
  @IsEnum(TICKET_PRIORITIES)
  priority?: (typeof TICKET_PRIORITIES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  page?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  limit?: string;
}
