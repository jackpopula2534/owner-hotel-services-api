import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TerminalGrantDto } from './terminal-grant.dto';

export class CreateTenantUserDto {
  @ApiProperty({ example: 'staff@hotel.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ minLength: 8, description: 'Omit with generatePassword=true' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ description: 'Generate a random temporary password and return it once' })
  @IsOptional()
  @IsBoolean()
  generatePassword?: boolean;

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

  @ApiPropertyOptional({ example: '0812345678' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: 'EMP-001', description: 'users.employeeId (employee code)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  employeeCode?: string;

  @ApiPropertyOptional({ description: 'HR Employee.id to link' })
  @IsOptional()
  @IsString()
  hrEmployeeId?: string;

  @ApiProperty({ type: [TerminalGrantDto], description: 'Terminals this user may enter' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TerminalGrantDto)
  grants!: TerminalGrantDto[];

  @ApiPropertyOptional({ description: 'ISO date — account auto-expires after this' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
