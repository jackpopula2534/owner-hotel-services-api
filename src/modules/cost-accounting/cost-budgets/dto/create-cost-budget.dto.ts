import { IsString, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCostBudgetDto {
  @ApiProperty({
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  propertyId: string;

  @ApiProperty({
    description: 'Cost Center ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsUUID()
  costCenterId: string;

  @ApiProperty({
    description: 'Cost Type ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440002',
  })
  @IsUUID()
  costTypeId: string;

  @ApiProperty({ description: 'Period in YYYY-MM format', example: '2026-04' })
  @IsString()
  period: string;

  @ApiProperty({ description: 'Budget amount (number)', example: 5000.0, minimum: 0 })
  @IsNumber()
  @Min(0)
  budgetAmount: number;

  @ApiProperty({
    description: 'Notes or comments about the budget',
    example: 'Quarterly budget allocation',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
