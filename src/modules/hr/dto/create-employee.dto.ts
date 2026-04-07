import { IsString, IsNotEmpty, IsOptional, IsEmail, IsDateString, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'john.doe@hotel.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: 'EMP001' })
  @IsString()
  @IsOptional()
  employeeCode?: string;

  @ApiPropertyOptional({ example: 'Reception' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiPropertyOptional({ example: 'Receptionist' })
  @IsString()
  @IsOptional()
  position?: string;

  @ApiPropertyOptional({ description: 'Department ID from HR master data' })
  @IsString()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Position ID from HR master data' })
  @IsString()
  @IsOptional()
  positionId?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '081-234-5678' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'FULLTIME', enum: ['FULLTIME', 'TEMPORARY', 'DAILY', 'CONTRACT'] })
  @IsString()
  @IsOptional()
  employmentType?: string;

  @ApiPropertyOptional({ example: 'ACTIVE', enum: ['active', 'ACTIVE', 'ON_LEAVE', 'RESIGNED', 'SUSPENDED', 'TERMINATED'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsNumber()
  @IsOptional()
  baseSalary?: number;

  @ApiPropertyOptional({ example: '123-4-56789-0' })
  @IsString()
  @IsOptional()
  bankAccount?: string;

  @ApiPropertyOptional({ example: 'KBANK' })
  @IsString()
  @IsOptional()
  bankName?: string;

  @ApiPropertyOptional({ example: '1990-05-15' })
  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: '1234567890123' })
  @IsString()
  @IsOptional()
  nationalId?: string;

  @ApiPropertyOptional({ example: 'MALE', enum: ['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED'] })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional({ example: 'Additional notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}
