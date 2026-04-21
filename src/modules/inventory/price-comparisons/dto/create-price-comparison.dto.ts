import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePriceComparisonDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Purchase requisition ID (required for comparison)',
  })
  @IsString()
  purchaseRequisitionId: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174003',
    description: 'Pre-selected supplier quote ID',
    required: false,
  })
  @IsOptional()
  @IsString()
  selectedQuoteId?: string;

  @ApiProperty({
    example: 'Lowest price with acceptable lead time',
    description: 'Reason for selection',
    required: false,
  })
  @IsOptional()
  @IsString()
  selectionReason?: string;

  @ApiProperty({
    example: 'All suppliers met quality requirements',
    description: 'General notes about the comparison',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
