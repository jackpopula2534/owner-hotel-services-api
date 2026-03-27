import { IsString, IsOptional, IsEmail, IsPhoneNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanyDto {
  @ApiProperty({
    description: 'Company/Tenant name (in Thai)',
    example: 'Hotel Paradise',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Company/Tenant name (in English)',
    example: 'Hotel Paradise English',
  })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({
    description: 'Property type (e.g., hotel, resort, hostel)',
    example: 'hotel',
  })
  @IsOptional()
  @IsString()
  propertyType?: string;

  @ApiPropertyOptional({
    description: 'Location/City',
    example: 'Bangkok',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    description: 'Website URL',
    example: 'https://hotelparadise.com',
  })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({
    description: 'Company description',
    example: 'A beautiful hotel in the heart of Bangkok',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Customer/Company name (registered name)',
    example: 'Hotel Paradise Co., Ltd.',
  })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({
    description: 'Tax ID',
    example: '1234567890123',
  })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional({
    description: 'Email address',
    example: 'contact@hotelparadise.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Phone number',
    example: '+66812345678',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Full address',
    example: '123 Main Street, Bangkok',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    description: 'District',
    example: 'Pathumwan',
  })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional({
    description: 'Province',
    example: 'Bangkok',
  })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({
    description: 'Postal code',
    example: '10330',
  })
  @IsOptional()
  @IsString()
  postalCode?: string;
}
