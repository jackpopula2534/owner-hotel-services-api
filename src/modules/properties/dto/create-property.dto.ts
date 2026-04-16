import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsBoolean,
  IsNumber,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePropertyDto {
  @ApiProperty({ example: 'Downtown Hotel' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'DT01' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({ example: '123 Main St, Bangkok' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 'Premium downtown location' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '+66-2-123-4567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'downtown@hotel.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: 'active' })
  @IsString()
  @IsOptional()
  status?: string;

  // --- Service Charge & Tax Settings ---

  @ApiPropertyOptional({ example: true, description: 'เปิดใช้ Service Charge' })
  @IsOptional()
  @IsBoolean()
  serviceChargeEnabled?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'เปอร์เซ็นต์ Service Charge (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  serviceChargePercent?: number;

  @ApiPropertyOptional({ example: true, description: 'เปิดใช้ VAT' })
  @IsOptional()
  @IsBoolean()
  vatEnabled?: boolean;

  @ApiPropertyOptional({ example: 7, description: 'เปอร์เซ็นต์ VAT (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  vatPercent?: number;

  @ApiPropertyOptional({
    enum: ['breakdown', 'included', 'net'],
    example: 'breakdown',
    description: 'วิธีแสดงราคา: breakdown=แยกบรรทัด, included=รวมในราคาห้อง, net=ราคาสุทธิ',
  })
  @IsOptional()
  @IsEnum(['breakdown', 'included', 'net'])
  taxDisplayMode?: 'breakdown' | 'included' | 'net';
}
