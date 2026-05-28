import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const LEAD_SOURCES = [
  'ota',
  'website',
  'email',
  'walk_in',
  'referral',
  'cold_call',
  'event',
  'partner',
] as const;

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'lost',
  'converted',
] as const;

export class CreateLeadDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  contactName: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ enum: LEAD_SOURCES })
  @IsEnum(LEAD_SOURCES)
  source: (typeof LEAD_SOURCES)[number];

  @ApiProperty({ required: false, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estValue?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedCheckIn?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedCheckOut?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  partySize?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}

export class UpdateLeadDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ enum: LEAD_STATUSES, required: false })
  @IsOptional()
  @IsEnum(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number];

  @ApiProperty({ required: false, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estValue?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}

export class QualifyLeadDto {
  @ApiProperty({ description: 'Deal name (e.g. "Acme Q4 Conference - 50 rooms")' })
  @IsString()
  @MaxLength(200)
  dealName: string;

  @ApiProperty({ description: 'Estimated deal amount in THB' })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string;
}

export class QueryLeadsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ enum: LEAD_STATUSES, required: false })
  @IsOptional()
  @IsEnum(LEAD_STATUSES)
  status?: (typeof LEAD_STATUSES)[number];

  @ApiProperty({ enum: LEAD_SOURCES, required: false })
  @IsOptional()
  @IsEnum(LEAD_SOURCES)
  source?: (typeof LEAD_SOURCES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  page?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  limit?: string;
}
