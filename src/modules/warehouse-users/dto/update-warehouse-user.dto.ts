import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength, ArrayUnique, IsArray } from 'class-validator';
import { WAREHOUSE_ROLES, type WarehouseRole } from './create-warehouse-user.dto';

export class UpdateWarehouseUserDto {
  @ApiPropertyOptional({ enum: WAREHOUSE_ROLES })
  @IsOptional()
  @IsString()
  @IsIn(WAREHOUSE_ROLES as unknown as string[])
  role?: WarehouseRole;

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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  warehouseIds?: string[];
}
