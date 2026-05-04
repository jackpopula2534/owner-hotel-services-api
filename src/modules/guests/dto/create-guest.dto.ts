import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * CreateGuestDto — payload for POST /api/v1/guests.
 *
 * Mirrors the Prisma `Guest` model. Used together with the global
 * ValidationPipe (`whitelist: true, forbidNonWhitelisted: true`) so any
 * unknown field sent by the client is stripped/rejected before reaching
 * Prisma — preventing PrismaClientValidationError leaks to the API.
 */
export class CreateGuestDto {
  @ApiProperty({ example: 'Emma' })
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อ' })
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกนามสกุล' })
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ example: 'emma.smith@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  email?: string;

  @ApiPropertyOptional({ example: '+44-20-7123-4567' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: '1-2345-67890-12-3' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nationalId?: string;

  @ApiPropertyOptional({ example: 'AB123456' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  passportNumber?: string;

  @ApiPropertyOptional({ example: '1990-07-01', description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'ไทย' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @ApiPropertyOptional({ example: '443/64 ถนนรัชดาภิเษก' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 'พัทยา' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'ไทย' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ example: '10100' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isVip?: boolean;

  @ApiPropertyOptional({ example: 'Gold', enum: ['Silver', 'Gold', 'Platinum', 'Diamond'] })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vipLevel?: string;

  @ApiPropertyOptional({ example: 'กข 1234' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehiclePlateNumber?: string;

  @ApiPropertyOptional({ example: 'Allergic to seafood. Prefers high floor.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialNotes?: string;
}
