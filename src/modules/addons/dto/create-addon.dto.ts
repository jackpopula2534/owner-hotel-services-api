import {
  IsArray,
  IsBoolean,
  IsEnum,
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
