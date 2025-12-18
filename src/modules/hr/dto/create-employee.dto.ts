import { IsString, IsNotEmpty, IsOptional, IsEmail, IsDateString } from 'class-validator';
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

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsDateString()
  @IsOptional()
  startDate?: string;
}



