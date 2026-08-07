import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Product line the signup is for — decides which free-trial plan is granted. */
export const REGISTER_SYSTEMS = ['HOTEL', 'CAMP'] as const;
export type RegisterSystem = (typeof REGISTER_SYSTEMS)[number];

export class RegisterDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  // Step 2: Hotel Info (optional - for full onboarding flow)
  @ApiPropertyOptional({ example: 'Grand Azure Hotel' })
  @IsString()
  @IsOptional()
  hotelName?: string;

  @ApiPropertyOptional({ example: '123 ถนนสุขุมวิท กรุงเทพฯ' })
  @IsString()
  @IsOptional()
  hotelAddress?: string;

  @ApiPropertyOptional({ example: '02-123-4567' })
  @IsString()
  @IsOptional()
  hotelPhone?: string;

  @ApiPropertyOptional({
    enum: REGISTER_SYSTEMS,
    default: 'HOTEL',
    description: 'Which product line to trial: HOTEL (โรงแรม) or CAMP (ลานกางเต็นท์)',
  })
  @IsIn(REGISTER_SYSTEMS)
  @IsOptional()
  system?: RegisterSystem;
}
