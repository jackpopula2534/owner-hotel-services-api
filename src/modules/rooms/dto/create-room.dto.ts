import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsNumber,
  IsArray,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiPropertyOptional({
    example: 'uuid-of-property',
    description: 'Property ID (auto-resolved to default property if not provided)',
  })
  @IsUUID()
  @IsOptional()
  propertyId?: string;

  @ApiProperty({ example: '101' })
  @IsString()
  @IsNotEmpty()
  number: string;

  @ApiProperty({ example: 'standard' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @IsOptional()
  floor?: number;

  @ApiProperty({ example: 1500.0 })
  @IsNumber()
  @IsNotEmpty()
  price: number;

  @ApiPropertyOptional({ example: 'available' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsInt()
  @IsOptional()
  maxOccupancy?: number;

  @ApiPropertyOptional({ example: 'king' })
  @IsString()
  @IsOptional()
  bedType?: string;

  @ApiPropertyOptional({ example: 35 })
  @IsInt()
  @IsOptional()
  size?: number;

  @ApiPropertyOptional({ example: ['wifi', 'tv', 'ac'] })
  @IsArray()
  @IsOptional()
  amenities?: string[];

  @ApiPropertyOptional({ example: 'Standard single room' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: ['/uploads/rooms/room-101-1.jpg'],
    description: 'Array of image URLs stored on the server',
  })
  @IsArray()
  @IsOptional()
  images?: string[];
}
