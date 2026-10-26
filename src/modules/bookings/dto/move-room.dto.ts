import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MoveRoomDto {
  @ApiProperty({ description: 'ห้องปลายทาง (โรงแรมเดียวกัน)' })
  @IsString()
  @MaxLength(191)
  roomId!: string;

  @ApiPropertyOptional({ description: 'เหตุผลการย้าย เช่น แอร์เสีย / อัปเกรด', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
