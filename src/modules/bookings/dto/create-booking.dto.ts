import { IsString, IsNotEmpty, IsOptional, IsDateString, IsEmail, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBookingDto {
  @ApiProperty({ example: 'uuid-of-property' })
  @IsUUID()
  @IsNotEmpty()
  propertyId: string;

  @ApiProperty({ example: 'uuid-of-room' })
  @IsUUID()
  @IsNotEmpty()
  roomId: string;

  @ApiPropertyOptional({ example: 'uuid-of-guest' })
  @IsUUID()
  @IsOptional()
  guestId?: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  guestFirstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  guestLastName: string;

  @ApiPropertyOptional({ example: 'john.doe@example.com' })
  @IsEmail()
  @IsOptional()
  guestEmail?: string;

  @ApiPropertyOptional({ example: '+66-8-1234-5678' })
  @IsString()
  @IsOptional()
  guestPhone?: string;

  @ApiProperty({ example: '2026-03-01' })
  @IsDateString()
  @IsNotEmpty()
  checkIn: string;

  @ApiProperty({ example: '2026-03-05' })
  @IsDateString()
  @IsNotEmpty()
  checkOut: string;

  @ApiPropertyOptional({ example: 'confirmed' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 'Late check-in requested' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ example: 'uuid-of-channel' })
  @IsUUID()
  @IsOptional()
  channelId?: string;
}
