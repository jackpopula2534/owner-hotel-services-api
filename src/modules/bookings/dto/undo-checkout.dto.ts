import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * เหตุผลของการย้อนสถานะเช็คเอาต์
 *
 * ไม่บังคับกรอกก็จริง แต่ค่าที่ส่งมาจะไปอยู่บนทั้ง audit log และเหตุผลของการยกเลิก
 * รายได้ — เวลาผู้จัดการมาไล่ว่าห้องนี้เช็คเอาต์แล้วทำไมยังมีคนอยู่ ข้อความนี้คือ
 * คำตอบเดียวที่มี
 */
export class UndoCheckOutDto {
  @ApiPropertyOptional({
    description: 'เหตุผลที่ย้อนสถานะ (เช่น กดผิดห้อง / แขกยังไม่ออก)',
    example: 'กดเช็คเอาต์ผิดห้อง',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'เหตุผลต้องยาวอย่างน้อย 3 ตัวอักษร' })
  @MaxLength(500)
  reason?: string;
}
