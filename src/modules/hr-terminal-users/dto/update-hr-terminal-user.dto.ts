import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength, ArrayUnique, IsArray } from 'class-validator';
import { HR_ROLES } from './create-hr-terminal-user.dto';

export class UpdateHrTerminalUserDto {
  @ApiPropertyOptional({ enum: HR_ROLES })
  @IsOptional()
  @IsString()
  @IsIn(HR_ROLES as unknown as string[])
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
