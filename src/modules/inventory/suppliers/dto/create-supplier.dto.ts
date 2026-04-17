import { IsString, IsOptional, IsEmail, IsInt, Min, MaxLength, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateSupplierDto {
  @ApiProperty({
    description: 'Supplier name',
    example: 'Global Supplies Co.',
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'Unique supplier code per tenant',
    example: 'SUP-001',
  })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional({
    description: 'Contact person name',
    example: 'John Smith',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactPerson?: string;

  @ApiPropertyOptional({
    description: 'Contact email',
    example: 'john@globalsupplies.com',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    description: 'Contact phone number',
    example: '+66812345678',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Business address',
    example: '123 Commercial Street, Bangkok',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({
    description: 'Tax ID or VAT number',
    example: '1234567890123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxId?: string;

  @ApiPropertyOptional({
    description: 'Payment terms (e.g., Net 30, Net 60)',
    example: 'Net 30',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentTerms?: string;

  @ApiPropertyOptional({
    description: 'Lead time in days',
    example: 7,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  leadTimeDays?: number;

  @ApiPropertyOptional({
    description: 'Additional notes',
    example: 'Preferred supplier for beverages',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Tag IDs for categorizing supplier (stored as JSON array string)',
    example: ['cleaning', 'preferred'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    // รับทั้ง array และ JSON string
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return []; }
    }
    return [];
  })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Emoji icon for display in UI',
    example: '🏢',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  emoji?: string;
}
