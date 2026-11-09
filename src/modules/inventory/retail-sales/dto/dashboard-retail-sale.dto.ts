import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export type RetailDashboardPeriod = 'week' | 'month' | 'year';

/** Query for the retail sales dashboard (สรุปยอดขาย ประจำสัปดาห์/เดือน/ปี). */
export class DashboardRetailSaleDto {
  @ApiPropertyOptional({
    enum: ['week', 'month', 'year'],
    default: 'week',
    description: 'ช่วงเวลาที่สรุป (ค่าเริ่มต้น = week)',
  })
  @IsOptional()
  @IsIn(['week', 'month', 'year'])
  period?: RetailDashboardPeriod;

  @ApiPropertyOptional({ description: 'กรองเฉพาะคลัง/ร้านค้า' })
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @ApiPropertyOptional({ description: 'วันอ้างอิง (ISO) — ค่าเริ่มต้น = วันนี้' })
  @IsOptional()
  @IsString()
  date?: string;
}
