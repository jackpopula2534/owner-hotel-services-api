import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTimeSettingsDto {
  @ApiPropertyOptional({
    description: 'Standard check-in time in HH:mm format',
    example: '14:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'standardCheckInTime must be in HH:mm format' })
  standardCheckInTime?: string;

  @ApiPropertyOptional({
    description: 'Standard check-out time in HH:mm format',
    example: '12:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'standardCheckOutTime must be in HH:mm format' })
  standardCheckOutTime?: string;

  @ApiPropertyOptional({
    description: 'Cleaning buffer in minutes after checkout before room is ready',
    example: 60,
    minimum: 0,
    maximum: 480,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(480)
  cleaningBufferMinutes?: number;

  @ApiPropertyOptional({ description: 'Enable early check-in option', example: true })
  @IsOptional()
  @IsBoolean()
  earlyCheckInEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Enable late check-out option', example: true })
  @IsOptional()
  @IsBoolean()
  lateCheckOutEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Early check-in fee type',
    enum: ['fixed', 'percentage'],
    example: 'fixed',
  })
  @IsOptional()
  @IsString()
  @IsIn(['fixed', 'percentage'])
  earlyCheckInFeeType?: string;

  @ApiPropertyOptional({
    description: 'Early check-in fee amount (THB for fixed, percent for percentage)',
    example: 500,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  earlyCheckInFeeAmount?: number;

  @ApiPropertyOptional({
    description: 'Late check-out fee type',
    enum: ['fixed', 'percentage'],
    example: 'fixed',
  })
  @IsOptional()
  @IsString()
  @IsIn(['fixed', 'percentage'])
  lateCheckOutFeeType?: string;

  @ApiPropertyOptional({
    description: 'Late check-out fee amount (THB for fixed, percent for percentage)',
    example: 500,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lateCheckOutFeeAmount?: number;

  @ApiPropertyOptional({
    description: 'Property timezone (IANA format)',
    example: 'Asia/Bangkok',
  })
  @IsOptional()
  @IsString()
  timezone?: string;
}
