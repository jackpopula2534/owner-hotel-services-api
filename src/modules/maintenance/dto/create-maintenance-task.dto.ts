import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum MaintenanceCategory {
  AC = 'ac',
  HVAC = 'hvac',           // alias ใช้แทน ac ได้
  PLUMBING = 'plumbing',
  ELECTRICAL = 'electrical',
  FURNITURE = 'furniture',
  APPLIANCE = 'appliance', // เครื่องใช้ไฟฟ้า
  STRUCTURAL = 'structural',
  PEST = 'pest',
  SAFETY = 'safety',
  OTHER = 'other',
}

export enum MaintenancePriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export class CreateMaintenanceTaskDto {
  @ApiProperty({
    description: 'Property ID (optional — resolved from tenant default if omitted)',
    example: 'property-123',
    required: false,
  })
  @IsString()
  @IsOptional()
  propertyId?: string;

  @ApiProperty({
    description: 'Room ID (optional)',
    example: 'room-123',
    required: false,
  })
  @IsString()
  @IsOptional()
  roomId?: string;

  @ApiProperty({
    description: 'Task title',
    example: 'AC unit not cooling',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Task description',
    example: 'Guest reported AC temperature not dropping below 28C',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Task category',
    enum: MaintenanceCategory,
    example: MaintenanceCategory.AC,
  })
  @IsEnum(MaintenanceCategory)
  category: MaintenanceCategory;

  @ApiProperty({
    description: 'Task priority',
    enum: MaintenancePriority,
    example: MaintenancePriority.HIGH,
    required: false,
  })
  @IsEnum(MaintenancePriority)
  @IsOptional()
  priority?: MaintenancePriority;

  @ApiProperty({
    description: 'Location description (e.g. "ห้อง 201", "ล็อบบี้")',
    example: 'ห้อง 201',
    required: false,
  })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiProperty({
    description: 'Assigned technician ID',
    example: 'staff-456',
    required: false,
  })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiProperty({
    description: 'Scheduled date for maintenance',
    example: '2024-01-15T10:00:00Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  scheduledDate?: string;

  @ApiProperty({
    description: 'Estimated duration in minutes',
    example: 60,
    required: false,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  estimatedDuration?: number;

  @ApiProperty({
    description: 'Estimated cost',
    example: '500.00',
    required: false,
  })
  @IsOptional()
  estimatedCost?: string;

  @ApiProperty({
    description: 'Notes or additional information',
    example: 'Compressor needs inspection',
    required: false,
  })
  @IsString()
  @IsOptional()
  notes?: string;
}
