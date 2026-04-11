import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export type StaffRole = 'housekeeper' | 'technician' | 'supervisor' | 'manager';
export type StaffDepartment = 'housekeeping' | 'maintenance' | 'front_desk';

/** Maps role → default department for convenience */
export const ROLE_DEPARTMENT_MAP: Record<StaffRole, StaffDepartment> = {
  housekeeper: 'housekeeping',
  technician: 'maintenance',
  supervisor: 'housekeeping',
  manager: 'housekeeping',
};

export class CreateStaffFromEmployeeDto {
  @ApiPropertyOptional({
    description: 'Role to assign the new Staff record',
    enum: ['housekeeper', 'technician', 'supervisor', 'manager'],
    default: 'housekeeper',
    example: 'technician',
  })
  @IsOptional()
  @IsString()
  @IsIn(['housekeeper', 'technician', 'supervisor', 'manager'])
  role?: StaffRole;

  @ApiPropertyOptional({
    description: 'Department override (inferred from role when omitted)',
    enum: ['housekeeping', 'maintenance', 'front_desk'],
    example: 'maintenance',
  })
  @IsOptional()
  @IsString()
  @IsIn(['housekeeping', 'maintenance', 'front_desk'])
  department?: StaffDepartment;
}
