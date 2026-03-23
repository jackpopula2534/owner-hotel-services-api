import { IsString, IsInt, IsOptional, IsEnum, IsDateString, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantStatus } from '../entities/tenant.entity';

export class CreateTenantDto {
  @ApiProperty({
    example: 'โรงแรมสุขใจ',
    description: 'Hotel name in Thai'
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: 'Comfort Hotel',
    description: 'Hotel name in English'
  })
  @IsString()
  @IsOptional()
  nameEn?: string;

  @ApiPropertyOptional({
    example: 'boutique_hotel',
    description: 'Property type (hotel, resort, hostel, guesthouse, etc)'
  })
  @IsString()
  @IsOptional()
  propertyType?: string;

  @ApiPropertyOptional({
    example: 'กรุงเทพฯ, สุขุมวิท',
    description: 'Hotel location/area'
  })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({
    example: 45,
    description: 'Total number of rooms'
  })
  @IsInt()
  @IsOptional()
  roomCount?: number;

  @ApiPropertyOptional({
    example: 'https://example-hotel.com',
    description: 'Hotel website URL'
  })
  @IsString()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({
    example: 'A comfortable 3-star hotel in central Bangkok',
    description: 'Hotel description'
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'สมชาย ใจดี',
    description: 'Hotel owner or manager name'
  })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional({
    example: '0105556789001',
    description: 'Thai tax ID (13 digits)'
  })
  @IsString()
  @IsOptional()
  taxId?: string;

  @ApiPropertyOptional({
    example: 'contact@hotel.com',
    description: 'Hotel contact email'
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({
    example: '+66-2-123-4567',
    description: 'Hotel contact phone number'
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    example: '123 ถนนสุขุมวิท',
    description: 'Hotel street address'
  })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    example: 'วัฒนา',
    description: 'District (Amphoe)'
  })
  @IsString()
  @IsOptional()
  district?: string;

  @ApiPropertyOptional({
    example: 'กรุงเทพมหานคร',
    description: 'Province/State'
  })
  @IsString()
  @IsOptional()
  province?: string;

  @ApiPropertyOptional({
    example: '10110',
    description: 'Postal code'
  })
  @IsString()
  @IsOptional()
  postalCode?: string;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Tenant status (active, trial, suspended, expired)'
  })
  @IsEnum(TenantStatus)
  @IsOptional()
  status?: TenantStatus;

  @ApiPropertyOptional({
    example: '2026-04-06T00:00:00Z',
    description: 'When trial period expires'
  })
  @IsDateString()
  @IsOptional()
  trialEndsAt?: Date;

  @ApiPropertyOptional({
    example: 14,
    description: 'Number of trial days'
  })
  @IsInt()
  @IsOptional()
  trialDays?: number;
}
