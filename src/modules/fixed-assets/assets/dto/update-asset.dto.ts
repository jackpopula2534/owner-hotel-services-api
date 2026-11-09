import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** สถานะที่ตั้งเองได้ — DISPOSED/WRITTEN_OFF ต้องผ่านการจำหน่าย (ลงบัญชี) เท่านั้น */
export const EDITABLE_ASSET_STATUSES = ['ACTIVE', 'IDLE', 'UNDER_REPAIR'] as const;
export type EditableAssetStatus = (typeof EDITABLE_ASSET_STATUSES)[number];

/** ราคาทุน/อายุ/วิธีคิดค่าเสื่อม แก้ไม่ได้หลังบันทึก (กระทบค่าเสื่อมที่ลงบัญชีไปแล้ว) */
export class UpdateAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) serialNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() responsiblePerson?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() costCenterId?: string;
  @ApiPropertyOptional({ enum: EDITABLE_ASSET_STATUSES })
  @IsOptional()
  @IsIn(EDITABLE_ASSET_STATUSES)
  status?: EditableAssetStatus;
}
