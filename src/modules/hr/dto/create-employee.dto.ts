import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsDateString,
  IsNumber,
  IsArray,
} from 'class-validator';
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

  @ApiPropertyOptional({ example: 'Johnny' })
  @IsString()
  @IsOptional()
  nickname?: string;

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

  @ApiPropertyOptional({
    example: 'FULLTIME',
    enum: ['FULLTIME', 'TEMPORARY', 'DAILY', 'CONTRACT'],
  })
  @IsString()
  @IsOptional()
  employmentType?: string;

  @ApiPropertyOptional({
    example: 'ACTIVE',
    enum: ['active', 'ACTIVE', 'ON_LEAVE', 'RESIGNED', 'SUSPENDED', 'TERMINATED'],
  })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsNumber()
  @IsOptional()
  baseSalary?: number;

  @ApiPropertyOptional({ example: 20000, description: 'Initial salary when employee started' })
  @IsNumber()
  @IsOptional()
  initialSalary?: number;

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

  // New Fields
  @ApiPropertyOptional({ description: 'Hotel ID (Property ID)' })
  @IsString()
  @IsOptional()
  hotelId?: string;

  @ApiPropertyOptional({ description: 'Property ID (Internal mapping)' })
  @IsString()
  @IsOptional()
  propertyId?: string;

  @ApiPropertyOptional({ example: 'TX12345678' })
  @IsString()
  @IsOptional()
  taxId?: string;

  @ApiPropertyOptional({ example: 'SS12345678' })
  @IsString()
  @IsOptional()
  socialSecurity?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsNumber()
  @IsOptional()
  allowance?: number;

  @ApiPropertyOptional({ example: 2000 })
  @IsNumber()
  @IsOptional()
  overtime?: number;

  @ApiPropertyOptional({ example: 3000 })
  @IsNumber()
  @IsOptional()
  positionBonus?: number;

  @ApiPropertyOptional({
    description: 'Education history (JSON array)',
    example: [
      {
        level: 'BACHELOR',
        institution: 'มหาวิทยาลัยเชียงใหม่',
        major: 'การโรงแรม',
        graduationYear: '2020',
        gpa: '3.50',
      },
    ],
  })
  @IsArray()
  @IsOptional()
  educations?: Record<string, unknown>[];

  @ApiPropertyOptional({
    description: 'Work experience history (JSON array)',
    example: [
      { company: 'Hotel XYZ', position: 'Receptionist', startYear: '2020', endYear: '2022' },
    ],
  })
  @IsArray()
  @IsOptional()
  workExperiences?: Record<string, unknown>[];

  @ApiPropertyOptional({
    description: 'Emergency contact info (JSON array)',
    example: [{ name: 'สมหญิง ใจดี', relation: 'ภรรยา', phone: '081-234-5678' }],
  })
  @IsArray()
  @IsOptional()
  emergencyContacts?: Record<string, unknown>[];
}
