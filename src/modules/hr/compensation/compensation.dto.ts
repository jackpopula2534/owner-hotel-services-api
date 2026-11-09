import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class AdjustCompensationDto {
  @ApiProperty() @IsUUID() employeeId: string;

  @ApiProperty({ description: 'วันที่มีผล (YYYY-MM-DD) — แนะนำวันแรกของรอบเงินเดือน' })
  @IsDateString()
  effectiveDate: string;

  @ApiProperty({ description: 'เงินเดือนพื้นฐาน (บาท/เดือน)' })
  @IsNumber()
  @Min(0)
  baseSalary: number;
  @ApiPropertyOptional({ description: 'ค่าตำแหน่ง (บาท/เดือน)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  positionBonus?: number;
  @ApiPropertyOptional({ description: 'เบี้ยเลี้ยงประจำ (บาท/เดือน)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  allowance?: number;

  @ApiPropertyOptional({ enum: ['MANUAL_ADJUST', 'PROMOTION', 'CORRECTION'] })
  @IsOptional()
  @IsIn(['MANUAL_ADJUST', 'PROMOTION', 'CORRECTION'])
  changeType?: 'MANUAL_ADJUST' | 'PROMOTION' | 'CORRECTION';

  @ApiProperty({ description: 'เหตุผล (บังคับ)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class CancelCompensationChangeDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(1000) reason: string;
}

/** ค่าตอบแทนที่ HR แก้ตอนตัดสินผ่านทดลองงาน (ไม่ส่ง = ใช้ตามข้อเสนอจ้าง) */
export class ProbationCompensationOverrideDto {
  @ApiProperty() @IsNumber() @Min(0) baseSalary: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) positionBonus?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) allowance?: number;
  @ApiProperty({ description: 'เหตุผลที่ต่างจากข้อเสนอจ้าง' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
