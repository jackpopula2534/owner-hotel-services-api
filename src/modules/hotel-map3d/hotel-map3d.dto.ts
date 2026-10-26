import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class SaveHotelMap3dDto {
  @ApiProperty({ description: 'HotelMap3dConfig — ตรวจและบีบค่าใน service (sanitizeHotelMap3dConfig)' })
  @IsObject()
  config!: Record<string, unknown>;
}
