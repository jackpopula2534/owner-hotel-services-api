import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

const POS_ROLES = [
  'waiter',
  'chef',
  'cashier',
  'receptionist',
  'bartender',
  'housekeeper',
  'maintenance',
  'manager',
] as const;

export class CreatePosUserDto {
  @ApiProperty({ example: 'staff@hotel.com', description: 'Employee email for POS login' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'StrongPass123!',
    description: 'Initial password (employee can change later)',
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'waiter', enum: POS_ROLES, description: 'POS role for this employee' })
  @IsString()
  @IsIn(POS_ROLES)
  role: string;

  @ApiPropertyOptional({ example: 'Somchai' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Jaidee' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    example: 'EMP-001',
    description: 'Employee ID to link this POS account to',
  })
  @IsOptional()
  @IsString()
  employeeId?: string;
}
