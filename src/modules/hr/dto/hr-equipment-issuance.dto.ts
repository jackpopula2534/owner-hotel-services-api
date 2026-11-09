import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class IssuedItemDto {
  @ApiProperty({ description: 'Index ของ item ใน checklist' })
  @IsInt()
  @Min(0)
  index: number;

  @ApiPropertyOptional({ description: 'Serial number ของอุปกรณ์ที่จ่าย' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  serialNo?: string;
}

export class IssueEquipmentDto {
  @ApiProperty({ type: [IssuedItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IssuedItemDto)
  items: IssuedItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class AcknowledgeIssuanceDto {
  @ApiPropertyOptional({ description: 'URL ลายเซ็นรับของ' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  signatureUrl?: string;
}

export class EditIssuedItemDto {
  @ApiProperty({ description: 'Index ของ item ใน checklist' })
  @IsInt()
  @Min(0)
  index: number;

  @ApiPropertyOptional({ description: 'Serial number ที่ต้องการแก้ (ส่ง "" เพื่อล้าง)' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  serialNo?: string;
}

/**
 * แก้ไขใบจ่ายของที่จ่ายไปแล้ว — ปรับ serial number / หมายเหตุ ของรายการที่ issued แล้ว
 * โดยไม่ตัดสต็อกซ้ำ และไม่เปลี่ยนสถานะใบ (ใช้แทนการกด "จ่ายของ" ซ้ำ).
 */
export class EditIssuanceDto {
  @ApiPropertyOptional({ type: [EditIssuedItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EditIssuedItemDto)
  items?: EditIssuedItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
