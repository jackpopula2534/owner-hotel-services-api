import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** สถานะที่พนักงานหน้าลานตั้งให้จุดได้เอง — occupied เกิดจากเช็คอินเท่านั้น */
export const OPS_PITCH_STATUSES = ['available', 'cleaning', 'maintenance', 'closed'] as const;
export type OpsPitchStatus = (typeof OPS_PITCH_STATUSES)[number];
export const OPS_FACILITY_STATUSES = ['open', 'closed', 'maintenance'] as const;
export const OPS_TASK_TYPES = ['cleaning', 'maintenance'] as const;
export const OPS_TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export const OPS_TASK_PRIORITIES = ['urgent', 'normal', 'low'] as const;

export class OpsBoardQueryDto {
  @ApiProperty()
  @IsUUID()
  campgroundId!: string;
}

export class SetPitchStatusDto {
  @ApiProperty({ enum: OPS_PITCH_STATUSES })
  @IsIn(OPS_PITCH_STATUSES as unknown as string[])
  status!: OpsPitchStatus;

  @ApiPropertyOptional({ maxLength: 180, description: 'เหตุผล (เช่น ปิดพักหญ้า)' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  reason?: string;
}

export class SetFacilityStatusDto {
  @ApiProperty({ enum: OPS_FACILITY_STATUSES })
  @IsIn(OPS_FACILITY_STATUSES as unknown as string[])
  status!: (typeof OPS_FACILITY_STATUSES)[number];

  @ApiPropertyOptional({ maxLength: 180 })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  note?: string;
}

export class CreateOpsTaskDto {
  @ApiProperty()
  @IsUUID()
  campgroundId!: string;

  @ApiProperty({ enum: OPS_TASK_TYPES })
  @IsIn(OPS_TASK_TYPES as unknown as string[])
  type!: (typeof OPS_TASK_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  pitchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  facilityId?: string;

  @ApiPropertyOptional({ maxLength: 180, description: 'หัวข้องาน/ปัญหา (ว่าง = ใช้ชื่อมาตรฐาน)' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @ApiPropertyOptional({ enum: OPS_TASK_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(OPS_TASK_PRIORITIES as unknown as string[])
  priority?: (typeof OPS_TASK_PRIORITIES)[number];

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assigneeName?: string;

  @ApiPropertyOptional({ description: 'งานซ่อม: ปิดขายจุดระหว่างซ่อม (จุดที่มีแขกพักจะไม่ถูกปิด)' })
  @IsOptional()
  @IsBoolean()
  blocksPitch?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateOpsTaskDto {
  @ApiPropertyOptional({ enum: OPS_TASK_STATUSES })
  @IsOptional()
  @IsIn(OPS_TASK_STATUSES as unknown as string[])
  status?: (typeof OPS_TASK_STATUSES)[number];

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assigneeName?: string;

  @ApiPropertyOptional({ description: 'ค่าใช้จ่ายซ่อม (บาท)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    enum: ['available', 'cleaning'],
    description: 'ปิดงานซ่อมจุดแล้วให้จุดไปสถานะไหน (ค่าเริ่มต้น cleaning)',
  })
  @IsOptional()
  @IsIn(['available', 'cleaning'])
  after?: 'available' | 'cleaning';
}

export class MoveReservationDto {
  @ApiProperty()
  @IsUUID()
  pitchId!: string;

  @ApiPropertyOptional({ description: 'ไม่คิดส่วนต่างราคา' })
  @IsOptional()
  @IsBoolean()
  waivePriceDifference?: boolean;
}
