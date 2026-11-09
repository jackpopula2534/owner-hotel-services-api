import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Public QR-ordering guest check (audit 2026-11-09 M1).
 * Exact first + last name AND the last 4 digits of the phone on file — a
 * partial name is no longer enough, so the endpoint cannot be used to list
 * who is staying at the hotel. National ID stays disabled (PDPA minimisation).
 */
export class GuestLookupDto {
  @ApiProperty({ example: 'Sompong' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Jaidee' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: '5678', description: 'Last 4 digits of the phone number on file' })
  @Matches(/^\d{4}$/, { message: 'phoneLast4 must be exactly 4 digits' })
  phoneLast4: string;
}
