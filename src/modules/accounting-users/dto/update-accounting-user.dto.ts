import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength, ArrayUnique, IsArray } from 'class-validator';
import { ACCOUNTING_ROLES } from './create-accounting-user.dto';

export class UpdateAccountingUserDto {
  @ApiPropertyOptional({ enum: ACCOUNTING_ROLES })
  @IsOptional()
  @IsString()
  @IsIn(ACCOUNTING_ROLES as unknown as string[])
  role?: string;

  @ApiPropertyOptional({ example: 'active', enum: ['active', 'inactive', 'suspended'] })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive', 'suspended'])
  status?: string;

  @ApiPropertyOptional({ example: 'NewPass123!', minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
