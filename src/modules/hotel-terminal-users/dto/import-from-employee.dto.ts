import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { HOTEL_TERMINAL_ROLES, HotelTerminalRole } from './create-hotel-terminal-user.dto';

/**
 * Auto-create a Hotel Terminal user from an existing HR Employee.
 * Reuses the employee's name and email; the caller chooses a role and a
 * temporary password.
 */
export class ImportFromEmployeeDto {
  @ApiProperty({ description: 'HR Employee.id to import' })
  @IsString()
  employeeId!: string;

  @ApiProperty({ enum: HOTEL_TERMINAL_ROLES, example: 'housekeeper' })
  @IsString()
  @IsIn(HOTEL_TERMINAL_ROLES as unknown as string[])
  role!: HotelTerminalRole;

  @ApiProperty({
    minLength: 8,
    description: 'Temporary login password for the new user',
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    description: "Override propertyId. Defaults to the employee's assigned propertyId.",
  })
  @IsOptional()
  @IsString()
  propertyId?: string;
}
