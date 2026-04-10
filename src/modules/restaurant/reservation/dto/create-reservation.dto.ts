import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsEmail,
  IsDateString,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReservationDto {
  @ApiProperty({ example: 'uuid-table-id' })
  @IsString()
  @IsNotEmpty()
  tableId: string;

  @ApiProperty({ example: 'John Smith' })
  @IsString()
  @IsNotEmpty()
  guestName: string;

  @ApiPropertyOptional({ example: '+66-81-234-5678' })
  @IsString()
  @IsOptional()
  guestPhone?: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsEmail()
  @IsOptional()
  guestEmail?: string;

  @ApiProperty({ example: 2, description: 'Number of guests' })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  partySize: number;

  @ApiProperty({ example: '2026-04-15', description: 'Reservation date (YYYY-MM-DD)' })
  @IsDateString()
  reservationDate: string;

  @ApiProperty({ example: '19:00', description: 'Start time (HH:mm)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'startTime must be HH:mm format' })
  startTime: string;

  @ApiPropertyOptional({ example: '21:00' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'endTime must be HH:mm format' })
  endTime?: string;

  @ApiPropertyOptional({ example: 'Window seat preferred, celebrating anniversary' })
  @IsString()
  @IsOptional()
  specialRequests?: string;

  @ApiPropertyOptional({ example: 'VIP guest' })
  @IsString()
  @IsOptional()
  notes?: string;
}
