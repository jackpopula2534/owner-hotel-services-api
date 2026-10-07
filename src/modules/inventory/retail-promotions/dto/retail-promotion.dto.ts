import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RetailPromoDiscountType, RetailPromotionStatus } from '@prisma/client';
import { CreateRetailSaleLineDto } from '../../retail-sales/dto/create-retail-sale.dto';

/** ตัวอักษร/ตัวเลข/ขีด — พิมพ์ที่เคาน์เตอร์ได้ ไม่สับสน */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;

export class PromotionGiftInputDto {
  @ApiProperty({ description: 'InventoryItem id ที่แจก' })
  @IsString()
  itemId: string;

  @ApiProperty({ description: 'จำนวนที่แจกต่อการใช้ 1 ครั้ง', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: 'งบจำนวนชิ้นของโปรนี้ (ไม่ใส่ = เท่าที่คลังของแถมมี)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  budgetQty?: number | null;
}

export class CreateRetailPromotionDto {
  @ApiProperty({ example: 'ซื้อครบ 500 ลด 10%' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: RetailPromotionStatus, default: RetailPromotionStatus.DRAFT })
  @IsOptional()
  @IsEnum(RetailPromotionStatus)
  status?: RetailPromotionStatus;

  @ApiProperty({ enum: RetailPromoDiscountType })
  @IsEnum(RetailPromoDiscountType)
  discountType: RetailPromoDiscountType;

  @ApiPropertyOptional({ description: 'PERCENT: 0-100 · FIXED: บาท', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({ description: 'เพดานส่วนลด (PERCENT)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number | null;

  @ApiPropertyOptional({ description: 'ยอดซื้อขั้นต่ำ', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minSpend?: number;

  @ApiPropertyOptional({ type: [String], description: 'สินค้าที่ร่วมรายการ (ว่าง = ทุกสินค้า)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  eligibleItemIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Loyalty tier ที่มีสิทธิ์ (ว่าง = ทุก tier)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleTiers?: string[];

  @ApiPropertyOptional({ type: [String], description: 'CRM segment ที่มีสิทธิ์ (ว่าง = ทุก segment)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleSegments?: string[];

  @ApiPropertyOptional({ description: 'คลังของแถม (Warehouse type PROMOTION) — ต้องมีถ้ามีของแถม' })
  @IsOptional()
  @IsString()
  giftWarehouseId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @ApiPropertyOptional({ description: 'โควตาใช้รวม (ไม่ใส่ = ไม่จำกัด)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @ApiPropertyOptional({ description: 'โควตาต่อสมาชิก (ไม่ใส่ = ไม่จำกัด)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  perMemberLimit?: number | null;

  @ApiPropertyOptional({ description: 'แจกอัตโนมัติเมื่อบิลเข้าเงื่อนไข ไม่ต้องใช้โค้ด (เฉพาะโปรของแถมล้วน)', default: false })
  @IsOptional()
  @IsBoolean()
  autoApply?: boolean;

  @ApiPropertyOptional({ description: 'ใช้ร่วมกับโปรอื่นในบิลเดียวกันได้', default: true })
  @IsOptional()
  @IsBoolean()
  stackable?: boolean;

  @ApiPropertyOptional({ description: 'แต้มที่สมาชิกใช้แลกเป็นโค้ดของโปรนี้ (ไม่ใส่ = แลกไม่ได้)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  pointsCost?: number | null;

  @ApiPropertyOptional({ type: [PromotionGiftInputDto], description: 'ของแถม — ส่งมาแทนที่รายการเดิมทั้งชุด' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PromotionGiftInputDto)
  gifts?: PromotionGiftInputDto[];
}

export class UpdateRetailPromotionDto extends PartialType(CreateRetailPromotionDto) {}

export class CreatePromoCodeDto {
  @ApiProperty({ example: 'SUMMER10' })
  @IsString()
  @Matches(CODE_PATTERN, { message: 'โค้ดต้องเป็นตัวอักษร/ตัวเลข/ขีด 3-40 ตัว' })
  code: string;

  @ApiPropertyOptional({ description: 'จำนวนครั้งที่ใช้ได้ (ไม่ใส่ = ไม่จำกัด)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({ description: 'ออกให้สมาชิก (Guest) คนนี้เท่านั้น' })
  @IsOptional()
  @IsString()
  issuedToGuestId?: string | null;
}

export class GeneratePromoCodesDto {
  @ApiProperty({ minimum: 1, maximum: 500 })
  @IsInt()
  @Min(1)
  @Max(500)
  count: number;

  @ApiPropertyOptional({ example: 'VIP', description: 'คำนำหน้าโค้ด' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{0,10}$/, { message: 'คำนำหน้าต้องเป็นตัวอักษร/ตัวเลข ไม่เกิน 10 ตัว' })
  prefix?: string;

  @ApiPropertyOptional({ description: 'ใช้ได้กี่ครั้งต่อโค้ด', default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class UpdatePromoCodeDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean;
}

export class PreviewPromotionDto {
  @ApiProperty({ example: 'SUMMER10' })
  @IsString()
  @MaxLength(40)
  code: string;

  @ApiProperty({ description: 'สมาชิก (Guest id) — ต้องผูกสมาชิกทุกครั้งที่ใช้โค้ด' })
  @IsString()
  memberGuestId: string;

  @ApiProperty({ type: [CreateRetailSaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRetailSaleLineDto)
  lines: CreateRetailSaleLineDto[];
}

/** ตรวจโปรทั้งบิลที่ POS: โค้ด (ถ้ามี) + โปรอัตโนมัติ ตามกติกาใช้ร่วม */
export class PreviewCheckoutDto {
  @ApiPropertyOptional({ example: 'SUMMER10' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional({ description: 'สมาชิก (Guest id) — บังคับเมื่อใส่โค้ด / โปรอัตโนมัติที่จำกัดสิทธิ์' })
  @IsOptional()
  @IsString()
  memberGuestId?: string;

  @ApiProperty({ type: [CreateRetailSaleLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateRetailSaleLineDto)
  lines: CreateRetailSaleLineDto[];
}

export class RedeemPointsForCodeDto {
  @ApiProperty({ description: 'สมาชิก (Guest id) ที่แลกแต้ม' })
  @IsString()
  memberGuestId: string;
}

export class RegisterMemberDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: '0812345678' })
  @IsString()
  @Matches(/^[0-9+\-\s]{9,20}$/, { message: 'เบอร์โทรไม่ถูกต้อง' })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: 'ลูกค้ายินยอมให้เก็บข้อมูลตาม PDPA' })
  @Equals(true, { message: 'ต้องได้รับความยินยอมจากลูกค้าก่อนสมัครสมาชิก' })
  consentGiven: boolean;
}
