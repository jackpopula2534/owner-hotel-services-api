import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ArrayUnique,
  IsArray,
} from 'class-validator';

/**
 * HR Terminal roles.
 * - hr_manager:      head of HR, full access
 * - hr_officer:      general HR tasks (employees, attendance, leave)
 * - payroll_officer: payroll processing
 * - recruiter:       recruitment / employee onboarding
 * - hr_viewer:       read-only access
 */
export const HR_ROLES = [
  'hr_manager',
  'hr_officer',
  'payroll_officer',
  'recruiter',
  'hr_viewer',
] as const;

export type HrRole = (typeof HR_ROLES)[number];

/** Default permission matrix by HR role. */
export const DEFAULT_HR_PERMISSIONS: Record<HrRole, string[]> = {
  hr_manager: [
    'employee.view',
    'employee.manage',
    'attendance.view',
    'attendance.manage',
    'leave.view',
    'leave.approve',
    'payroll.view',
    'payroll.run',
    'payroll.approve',
    'kpi.view',
    'kpi.manage',
    'evaluation.view',
    'evaluation.manage',
    'report.view',
    'report.export',
    'user.manage',
  ],
  hr_officer: [
    'employee.view',
    'employee.manage',
    'attendance.view',
    'attendance.manage',
    'leave.view',
    'leave.approve',
    'payroll.view',
    'kpi.view',
    'evaluation.view',
    'report.view',
  ],
  payroll_officer: [
    'employee.view',
    'attendance.view',
    'payroll.view',
    'payroll.run',
    'report.view',
    'report.export',
  ],
  recruiter: ['employee.view', 'employee.manage', 'report.view'],
  hr_viewer: [
    'employee.view',
    'attendance.view',
    'leave.view',
    'payroll.view',
    'kpi.view',
    'evaluation.view',
    'report.view',
  ],
};

export class CreateHrTerminalUserDto {
  @ApiProperty({ example: 'hr@hotel.com', description: 'Login email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    example: 'hr_officer',
    enum: HR_ROLES,
    description: 'HR role',
  })
  @IsString()
  @IsIn(HR_ROLES as unknown as string[])
  role!: HrRole;

  @ApiPropertyOptional({ example: 'Somchai' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Jaidee' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: 'EMP-001', description: 'Link to HR Employee' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['employee.view', 'payroll.run'],
    description: 'Fine-grained permission keys (overrides role default)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
