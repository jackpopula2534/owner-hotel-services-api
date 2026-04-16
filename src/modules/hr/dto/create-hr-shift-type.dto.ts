import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsInt, Min, MaxLength, Matches } from 'class-validator';

export class CreateHrShiftTypeDto {
  @ApiProperty({ example: 'กะเช้า' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Morning Shift' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  @ApiProperty({ example: 'MORNING' })
  @IsString()
  @MaxLength(30)
  code: string;

  @ApiProperty({ example: '07:00', description: 'เวลาเริ่มงาน (HH:mm)' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'startTime ต้องเป็นรูปแบบ HH:mm' })
  startTime: string;

  @ApiProperty({ example: '15:00', description: 'เวลาเลิกงาน (HH:mm)' })
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'endTime ต้องเป็นรูปแบบ HH:mm' })
  endTime: string;

  @ApiPropertyOptional({ example: 60, description: 'เวลาพักกี่นาที' })
  @IsOptional()
  @IsInt()
  @Min(0)
  breakMinutes?: number;

  @ApiPropertyOptional({ example: '#F59E0B' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
