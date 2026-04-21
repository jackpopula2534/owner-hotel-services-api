import { IsString, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateSnapshotDto {
  @ApiProperty({
    description: 'Property ID',
    example: 'uuid-of-property',
  })
  @IsString()
  propertyId: string;

  @ApiProperty({
    description: 'Period in YYYY-MM format',
    example: '2026-04',
    pattern: '^\\d{4}-\\d{2}$',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'Period must be in YYYY-MM format',
  })
  period: string;

  @ApiPropertyOptional({
    description: 'Optional restaurant ID to filter by specific restaurant',
    example: 'uuid-of-restaurant',
  })
  @IsOptional()
  @IsString()
  restaurantId?: string;
}
