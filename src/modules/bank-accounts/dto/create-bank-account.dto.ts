import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({ example: 'ธนาคารกสิกรไทย', description: 'ชื่อธนาคาร' })
  @IsString()
  @MaxLength(100)
  bankName: string;

  @ApiProperty({ example: 'KBANK', description: 'รหัสธนาคาร (SWIFT/สั้น)' })
  @IsString()
  @MaxLength(20)
  bankCode: string;

  @ApiProperty({ example: 'บริษัท สเตย์ซิงค์ จำกัด', description: 'ชื่อบัญชี' })
  @IsString()
  @MaxLength(200)
  accountName: string;

  @ApiProperty({ example: '123-4-56789-0', description: 'เลขที่บัญชี' })
  @IsString()
  @MaxLength(20)
  accountNumber: string;

  @ApiPropertyOptional({ example: 'สาขาสีลม', description: 'สาขา' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  branch?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/banks/kbank.png',
    description: 'URL โลโก้ธนาคาร',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional({ default: true, description: 'เปิดใช้งาน' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false, description: 'บัญชีหลัก' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'ลำดับการแสดง' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
