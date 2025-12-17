import { IsString, IsNotEmpty, IsOptional, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRestaurantDto {
  @ApiProperty({ example: 'Main Restaurant' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'REST001' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({ example: 'Fine dining restaurant' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'Ground Floor' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsInt()
  @IsOptional()
  capacity?: number;
}


