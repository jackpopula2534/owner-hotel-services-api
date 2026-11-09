import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Why a served bill comes back to the kitchen:
 *   REMAKE       — ลูกค้าตีกลับ / ทำใหม่ → items go back to waiting
 *   WRONG_ITEM   — อาหารผิดรายการ → items go back to waiting
 *   MISSED_SERVE — กดส่งเสิร์ฟผิด → items wait at the pass again (READY), nothing to cook
 */
export const RECALL_REASONS = ['REMAKE', 'WRONG_ITEM', 'MISSED_SERVE'] as const;
export type RecallReason = (typeof RECALL_REASONS)[number];

export class RecallBillDto {
  @ApiProperty({ enum: RECALL_REASONS })
  @IsIn(RECALL_REASONS as unknown as string[])
  reason!: RecallReason;

  @ApiPropertyOptional({ type: [String], description: 'Only these served items. Leave out to recall every served item.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  itemIds?: string[];
}

export class KitchenHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Bills served since this moment (ISO). Defaults to the start of today.' })
  @IsOptional()
  @IsISO8601()
  since?: string;
}
