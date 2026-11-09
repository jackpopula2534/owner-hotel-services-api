import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsObject, IsOptional, Matches, Max, Min } from 'class-validator';

/** ฟอร์ม multipart ของ POST .../map3d/extractions (file = รูปแปลน) */
export class StartMap3dExtractionDto {
  @ApiProperty({ example: 320, description: 'ความกว้างจริงของรูปแปลน (เมตร) จากขั้นกำหนดสเกล' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20000)
  widthM!: number;

  @ApiPropertyOptional({
    example: 210,
    description: 'ความลึกจริง (เมตร) — เว้นได้ คำนวณจากสัดส่วนรูป',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20000)
  depthM?: number;

  @ApiPropertyOptional({ example: 0, description: 'ทิศเหนือ (องศาตามเข็มจากด้านบนของรูป)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(360)
  northDeg?: number;
}

/** PUT .../map3d — โครงละเอียดตรวจใน sanitizeMap3dConfig() */
export class SaveMap3dDto {
  @ApiProperty({ description: 'map3dConfig (พิกัด normalized 0..1)' })
  @IsObject()
  config!: Record<string, unknown>;
}

/** จำนวนวันสูงสุดของแถบเลื่อนวันที่ในชั้นข้อมูลการจอง */
export const MAX_OCCUPANCY_DAYS = 62;

/** GET .../map3d/occupancy — ช่วงวันของชั้นข้อมูลการจอง */
export class Map3dOccupancyQueryDto {
  @ApiProperty({ example: '2026-10-19', description: 'วันแรก (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from ต้องเป็นรูปแบบ YYYY-MM-DD' })
  from!: string;

  @ApiPropertyOptional({ example: 14, description: `จำนวนวัน (1..${MAX_OCCUPANCY_DAYS})` })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_OCCUPANCY_DAYS)
  days?: number;
}
