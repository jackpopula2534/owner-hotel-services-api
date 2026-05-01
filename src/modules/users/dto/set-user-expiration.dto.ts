import { IsDateString, IsOptional, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetUserExpirationDto {
  /**
   * ISO 8601 datetime — null/undefined = ลบวันหมดอายุ (ใช้งานได้ไม่จำกัด)
   */
  @ApiPropertyOptional({
    description: 'วันที่บัญชีหมดอายุ (ISO 8601). ส่ง null เพื่อยกเลิกวันหมดอายุ',
    example: '2026-12-31T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString({}, { message: 'expiresAt ต้องเป็น ISO 8601 datetime หรือ null' })
  expiresAt?: string | null;
}
