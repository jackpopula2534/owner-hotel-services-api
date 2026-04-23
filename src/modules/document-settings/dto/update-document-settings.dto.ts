import {
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  IsIn,
  IsNumber,
  MaxLength,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDocumentSettingsDto {
  // ── Company / Header Info ──
  @ApiPropertyOptional({ description: 'ชื่อบริษัท (ภาษาไทย)', example: 'บริษัท โรงแรมภูเขา จำกัด' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyName?: string;

  @ApiPropertyOptional({ description: 'ชื่อบริษัท (English)', example: 'Mountain View Resort Co., Ltd.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyNameEn?: string;

  @ApiPropertyOptional({ description: 'เลขประจำตัวผู้เสียภาษี', example: '0105563012345' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  @ApiPropertyOptional({ description: 'สำนักงานใหญ่ / สาขา', example: 'สำนักงานใหญ่' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  branchName?: string;

  @ApiPropertyOptional({ description: 'เลขที่สาขา', example: '00000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  branchNumber?: string;

  @ApiPropertyOptional({ description: 'ที่อยู่บริษัท (ภาษาไทย)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ description: 'ที่อยู่บริษัท (English)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressEn?: string;

  @ApiPropertyOptional({
    description: 'ที่อยู่จัดส่ง (ภาษาไทย) — ใช้เป็น default ship-to ใน PO',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  shippingAddress?: string;

  @ApiPropertyOptional({
    description: 'ที่อยู่จัดส่ง (English) — default ship-to address for PO',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  shippingAddressEn?: string;

  @ApiPropertyOptional({ description: 'เบอร์โทร', example: '02-123-4567' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ description: 'เบอร์แฟกซ์', example: '02-123-4568' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  fax?: string;

  @ApiPropertyOptional({ description: 'อีเมล', example: 'info@hotel.com' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'เว็บไซต์', example: 'https://hotel.com' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  // ── Logo ──
  @ApiPropertyOptional({ description: 'ความกว้าง Logo (mm) ใน PDF', example: 40 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  logoWidth?: number;

  @ApiPropertyOptional({ description: 'ความสูง Logo (mm) ใน PDF', example: 40 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  logoHeight?: number;

  @ApiPropertyOptional({ description: 'ตำแหน่งเยื้องแนวนอน (mm)', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(-30)
  @Max(30)
  logoOffsetX?: number;

  @ApiPropertyOptional({ description: 'ตำแหน่งเยื้องแนวตั้ง (mm)', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(-30)
  @Max(30)
  logoOffsetY?: number;

  @ApiPropertyOptional({ description: 'ตำแหน่ง Logo', enum: ['left', 'center', 'right'] })
  @IsOptional()
  @IsString()
  @IsIn(['left', 'center', 'right'])
  logoPosition?: string;

  @ApiPropertyOptional({ description: 'สไตล์กรอบ Logo', enum: ['plain', 'framed'] })
  @IsOptional()
  @IsString()
  @IsIn(['plain', 'framed'])
  logoFrameStyle?: string;

  @ApiPropertyOptional({ description: 'การจัดตำแหน่งแนวตั้ง Logo', enum: ['top', 'center', 'bottom'] })
  @IsOptional()
  @IsString()
  @IsIn(['top', 'center', 'bottom'])
  logoVerticalAlign?: string;

  // ── Bank Info ──
  @ApiPropertyOptional({ description: 'ชื่อธนาคาร', example: 'ธนาคารกสิกรไทย' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ description: 'สาขาธนาคาร', example: 'สาขาสีลม' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankBranch?: string;

  @ApiPropertyOptional({ description: 'ชื่อบัญชี', example: 'บริษัท โรงแรมภูเขา จำกัด' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankAccountName?: string;

  @ApiPropertyOptional({ description: 'เลขที่บัญชี', example: '123-4-56789-0' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankAccountNumber?: string;

  // ── Appearance ──
  @ApiPropertyOptional({ description: 'สี Header หลัก (hex)', example: '#7C3AED' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'primaryColor ต้องเป็น hex color เช่น #7C3AED' })
  primaryColor?: string;

  @ApiPropertyOptional({ description: 'แสดง Logo' })
  @IsOptional()
  @IsBoolean()
  showLogo?: boolean;

  @ApiPropertyOptional({ description: 'แสดงชื่อบริษัท' })
  @IsOptional()
  @IsBoolean()
  showCompanyName?: boolean;

  @ApiPropertyOptional({ description: 'แสดงเลขประจำตัวผู้เสียภาษี' })
  @IsOptional()
  @IsBoolean()
  showTaxId?: boolean;

  @ApiPropertyOptional({ description: 'แสดงที่อยู่' })
  @IsOptional()
  @IsBoolean()
  showAddress?: boolean;

  @ApiPropertyOptional({ description: 'แสดงเบอร์โทร' })
  @IsOptional()
  @IsBoolean()
  showPhone?: boolean;

  @ApiPropertyOptional({ description: 'แสดงข้อมูลธนาคาร' })
  @IsOptional()
  @IsBoolean()
  showBankInfo?: boolean;

  @ApiPropertyOptional({ description: 'แสดงช่องลายเซ็น' })
  @IsOptional()
  @IsBoolean()
  showSignatureLine?: boolean;

  // ── PO-specific ──
  @ApiPropertyOptional({ description: 'เงื่อนไขใน PO' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  poTermsAndConditions?: string;

  @ApiPropertyOptional({ description: 'หมายเหตุท้าย PO' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  poFooterNote?: string;
}
