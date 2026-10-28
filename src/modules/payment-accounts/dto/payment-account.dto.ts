import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export type PaymentAccountKind = 'promptpay' | 'bank' | 'qr_image';

export const PAYMENT_ACCOUNT_KINDS: PaymentAccountKind[] = ['promptpay', 'bank', 'qr_image'];

// ─────────────────────────────────────────────────────────────────────────────
// Create DTO
// kind === 'promptpay' → ต้องมี promptpayId (และ accountName recommended)
// kind === 'bank'      → ต้องมี bankCode + accountNumber + accountName
// kind === 'qr_image'  → ต้องมี qrImageUrl + accountName (รูป QR คงที่ ไม่มียอดในตัว)
// ─────────────────────────────────────────────────────────────────────────────
export class CreatePaymentAccountDto {
  @ApiProperty({
    description: 'Channel kind',
    enum: PAYMENT_ACCOUNT_KINDS,
    example: 'promptpay',
  })
  @IsIn(PAYMENT_ACCOUNT_KINDS)
  kind: PaymentAccountKind;

  @ApiPropertyOptional({ description: 'ป้ายแสดงผล (ไม่บังคับ)', example: 'บัญชีหลัก สาขากรุงเทพ' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({
    description: 'หมายเลข PromptPay — ต้องเป็นเบอร์โทร 10 หลัก หรือเลข ปชช. 13 หลัก',
    example: '0812345678',
  })
  @ValidateIf((o: CreatePaymentAccountDto) => o.kind === 'promptpay')
  @IsString()
  @Matches(/^(0\d{9}|\d{13})$/, {
    message: 'PromptPay ID ต้องเป็นเบอร์มือถือ 10 หลัก หรือ เลขบัตรประชาชน 13 หลัก',
  })
  @MaxLength(20)
  promptpayId?: string;

  @ApiPropertyOptional({ description: 'รหัสธนาคาร เช่น KBANK, SCB', example: 'KBANK' })
  @ValidateIf((o: CreatePaymentAccountDto) => o.kind === 'bank')
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  bankCode?: string;

  @ApiPropertyOptional({
    description: 'เลขบัญชีธนาคาร (ตัวเลข 8-15 หลัก) — kind=qr_image ใส่ได้แค่ 4 ตัวท้าย (ไม่บังคับ)',
    example: '1234567890',
  })
  @ValidateIf((o: CreatePaymentAccountDto) => o.kind === 'bank')
  @IsString()
  @Matches(/^\d{8,15}$/, { message: 'เลขบัญชีต้องเป็นตัวเลข 8-15 หลัก' })
  accountNumber?: string;

  @ApiPropertyOptional({ description: 'URL รูป QR ที่อัปโหลด (kind=qr_image)' })
  @ValidateIf((o: CreatePaymentAccountDto) => o.kind === 'qr_image')
  @IsString()
  @MaxLength(500)
  qrImageUrl?: string;

  @ApiPropertyOptional({ description: 'ที่มาของ QR เช่น K SHOP, แม่มณี (kind=qr_image)', example: 'K SHOP' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  qrProvider?: string;

  @ApiProperty({ description: 'ชื่อบัญชี', example: 'นายสมชาย ใจดี' })
  @IsString()
  @MaxLength(200)
  accountName: string;

  @ApiPropertyOptional({ description: 'สาขา', example: 'สยามสแควร์' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branch?: string;

  @ApiPropertyOptional({ description: 'ตั้งเป็นบัญชีหลัก (default ต่อ kind)', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'เปิดใช้งาน', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'ลำดับการแสดงผล', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

// PartialType so ทุกฟิลด์ optional แต่ retain validators เดิม
export class UpdatePaymentAccountDto extends PartialType(CreatePaymentAccountDto) {}
