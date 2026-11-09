import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * ย้อนสถานะงานแม่บ้าน 1 ขั้น — ต้องระบุสถานะปลายทาง (กันหน้าจอค้างรุ่นย้อนผิดขั้น)
 * และเหตุผล (เก็บลงประวัติว่าใครย้อน เพราะอะไร)
 */
export class RevertHousekeepingTaskDto {
  @ApiProperty({ enum: ['pending', 'in_progress', 'completed'], example: 'in_progress' })
  @IsIn(['pending', 'in_progress', 'completed'])
  toStatus!: 'pending' | 'in_progress' | 'completed';

  @ApiProperty({ example: 'ห้องยังไม่สะอาด ต้องทำใหม่', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
