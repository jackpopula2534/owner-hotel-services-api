import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEnum,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TableShapeEnum {
  RECTANGLE = 'RECTANGLE',
  SQUARE = 'SQUARE',
  ROUND = 'ROUND',
  OVAL = 'OVAL',
}

export class CreateTableDto {
  @ApiProperty({ example: 'T01' })
  @IsString()
  @IsNotEmpty()
  tableNumber: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  capacity: number;

  @ApiPropertyOptional({ enum: TableShapeEnum, example: TableShapeEnum.RECTANGLE })
  @IsEnum(TableShapeEnum)
  @IsOptional()
  shape?: TableShapeEnum;

  @ApiPropertyOptional({ example: 100.5 })
  @IsNumber()
  @IsOptional()
  positionX?: number;

  @ApiPropertyOptional({ example: 200.0 })
  @IsNumber()
  @IsOptional()
  positionY?: number;

  @ApiPropertyOptional({ example: 80.0 })
  @IsNumber()
  @IsOptional()
  width?: number;

  @ApiPropertyOptional({ example: 60.0 })
  @IsNumber()
  @IsOptional()
  height?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  rotation?: number;

  @ApiPropertyOptional({ example: 'Main Hall' })
  @IsString()
  @IsOptional()
  zone?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
