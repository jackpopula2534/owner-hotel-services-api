import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ArrayUnique,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PROCUREMENT_ROLES, type ProcurementRole } from './create-procurement-user.dto';

export class UpdateProcurementUserDto {
  @ApiPropertyOptional({ enum: PROCUREMENT_ROLES })
  @IsOptional()
  @IsString()
  @IsIn(PROCUREMENT_ROLES as unknown as string[])
  role?: ProcurementRole;

  @ApiPropertyOptional({
    example: 'active',
    enum: ['active', 'inactive'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiPropertyOptional({ minLength: 8, description: 'Reset password' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  approvalLimit?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
