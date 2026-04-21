import {
  IsOptional,
  IsString,
  IsNumber,
  IsISO8601,
  IsInt,
  Min,
  Max,
  ValidateNested,
  ArrayMinSize,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitQuoteItemDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Inventory item ID',
  })
  @IsString()
  itemId: string;

  @ApiProperty({
    example: 10,
    description: 'Quantity ordered',
  })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({
    example: 99.99,
    description: 'Unit price',
  })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiProperty({
    example: 5,
    description: 'Discount percentage (0-100)',
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discount?: number;

  @ApiProperty({
    example: 7,
    description: 'Tax rate percentage (0-100)',
    required: false,
    default: 7,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiProperty({
    example: 5,
    description: 'Lead time in days',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  leadTimeDays?: number;

  @ApiProperty({
    example: 'Standard packaging included',
    description: 'Item-specific notes',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class SubmitQuoteDto {
  @ApiProperty({
    example: 'Q-2026-04-001',
    description: 'Quote number from supplier',
    required: false,
  })
  @IsOptional()
  @IsString()
  quoteNumber?: string;

  @ApiProperty({
    example: '2026-04-15T10:30:00Z',
    description: 'Date quote was provided (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  quotedDate?: string;

  @ApiProperty({
    example: '2026-05-15T23:59:59Z',
    description: 'Date quote expires (ISO 8601)',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  @ApiProperty({
    example: 7,
    description: 'Delivery days',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  deliveryDays?: number;

  @ApiProperty({
    example: 'Net 30 days',
    description: 'Payment terms',
    required: false,
  })
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiProperty({
    example: 'Free delivery for orders above 10,000 THB',
    description: 'General notes about the quote',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    example: 'https://example.com/quote-file.pdf',
    description: 'URL to quote attachment',
    required: false,
  })
  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @ApiProperty({
    type: [SubmitQuoteItemDto],
    description: 'Quote line items',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'items ต้องมีอย่างน้อย 1 รายการ' })
  @ValidateNested({ each: true })
  @Type(() => SubmitQuoteItemDto)
  items: SubmitQuoteItemDto[];
}
