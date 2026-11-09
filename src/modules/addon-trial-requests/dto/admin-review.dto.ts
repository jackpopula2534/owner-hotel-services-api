import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsInt, Min, Max } from 'class-validator';

export class AdminReviewTrialRequestDto {
  @ApiPropertyOptional({ example: 'อนุมัติแล้ว ทดลองได้ 14 วัน', description: 'หมายเหตุจาก Admin' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;

  /** จำนวนวันที่จะให้ทดลอง (สำหรับ approve) default = 14 วัน */
  @ApiPropertyOptional({ example: 14, description: 'จำนวนวันทดลองใช้ (approve เท่านั้น)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  trialDays?: number;
}
