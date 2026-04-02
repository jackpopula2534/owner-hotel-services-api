import { IsString, IsNotEmpty, IsOptional, IsNumber, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WalkInDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  guestFirstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  guestLastName: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsEmail()
  guestEmail?: string;

  @ApiPropertyOptional({ example: '+66812345678' })
  @IsOptional()
  @IsString()
  guestPhone?: string;

  @ApiProperty({ example: 'room-uuid-here' })
  @IsString()
  @IsNotEmpty()
  roomId: string;

  @ApiPropertyOptional({ example: 'property-uuid-here' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiProperty({ example: 1, description: 'Number of nights' })
  @IsNumber()
  @IsNotEmpty()
  nights: number;

  @ApiPropertyOptional({ example: 'Special requests or notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}
