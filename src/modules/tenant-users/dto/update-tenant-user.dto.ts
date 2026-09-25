import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateTenantUserDto {
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

  @ApiPropertyOptional({ example: '0812345678' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ description: 'ISO date, or null to clear expiry', nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsDateString()
  expiresAt?: string | null;
}
