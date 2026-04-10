import { IsArray, IsNotEmpty, IsString, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TablePositionDto {
  @ApiProperty({ example: 'uuid-table-id' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ example: 150.0 })
  @IsNumber()
  positionX: number;

  @ApiProperty({ example: 200.0 })
  @IsNumber()
  positionY: number;

  @ApiPropertyOptional({ example: 80.0 })
  @IsNumber()
  @IsOptional()
  width?: number;

  @ApiPropertyOptional({ example: 60.0 })
  @IsNumber()
  @IsOptional()
  height?: number;

  @ApiPropertyOptional({ example: 45 })
  @IsNumber()
  @IsOptional()
  rotation?: number;
}

export class SaveLayoutDto {
  @ApiProperty({ type: [TablePositionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TablePositionDto)
  tables: TablePositionDto[];
}
