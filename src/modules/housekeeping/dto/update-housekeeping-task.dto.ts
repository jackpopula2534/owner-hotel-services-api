import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum HousekeepingTaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  INSPECTED = 'inspected',
}

export class UpdateHousekeepingTaskDto {
  @ApiProperty({
    description: 'Task status',
    enum: HousekeepingTaskStatus,
    example: HousekeepingTaskStatus.COMPLETED,
    required: false,
  })
  @IsEnum(HousekeepingTaskStatus)
  @IsOptional()
  status?: HousekeepingTaskStatus;

  @ApiProperty({
    description: 'Assigned staff ID',
    example: 'staff-123',
    required: false,
  })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiProperty({
    description: 'Assigned staff name (denormalized)',
    example: 'John Doe',
    required: false,
  })
  @IsString()
  @IsOptional()
  assignedToName?: string;

  @ApiProperty({
    description: 'Task notes',
    example: 'Guest was still in room at checkout time',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    description: 'Completion percentage (0-100)',
    example: 100,
    required: false,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  completionPercentage?: number;

  @ApiProperty({
    description: 'Task rating (1-5)',
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
    example: 'Room is clean and ready for check-in',
    required: false,
  })
  @IsString()
  @IsOptional()
  inspectionNotes?: string;

  @ApiProperty({
    description: 'Inspector staff ID',
    example: 'staff-456',
    required: false,
  })
  @IsString()
  @IsOptional()
  inspectedById?: string;

  @ApiProperty({
    description: 'Inspector staff name (denormalized)',
    example: 'Jane Smith',
    required: false,
  })
  @IsString()
  @IsOptional()
  inspectedByName?: string;

  @ApiProperty({
    description: 'Task scheduled time',
    example: '2024-01-15T10:00:00Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  scheduledFor?: string;

  @ApiProperty({
    description: 'Actual task start time',
    example: '2024-01-15T10:05:00Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  actualStartTime?: string;

  @ApiProperty({
    description: 'Actual task end time',
    example: '2024-01-15T10:35:00Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  actualEndTime?: string;

  @ApiProperty({
    description: 'Room ready timestamp',
    example: '2024-01-15T10:35:00Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  roomReadyAt?: string;
}
