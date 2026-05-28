import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum AccountTypeEnum {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  EXPENSE = 'EXPENSE',
}

export enum NormalBalanceEnum {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum AccountLevelEnum {
  CATEGORY = 'CATEGORY',
  GROUP = 'GROUP',
  ACCOUNT = 'ACCOUNT',
  SUB_ACCOUNT = 'SUB_ACCOUNT',
}

export class CreateAccountDto {
  @ApiProperty({ description: 'รหัสบัญชี เช่น 1101', example: '1101' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({ description: 'ชื่อบัญชี (ไทย)', example: 'เงินสด' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'ชื่อบัญชี (English)', example: 'Cash' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiProperty({ description: 'ประเภทบัญชีหลัก', enum: AccountTypeEnum })
  @IsNotEmpty()
  @IsEnum(AccountTypeEnum)
  type: AccountTypeEnum;

  @ApiPropertyOptional({ description: 'ประเภทย่อย', example: 'current_asset' })
  @IsOptional()
  @IsString()
  subType?: string;

  @ApiProperty({ description: 'ด้านปกติของบัญชี', enum: NormalBalanceEnum })
  @IsNotEmpty()
  @IsEnum(NormalBalanceEnum)
  normalBalance: NormalBalanceEnum;

  @ApiPropertyOptional({ description: 'ระดับผังบัญชี', enum: AccountLevelEnum, default: AccountLevelEnum.ACCOUNT })
  @IsOptional()
  @IsEnum(AccountLevelEnum)
  level?: AccountLevelEnum;

  @ApiPropertyOptional({ description: 'บัญชีแม่ (hierarchy)', example: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'เป็น Control Account หรือไม่', default: false })
  @IsOptional()
  @IsBoolean()
  isControl?: boolean;

  @ApiPropertyOptional({ description: 'ห้ามบันทึกรายการโดยตรง (header only)', default: false })
  @IsOptional()
  @IsBoolean()
  isHeaderOnly?: boolean;

  @ApiPropertyOptional({ description: 'รหัสงบการเงิน (BS/PL mapping)', example: 'BS-CA' })
  @IsOptional()
  @IsString()
  fsCode?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุ' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Cost Center ที่เชื่อมโยง' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'ลำดับการแสดงผล', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;
}
