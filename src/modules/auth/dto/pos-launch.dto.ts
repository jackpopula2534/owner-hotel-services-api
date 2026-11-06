import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';

/** POS (หน้าขาย) หรือ KDS (จอครัว) — ใช้ endpoint เดียวกันแต่ความพร้อมต่างกัน */
export const POS_LAUNCH_TARGETS = ['pos', 'kitchen'] as const;
export type PosLaunchTarget = (typeof POS_LAUNCH_TARGETS)[number];

export class PosLaunchDto {
  @ApiProperty({ example: 'rest_abc123', description: 'Restaurant ID to open in POS' })
  @IsString()
  restaurantId: string;

  @ApiPropertyOptional({
    example: 'table_xyz456',
    description: 'Optional table to pre-select in POS',
  })
  @IsOptional()
  @IsString()
  tableId?: string;

  @ApiPropertyOptional({
    enum: POS_LAUNCH_TARGETS,
    default: 'pos',
    description: "'pos' = หน้าขาย (ต้องมีร้าน + เมนู), 'kitchen' = จอครัว KDS (ต้องมีร้านเท่านั้น)",
  })
  @IsOptional()
  @IsIn(POS_LAUNCH_TARGETS)
  target?: PosLaunchTarget;
}
