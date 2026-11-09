import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TableStatusEnum } from './update-table-status.dto';

export enum TableShapeEnum {
  RECTANGLE = 'RECTANGLE',
  SQUARE = 'SQUARE',
  ROUND = 'ROUND',
  OVAL = 'OVAL',
}

/**
 * รูปแบบโต๊ะ (table type) ที่ผังร้านใช้วาดโต๊ะตัวนั้น
 *
 * ต้องตรงกับ `TABLE_TYPES` ฝั่ง frontend
 * (`components/restaurant/tables/tableTypes.ts`) — ค่านี้ถูกอ่านกลับไปเลือก
 * รูปวาดบนผัง ถ้าปล่อยให้เป็น string อิสระ ค่าที่พิมพ์ผิดจะลงฐานข้อมูลแล้ว
 * ผังร้านจะวาดโต๊ะนั้นไม่ได้
 */
export const TABLE_FURNITURE_TYPES = [
  'round-table-2',
  'round-table-4',
  'rect-table-4',
  'rect-table-6',
  'bar-counter',
  'booth-seat',
] as const;

export class CreateTableDto {
  @ApiProperty({ example: 'T01' })
  @IsString()
  @IsNotEmpty()
  tableNumber: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  capacity: number;

  @ApiPropertyOptional({ enum: TableShapeEnum, example: TableShapeEnum.RECTANGLE })
  @IsEnum(TableShapeEnum)
  @IsOptional()
  shape?: TableShapeEnum;

  /**
   * รูปแบบโต๊ะที่เลือกไว้ — ผังร้านวาดตามค่านี้ตรง ๆ
   * ไม่ส่งมาก็ได้ (โต๊ะเก่าที่สร้างก่อนมี field นี้) ฝั่ง client จะเดาจาก
   * shape + capacity ให้แทน
   */
  @ApiPropertyOptional({ enum: TABLE_FURNITURE_TYPES, example: 'rect-table-4' })
  @IsIn(TABLE_FURNITURE_TYPES as unknown as string[])
  @IsOptional()
  furnitureType?: string;

  /**
   * สถานะเริ่มต้นของโต๊ะ — ฟอร์ม "Add Table" ใน POS มีช่อง Initial Status ให้เลือก
   * (โต๊ะที่สร้างไว้แต่ยังใช้ไม่ได้ เช่น OUT_OF_SERVICE) เดิม DTO ไม่รับ field นี้
   * ValidationPipe (`forbidNonWhitelisted`) จึงตีกลับทั้งใบด้วย
   * "property status should not exist" — สร้าง/แก้ไขโต๊ะจากหน้า POS ไม่ได้เลย
   */
  @ApiPropertyOptional({ enum: TableStatusEnum, example: TableStatusEnum.AVAILABLE })
  @IsEnum(TableStatusEnum)
  @IsOptional()
  status?: TableStatusEnum;

  @ApiPropertyOptional({ example: 100.5 })
  @IsNumber()
  @IsOptional()
  positionX?: number;

  @ApiPropertyOptional({ example: 200.0 })
  @IsNumber()
  @IsOptional()
  positionY?: number;

  @ApiPropertyOptional({ example: 80.0 })
  @IsNumber()
  @IsOptional()
  width?: number;

  @ApiPropertyOptional({ example: 60.0 })
  @IsNumber()
  @IsOptional()
  height?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  rotation?: number;

  @ApiPropertyOptional({ example: 'Main Hall' })
  @IsString()
  @IsOptional()
  zone?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
