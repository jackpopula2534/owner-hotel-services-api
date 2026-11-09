import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** ข้อมูลประกอบการเช็คอินหน้าเดียว — ทุกช่องไม่บังคับ (เรียกแบบไม่มี body ได้เหมือนเดิม) */
export class CheckInDto {
  @ApiPropertyOptional({ enum: ['passport', 'national_id'] })
  @IsOptional()
  @IsIn(['passport', 'national_id'])
  idDocumentType?: 'passport' | 'national_id';

  @ApiPropertyOptional({ description: 'เลขเอกสาร — บันทึกเข้าโปรไฟล์แขก' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  idNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @ApiPropertyOptional({ description: 'ยืนยันว่าตรวจบัตรตัวจริงแล้ว' })
  @IsOptional()
  @IsBoolean()
  idVerified?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  keyCards?: number;

  @ApiPropertyOptional({ description: 'เงินประกันความเสียหาย (บาท)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  depositAmount?: number;

  @ApiPropertyOptional({ enum: ['cash', 'qr', 'transfer', 'card_hold'] })
  @IsOptional()
  @IsIn(['cash', 'qr', 'transfer', 'card_hold'])
  depositMethod?: string;

  @ApiPropertyOptional({ description: 'เช็คอินก่อน ห้องยังไม่พร้อม — ไม่เปลี่ยนห้องเป็น occupied จนกว่าจะส่งมอบห้อง' })
  @IsOptional()
  @IsBoolean()
  awaitingRoom?: boolean;
}

export class HandOverRoomDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  keyCards?: number;
}
