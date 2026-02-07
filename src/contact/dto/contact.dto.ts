import { IsString, IsEmail, IsOptional, IsDateString, IsEnum } from 'class-validator';

export class CreateDemoBookingDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  phoneNumber?: string;

  @IsDateString()
  demoDate: string;

  @IsString()
  demoType: string; // online, onsite

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateContactMessageDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  message: string;
}
