import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RequestLateCheckOutDto {
  @ApiPropertyOptional({
    description: 'Whether to approve the late check-out request immediately (manager/admin only)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  approve?: boolean;

  @ApiPropertyOptional({
    description: 'Optional note from guest or staff about the late check-out request',
    example: 'Meeting at 2:00 PM, need room until 14:00',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
