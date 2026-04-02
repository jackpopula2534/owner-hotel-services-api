import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddFolioChargeDto {
  @ApiProperty({ example: 'Room service - breakfast' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiPropertyOptional({ example: 'room_service' })
  @IsString()
  @IsOptional()
  category?: 'room_service' | 'restaurant' | 'minibar' | 'laundry' | 'other';
}
