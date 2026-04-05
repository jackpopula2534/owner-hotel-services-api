import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RequestEarlyCheckInDto {
  @ApiPropertyOptional({
    description: 'Whether to approve the early check-in request immediately (manager/admin only)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  approve?: boolean;

  @ApiPropertyOptional({
    description: 'Optional note from guest or staff about the early check-in request',
    example: 'Flight arrives at 10:00 AM',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
