import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateHrLeaveTypeDto {
  @ApiProperty({ example: 'ลาพักร้อน' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Annual Leave' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameEn?: string;

  @ApiProperty({ example: 'ANNUAL', description: 'รหัสประเภทการลา' })
  @IsString()
  @MaxLength(30)
  code: string;

  @ApiPropertyOptional({ example: 15, description: 'จำนวนวันสูงสุดต่อปี (null = ไม่จำกัด)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxDaysPerYear?: number;

  @ApiPropertyOptional({ default: true, description: 'ได้รับเงินเดือนระหว่างลา' })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ default: false, description: 'ต้องแนบเอกสาร' })
  @IsOptional()
  @IsBoolean()
  requiresDoc?: boolean;

  @ApiPropertyOptional({ example: '#10B981', description: 'สี hex สำหรับ UI' })
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
