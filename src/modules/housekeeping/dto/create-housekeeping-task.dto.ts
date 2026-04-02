import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum TaskType {
  DAILY = 'daily',
  CHECKOUT = 'checkout',
  DEEP = 'deep',
  TURNDOWN = 'turndown',
  INSPECTION = 'inspection',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  INSPECTED = 'inspected',
}

export class CreateHousekeepingTaskDto {
  @ApiProperty({
    description: 'Room ID',
    example: 'room-123',
  })
  @IsString()
  roomId: string;

  @ApiProperty({
    description: 'Task type',
    enum: TaskType,
    example: TaskType.CHECKOUT,
  })
  @IsEnum(TaskType)
  type: TaskType;

  @ApiProperty({
    description: 'Task priority',
    enum: TaskPriority,
    example: TaskPriority.HIGH,
  })
  @IsEnum(TaskPriority)
  priority: TaskPriority;

  @ApiProperty({
    description: 'Task status',
    enum: TaskStatus,
    example: TaskStatus.PENDING,
  })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiProperty({
    description: 'Task notes',
    example: 'Checkout cleaning - Guest: John Doe, Room: 101',
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    description: 'Estimated duration in minutes',
    example: 30,
  })
  @IsNumber()
  @IsOptional()
  estimatedDuration?: number;
}
