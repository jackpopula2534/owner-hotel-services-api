import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsArray,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── KPI Score per criteria ────────────────────────────────────────────────────

export class KpiScoreInputDto {
  @ApiProperty({ description: 'Criteria Item ID (FK → HrKpiTemplateItem)', example: 'uuid' })
  @IsString()
  @IsNotEmpty()
  criteriaId: string;

  @ApiProperty({ description: 'คะแนน (1-5 ตาม scale ของ template)', example: 4 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  score: number;

  @ApiPropertyOptional({ description: 'ความเห็นต่อ criteria นี้' })
  @IsOptional()
  @IsString()
  comment?: string;
}

// ─── Save Draft / Update performance ─────────────────────────────────────────

export class SavePerformanceDraftDto {
  @ApiProperty({
    description: 'คะแนนต่อแต่ละ KPI criteria',
    type: [KpiScoreInputDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KpiScoreInputDto)
  scores: KpiScoreInputDto[];

  @ApiPropertyOptional({ description: 'จุดแข็ง / ความสำเร็จ' })
  @IsOptional()
  @IsString()
  strengths?: string;

  @ApiPropertyOptional({ description: 'จุดที่ต้องพัฒนา' })
  @IsOptional()
  @IsString()
  improvements?: string;

  @ApiPropertyOptional({ description: 'เป้าหมายรอบถัดไป' })
  @IsOptional()
  @IsString()
  goals?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุภายใน' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'ชื่อผู้ประเมิน' })
  @IsOptional()
  @IsString()
  reviewerName?: string;
}

// ─── Approval / Rejection ─────────────────────────────────────────────────────

export class RejectPerformanceDto {
  @ApiProperty({ description: 'เหตุผลที่ reject (บังคับระบุ)', example: 'คะแนนบางรายการไม่ครบถ้วน' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class BulkApproveDto {
  @ApiProperty({
    description: 'รายการ Performance ID ที่ต้องการ approve พร้อมกัน',
    type: [String],
    example: ['uuid-1', 'uuid-2'],
  })
  @IsArray()
  ids: string[];

  @ApiPropertyOptional({ description: 'หมายเหตุ (optional)' })
  @IsOptional()
  @IsString()
  comment?: string;
}
