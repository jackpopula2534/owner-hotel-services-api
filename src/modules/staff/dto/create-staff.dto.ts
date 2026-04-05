import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum StaffRole {
  HOUSEKEEPER = 'housekeeper',
  TECHNICIAN = 'technician',
  SUPERVISOR = 'supervisor',
  MANAGER = 'manager',
}

export enum StaffDepartment {
  HOUSEKEEPING = 'housekeeping',
  MAINTENANCE = 'maintenance',
  FRONT_DESK = 'front_desk',
}

export enum StaffStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ON_LEAVE = 'on_leave',
}

export enum ShiftType {
  MORNING = 'morning',
  AFTERNOON = 'afternoon',
  NIGHT = 'night',
  FLEXIBLE = 'flexible',
}

export class CreateStaffDto {
  @ApiProperty({
    description: 'Staff first name',
    example: 'John',
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    description: 'Staff last name',
    example: 'Doe',
  })
  @IsString()
  lastName: string;

  @ApiProperty({
    description: 'Staff email address',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Staff phone number',
    example: '+66812345678',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: 'Staff role',
    enum: StaffRole,
    example: StaffRole.HOUSEKEEPER,
  })
  @IsEnum(StaffRole)
  role: StaffRole;

  @ApiProperty({
    description: 'Staff department',
    enum: StaffDepartment,
    example: StaffDepartment.HOUSEKEEPING,
    required: false,
  })
  @IsEnum(StaffDepartment)
  @IsOptional()
  department?: StaffDepartment;

  @ApiProperty({
    description: 'Employee code or ID',
    example: 'EMP001',
    required: false,
  })
  @IsString()
  @IsOptional()
  employeeCode?: string;

  @ApiProperty({
    description: 'Staff status',
    enum: StaffStatus,
    example: StaffStatus.ACTIVE,
    required: false,
  })
  @IsEnum(StaffStatus)
  @IsOptional()
  status?: StaffStatus = StaffStatus.ACTIVE;

  @ApiProperty({
    description: 'Shift type',
    enum: ShiftType,
    example: ShiftType.MORNING,
    required: false,
  })
  @IsEnum(ShiftType)
  @IsOptional()
  shiftType?: ShiftType;

  @ApiProperty({
    description: 'Maximum tasks per shift',
    example: 8,
    required: false,
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  maxTasksPerShift?: number;

  @ApiProperty({
    description: 'Staff specializations (e.g., deep-cleaning, ac-repair)',
    example: ['deep-cleaning', 'ac-repair'],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  specializations?: string[];
}
