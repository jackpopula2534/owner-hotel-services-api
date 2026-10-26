import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateAddonQuotaDto {
  @ApiPropertyOptional({
    example: 790,
    description: 'ราคา add-on ต่อเดือน (บาท) — อัปเดต add_ons.price + features.price_monthly',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  priceMonthlyThb?: number;

  @ApiPropertyOptional({ example: 3, description: 'จำนวนครั้งที่รวมในแพ็กต่อเดือน' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  includedPerPeriod?: number;

  @ApiPropertyOptional({
    example: 79,
    description: 'ราคาต่อครั้งเมื่อเกินโควตา (บาท) — 0 = ไม่ขายส่วนเกิน',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  overageUnitPriceThb?: number;

  @ApiPropertyOptional({
    example: 20,
    nullable: true,
    description: 'เพดานส่วนเกินต่อเดือน — null = ไม่จำกัด',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(10_000)
  maxOveragePerPeriod?: number | null;

  @ApiPropertyOptional({ example: 14, description: 'จำนวนวันทดลองใช้เริ่มต้นตอนอนุมัติคำขอ' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  trialDays?: number;

  @ApiPropertyOptional({ example: 1, description: 'จำนวนครั้งที่ใช้ได้ตลอดช่วงทดลองใช้' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000)
  trialIncluded?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'จำนวนครั้งสูงสุดต่อ tenant ต่อนาที — 0 = ไม่จำกัด',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000)
  rateLimitPerMinute?: number;

  @ApiPropertyOptional({ example: true, description: 'งานล้มเหลวแล้วคืนโควตาอัตโนมัติ' })
  @IsOptional()
  @IsBoolean()
  refundOnFailure?: boolean;
}

export class AddonQuotaSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'เดือน YYYY-MM (UTC) — ค่าเริ่มต้นเดือนปัจจุบัน',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period?: string;
}
