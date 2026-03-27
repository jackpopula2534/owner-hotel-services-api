import { IsString, IsEmail, IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InviteUserDto {
  @ApiProperty({
    description: 'Email address of the user to invite',
    example: 'user@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'The ID of the tenant to invite the user to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @IsUUID()
  tenantId: string;

  @ApiPropertyOptional({
    description: 'Role to assign to the user (owner, admin, member)',
    example: 'admin',
    default: 'member',
  })
  @IsOptional()
  @IsString()
  role?: string;
}
