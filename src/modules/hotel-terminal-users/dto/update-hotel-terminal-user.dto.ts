import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, ArrayUnique, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { HOTEL_TERMINAL_ROLES, HotelTerminalRole } from './create-hotel-terminal-user.dto';

export class UpdateHotelTerminalUserDto {
  @ApiPropertyOptional({ enum: HOTEL_TERMINAL_ROLES })
  @IsOptional()
  @IsString()
  @IsIn(HOTEL_TERMINAL_ROLES as unknown as string[])
  role?: HotelTerminalRole;

  @ApiPropertyOptional({ example: 'active', description: 'active | inactive | suspended' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ minLength: 8, description: 'Reset password' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ description: 'Default property this user operates in' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
