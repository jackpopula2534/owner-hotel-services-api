import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateStockCountItemDto {
  @ApiProperty({
    example: 45,
    description: 'Actual quantity counted (minimum 0)',
  })
  @IsNumber()
  @Min(0)
  actualQty: number;

  @ApiPropertyOptional({
    example: 'Verified by supervisor - recount complete',
    description: 'Notes for this item count',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
