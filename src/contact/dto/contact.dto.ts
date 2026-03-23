import { IsString, IsEmail, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDemoBookingDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Full name of the person requesting demo'
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'john@example.com',
    description: 'Email address'
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: '+66-8-1234-5678',
    description: 'Phone number'
  })
  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({
    example: '2026-04-15T10:00:00Z',
    description: 'Preferred date for demo'
  })
  @IsDateString()
  demoDate: string;

  @ApiProperty({
    example: 'online',
    description: 'Demo type (online or onsite)'
  })
  @IsString()
  demoType: string; // online, onsite

  @ApiPropertyOptional({
    example: 'Interested in booking management features',
    description: 'Additional notes or requirements'
  })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateContactMessageDto {
  @ApiProperty({
    example: 'Jane Smith',
    description: 'Full name of contact'
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'jane@example.com',
    description: 'Email address'
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: 'Question about pricing',
    description: 'Subject of the message'
  })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiProperty({
    example: 'I would like to know more about your pricing plans',
    description: 'Message content'
  })
  @IsString()
  message: string;
}
