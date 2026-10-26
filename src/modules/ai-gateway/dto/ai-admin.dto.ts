import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AI_PROVIDERS } from '../ai-gateway.constants';

export class UpdateAiProviderDto {
  @ApiPropertyOptional({ description: 'คีย์ใหม่ (write-only — ไม่ถูกส่งกลับ)' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: '{ [task]: { model, inputPer1M?, outputPer1M?, perUnit? } }',
    example: { vision: { model: 'gpt-5-mini', inputPer1M: 0.25, outputPer1M: 2 } },
  })
  @IsOptional()
  @IsObject()
  models?: Record<string, unknown>;
}

export class UpdateAiSettingsDto {
  @ApiPropertyOptional({ description: 'งบรวมทั้งแพลตฟอร์มต่อเดือน (USD) 0 = ไม่จำกัด' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  monthlyBudgetUsd?: number;

  @ApiPropertyOptional({ description: 'ตัดการเรียก AI อัตโนมัติเมื่อใช้ครบงบ' })
  @IsOptional()
  @IsBoolean()
  hardStopOnBudget?: boolean;

  @ApiPropertyOptional({ description: 'แจ้งเตือนเมื่อใช้ถึง % ของงบ' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  alertThresholdPct?: number;

  @ApiPropertyOptional({ description: 'อัตราแปลง USD → THB สำหรับรายงาน' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Max(1000)
  usdToThb?: number;
}

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class AiUsageSummaryQueryDto {
  @ApiPropertyOptional({ example: '2026-10', description: 'เดือน YYYY-MM (เวลาไทย) ค่าเริ่มต้น = เดือนนี้' })
  @IsOptional()
  @Matches(PERIOD_PATTERN, { message: 'period must be YYYY-MM' })
  period?: string;
}

export class AiUsageLogsQueryDto extends AiUsageSummaryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: AI_PROVIDERS })
  @IsOptional()
  @IsIn(AI_PROVIDERS)
  provider?: string;

  @ApiPropertyOptional({ enum: ['success', 'failed', 'blocked'] })
  @IsOptional()
  @IsIn(['success', 'failed', 'blocked'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  feature?: string;
}
