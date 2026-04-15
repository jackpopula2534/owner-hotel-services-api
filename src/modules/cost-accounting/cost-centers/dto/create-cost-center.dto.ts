import { IsNotEmpty, IsString, IsOptional, IsEnum, IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum CostCenterTypeEnum {
  ROOMS = 'ROOMS',
  FOOD_BEVERAGE = 'FOOD_BEVERAGE',
  ADMIN_GENERAL = 'ADMIN_GENERAL',
  SALES_MARKETING = 'SALES_MARKETING',
  MAINTENANCE_DEPT = 'MAINTENANCE_DEPT',
  ENERGY = 'ENERGY',
  OTHER_OPERATED = 'OTHER_OPERATED',
  UNDISTRIBUTED = 'UNDISTRIBUTED',
}

export class CreateCostCenterDto {
  @ApiProperty({
    description: 'Property ID (uuid)',
    example: 'uuid',
  })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({
    description: 'Cost center name',
    example: 'Rooms Department',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Cost center code (unique per property+tenant)',
    example: 'CC-ROOMS',
  })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({
    description: 'Cost center type (USALI classification)',
    enum: CostCenterTypeEnum,
    example: CostCenterTypeEnum.ROOMS,
  })
  @IsNotEmpty()
  @IsEnum(CostCenterTypeEnum)
  type: CostCenterTypeEnum;

  @ApiPropertyOptional({
    description: 'Cost center description',
    example: 'Rooms housekeeping and maintenance',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Parent cost center ID for hierarchical structure',
    example: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Manager user ID',
    example: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({
    description: 'Sort order for display',
    example: 1,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder?: number;
}
