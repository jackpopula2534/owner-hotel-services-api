import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsEnum,
  IsNumber,
  IsArray,
  IsBoolean,
  IsPositive,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OrderTypeEnum {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
  ROOM_SERVICE = 'ROOM_SERVICE',
}

export class CreateOrderItemDto {
  @ApiProperty({ example: 'uuid-menu-item-id' })
  @IsString()
  @IsNotEmpty()
  menuItemId: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @ApiPropertyOptional({ example: 'No onions please' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: { extra_sauce: true } })
  @IsOptional()
  modifiers?: Record<string, unknown>;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ example: 'uuid-table-id' })
  @IsString()
  @IsOptional()
  tableId?: string;

  @ApiPropertyOptional({ enum: OrderTypeEnum, example: OrderTypeEnum.DINE_IN })
  @IsEnum(OrderTypeEnum)
  @IsOptional()
  orderType?: OrderTypeEnum;

  @ApiPropertyOptional({ example: 'uuid-waiter-user-id' })
  @IsString()
  @IsOptional()
  waiterId?: string;

  @ApiPropertyOptional({ example: 'Sarah Johnson' })
  @IsString()
  @IsOptional()
  guestName?: string;

  @ApiPropertyOptional({ example: '301', description: 'Room number for room service' })
  @IsString()
  @IsOptional()
  guestRoom?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  partySize?: number;

  @ApiPropertyOptional({ example: 7.0, description: 'Tax rate percentage (default 7)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  taxRate?: number;

  @ApiPropertyOptional({
    example: 10.0,
    description: 'Service charge rate percentage (default 10)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  serviceRate?: number;

  @ApiPropertyOptional({ example: 'Large group booking' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    type: [CreateOrderItemDto],
    description: 'Initial order items (optional)',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @IsOptional()
  items?: CreateOrderItemDto[];
}
