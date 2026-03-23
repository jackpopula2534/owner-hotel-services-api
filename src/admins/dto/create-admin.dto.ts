import { IsString, IsEnum, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AdminRole } from '../entities/admin.entity';

export class CreateAdminDto {
  @ApiProperty({
    example: 'John',
    description: 'Admin first name'
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    example: 'Doe',
    description: 'Admin last name'
  })
  @IsString()
  lastName: string;

  @ApiProperty({
    example: 'admin@hotelservices.com',
    description: 'Admin email address'
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'SecurePassword123',
    description: 'Admin password'
  })
  @IsString()
  password: string;

  @ApiProperty({
    example: 'platform_admin',
    description: 'Admin role (platform_admin, finance_admin, support_admin)'
  })
  @IsString()
  role: string;
}


