import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  Min,
  Max,
  IsJSON,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { CreateMaintenanceTaskDto } from './create-maintenance-task.dto';

export enum MaintenanceTaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold',
  CANCELLED = 'cancelled',
}

export class UpdateMaintenanceTaskDto extends PartialType(CreateMaintenanceTaskDto) {
  @ApiProperty({
    description: 'Task status',
    enum: MaintenanceTaskStatus,
    example: MaintenanceTaskStatus.COMPLETED,
    required: false,
  })
  @IsEnum(MaintenanceTaskStatus)
  @IsOptional()
  status?: MaintenanceTaskStatus;

  @ApiProperty({
    description: 'Actual cost spent',
    example: '450.00',
    required: false,
  })
  @IsOptional()
  actualCost?: string;

  @ApiProperty({
    description: 'Parts used (JSON format)',
    example: '[{"name":"Compressor Oil","qty":2,"cost":50}]',
    required: false,
  })
  @IsString()
  @IsOptional()
  partsUsed?: string;

  @ApiProperty({
    description: 'Task start time',
    example: '2024-01-15T10:00:00Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  startedAt?: string;

  @ApiProperty({
    description: 'Task completion time',
    example: '2024-01-15T11:00:00Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  completedAt?: string;

  @ApiProperty({
    description: 'Actual duration in minutes',
    example: 55,
    required: false,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  actualDuration?: number;

  @ApiProperty({
    description: 'Task completion rating (1-5)',
    example: 5,
    required: false,
  })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  rating?: number;

  @ApiProperty({
    description: 'Inspection notes',
    example: 'AC working perfectly, tested for 30 minutes',
    required: false,
  })
  @IsString()
  @IsOptional()
  inspectionNotes?: string;

  @ApiProperty({
    description: 'Inspector staff ID',
    example: 'staff-789',
    required: false,
  })
  @IsString()
  @IsOptional()
  inspectedById?: string;
}
