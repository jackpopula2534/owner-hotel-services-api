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
