import { IsString, IsEmail, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAdminDto {
  @ApiPropertyOptional({
    example: 'John',
    description: 'Admin first name',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Doe',
    description: 'Admin last name',
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    example: 'John Doe',
    description: 'Full display name (split into first/last when first/last not provided)',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: 'admin@hotelservices.com',
    description: 'Admin email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'SecurePassword123',
    description: 'Admin password (stored hashed with bcrypt)',
  })
  @IsString()
  password: string;

  @ApiPropertyOptional({
    example: 'platform_admin',
    description: 'Admin role (e.g. super, finance, support, platform_admin)',
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['/admin', '/admin/analytics', '/admin/hotels'],
    description:
      'List of admin menu hrefs this admin can access. Omit or send an empty array for full access.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  menuAccess?: string[];
}
