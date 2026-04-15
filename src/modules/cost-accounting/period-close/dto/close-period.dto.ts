import { IsUUID, IsInt, Min, Max, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClosePeriodDto {
  @ApiProperty({
    description: 'Property ID to close the period for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  propertyId: string;

  @ApiProperty({
    description: 'Year (e.g., 2026)',
    example: 2026,
  })
  @IsInt()
  @Min(2020)
  @Max(2099)
  year: number;

  @ApiProperty({
    description: 'Month (1-12)',
    example: 4,
  })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({
    description: 'Optional notes for the period close',
    example: 'Quarterly review completed',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
