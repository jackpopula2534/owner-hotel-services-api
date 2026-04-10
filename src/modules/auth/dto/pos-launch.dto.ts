import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class PosLaunchDto {
  @ApiProperty({ example: 'rest_abc123', description: 'Restaurant ID to open in POS' })
  @IsString()
  restaurantId: string;

  @ApiPropertyOptional({ example: 'table_xyz456', description: 'Optional table to pre-select in POS' })
  @IsOptional()
  @IsString()
  tableId?: string;
}
