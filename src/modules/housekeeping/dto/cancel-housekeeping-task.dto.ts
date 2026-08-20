import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * ยกเลิกงานแม่บ้าน — ใช้แทนการลบทิ้ง เพราะงานที่สร้างผิด (เช่น เช็คเอาต์ผิดใบ)
 * ยังต้องตามรอยได้ว่าเคยมีและใครสั่งยกเลิกด้วยเหตุผลอะไร
 */
export class CancelHousekeepingTaskDto {
  @ApiProperty({
    description: 'Reason for cancelling the task',
    example: 'สร้างงานผิดห้อง',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
