import { IsString, IsNotEmpty, IsOptional, IsInt, IsNumber, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty({ example: 'uuid-of-property' })
  @IsUUID()
  @IsNotEmpty()
  propertyId: string;

  @ApiProperty({ example: '101' })
  @IsString()
  @IsNotEmpty()
  number: string;

  @ApiProperty({ example: 'single' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  floor?: number;

  @ApiProperty({ example: 1500.00 })
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @ApiPropertyOptional({ example: 'available' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 'Standard single room' })
  @IsString()
  @IsOptional()
  description?: string;
}






