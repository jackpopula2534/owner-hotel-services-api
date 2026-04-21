import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddOrderItemDto {
  @ApiProperty({ example: 'uuid-menu-item-id' })
  @IsString()
  @IsNotEmpty()
  menuItemId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @ApiPropertyOptional({ example: 'Extra spicy' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: { size: 'large', sauce: 'spicy' } })
  @IsOptional()
  modifiers?: Record<string, unknown>;
}
