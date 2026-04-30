import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ArrayUnique,
  IsArray,
} from 'class-validator';

/**
 * Hotel Terminal roles.
 * - hotel_manager: oversees the whole property; full access
 * - front_desk:    check-in / check-out, walk-ins, guest profiles
 * - housekeeper:   cleans rooms, marks them ready
 * - maintenance:   handles work orders and room repair
 */
export const HOTEL_TERMINAL_ROLES = [
  'hotel_manager',
  'front_desk',
  'housekeeper',
  'maintenance',
] as const;

export type HotelTerminalRole = (typeof HOTEL_TERMINAL_ROLES)[number];

export class CreateHotelTerminalUserDto {
  @ApiProperty({ example: 'frontdesk@hotel.com', description: 'Login email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    example: 'front_desk',
    enum: HOTEL_TERMINAL_ROLES,
    description: 'Hotel Terminal role',
  })
  @IsString()
  @IsIn(HOTEL_TERMINAL_ROLES as unknown as string[])
  role!: HotelTerminalRole;

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

  @ApiPropertyOptional({
    example: 'EMP-001',
    description: 'Link to HR Employee (employeeId field)',
  })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Link to HR Employee record by Employee.id (when imported from HR)',
  })
  @IsOptional()
  @IsString()
  hrEmployeeId?: string;

  @ApiPropertyOptional({
    description: 'Default property this user operates in',
  })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['frontdesk.view', 'frontdesk.manage', 'bookings.view'],
    description: 'Fine-grained hotel terminal permission keys',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
