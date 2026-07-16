import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum AddonBillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  ONE_TIME = 'one_time',
}

/**
 * ค่าที่ `add_ons.system` รับได้ (product line ของโมดูล)
 * HOTEL = ขายเฉพาะธุรกิจโรงแรม, CAMP = เฉพาะลานกางเต็นท์, BOTH = ขายได้ทั้งสอง
 * นิยามไว้ที่ DTO เพราะเป็น leaf module — `AddonService` re-export ต่อเป็น ADDON_SYSTEMS
 */
export const ADDON_SYSTEM_VALUES = ['HOTEL', 'CAMP', 'BOTH'] as const;

/**
 * DTO สำหรับสร้าง Add-on ใหม่จากหน้า Admin Panel
 */
export class CreateAddonDto {
  @ApiProperty({ example: 'BASIC_REPORT', description: 'รหัสไม่ซ้ำกันของ Add-on (UPPER_SNAKE)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be UPPER_SNAKE_CASE (A-Z, 0-9, _)',
  })
  code!: string;

  @ApiProperty({ example: 'Basic Report' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ example: 'รายงานพื้นฐานสำหรับติดตามยอดและการจอง' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 500, minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price must be a number with up to 2 decimals' })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ enum: AddonBillingCycle, default: AddonBillingCycle.MONTHLY })
  @IsEnum(AddonBillingCycle)
  @IsOptional()
  billingCycle?: AddonBillingCycle;

  @ApiPropertyOptional({ example: 'reports' })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  category?: string;

  /**
   * สายธุรกิจที่ขายโมดูลนี้ — โรงแรม (HOTEL), ลานกางเต็นท์ (CAMP) หรือขายได้ทั้งสอง (BOTH)
   * ต้องเป็น 1 ใน 3 ค่านี้เท่านั้น: ค่าที่พิมพ์ผิดจะทำให้โมดูลหลุดจาก catalog ของทั้งสองสาย
   */
  @ApiPropertyOptional({
    enum: ADDON_SYSTEM_VALUES,
    default: 'BOTH',
    description: 'Product line: HOTEL | CAMP | BOTH (which business this module is sold for)',
  })
  @IsIn(ADDON_SYSTEM_VALUES, { message: `system must be one of: ${ADDON_SYSTEM_VALUES.join(', ')}` })
  @IsOptional()
  system?: string;

  @ApiPropertyOptional({ example: 'bar-chart', description: 'ชื่อ icon (lucide-react)' })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  icon?: string;

  @ApiPropertyOptional({ example: 1, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  minQuantity?: number;

  @ApiPropertyOptional({ example: 10, default: 1, minimum: 1, maximum: 9999 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  @IsOptional()
  maxQuantity?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: true,
    default: false,
    description: 'true = add-on นี้เป็น Sub System (Terminal) แสดงในหน้าระบบย่อย',
  })
  @IsBoolean()
  @IsOptional()
  isSubSystem?: boolean;

  @ApiPropertyOptional({
    type: 'array',
    description:
      'metadata การ์ดสำหรับหน้า Sub Systems (1 add-on แสดงได้หลายการ์ด) — ' +
      '{ key, subtitle, tags[], color, badge?, launchPath, launchEndpoint, loginEndpoint, name?, description?, icon? }',
  })
  @IsArray()
  @IsOptional()
  subSystemMeta?: SubSystemCardMeta[];
}

/** metadata การ์ด Sub System ที่เก็บใน add_ons.sub_system_meta (JSON) */
export interface SubSystemCardMeta {
  key: string;
  subtitle: string;
  tags: string[];
  color: string;
  launchPath: string;
  launchEndpoint: string;
  loginEndpoint: string;
  badge?: string;
  /** override ชื่อ/คำอธิบาย/ไอคอน จาก add-on (กรณี add-on เดียวมีหลายการ์ด) */
  name?: string;
  description?: string;
  icon?: string;
  displayOrder?: number;
}
