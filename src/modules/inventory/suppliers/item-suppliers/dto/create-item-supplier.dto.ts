import { IsString, IsNumber, IsOptional, IsInt, Min, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateItemSupplierDto {
  @ApiProperty({
    description: 'Inventory item ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  itemId: string;

  @ApiProperty({
    description: 'Supplier ID',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsString()
  supplierId: string;

  @ApiProperty({
    description: 'Unit price from this supplier',
    example: 150.5,
  })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({
    description: 'Currency code',
    example: 'THB',
    default: 'THB',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string = 'THB';

  @ApiPropertyOptional({
    description: 'Minimum order quantity',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  minOrderQty?: number;

  @ApiPropertyOptional({
    description: 'Lead time in days',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  leadDays?: number;

  @ApiPropertyOptional({
    description: 'Is this the preferred supplier for the item',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPreferred?: boolean = false;

  @ApiPropertyOptional({
    description: 'Additional notes about this supplier for this item',
    example: 'Bulk discount available for orders > 100 units',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
