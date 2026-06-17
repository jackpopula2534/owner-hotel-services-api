import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsArray,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export const WORK_PATTERNS = ['MON_FRI', 'MON_SAT', 'CUSTOM', 'FLEXIBLE'] as const;
export type WorkPattern = (typeof WORK_PATTERNS)[number];

export class CreateHrDepartmentWorkPolicyDto {
  @ApiProperty({ description: 'รหัสแผนกที่ผูกนโยบาย' })
  @IsString()
  departmentId: string;

  @ApiProperty({
    enum: WORK_PATTERNS,
    example: 'MON_FRI',
    description: 'รูปแบบการทำงาน: MON_FRI=จ-ศ, MON_SAT=จ-ส, CUSTOM=กำหนดเอง, FLEXIBLE=ยืดหยุ่น',
  })
  @IsString()
  @IsIn(WORK_PATTERNS as unknown as string[])
  pattern: WorkPattern;

  @ApiPropertyOptional({
    type: [Number],
    example: [0, 6],
    description: 'วันหยุดประจำสัปดาห์ (0=อาทิตย์ ... 6=เสาร์)',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  offDays?: number[];

  @ApiPropertyOptional({
    default: true,
    description: 'true = ห้ามลงกะทำงานในวันหยุดที่กำหนด, false = ยืดหยุ่น',
  })
  @IsOptional()
  @IsBoolean()
  enforceOffDays?: boolean;

  @ApiPropertyOptional({ description: 'กะเริ่มต้นของแผนก (ถ้ามี)' })
  @IsOptional()
  @IsString()
  defaultShiftTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
