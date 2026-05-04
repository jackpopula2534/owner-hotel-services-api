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
 * Warehouse roles.
 * - warehouse_manager: head of warehouse, has every permission
 * - inventory_clerk:   manages items, executes stock movements, counts stock
 * - qc_officer:        inspects incoming and stored goods (QC records)
 * - receiver:          receives shipments and writes Goods Receipts (GR)
 */
export const WAREHOUSE_ROLES = [
  'warehouse_manager',
  'inventory_clerk',
  'qc_officer',
  'receiver',
] as const;

export type WarehouseRole = (typeof WAREHOUSE_ROLES)[number];

/** Default permission matrix by role. */
export const DEFAULT_WAREHOUSE_PERMISSIONS: Record<WarehouseRole, string[]> = {
  warehouse_manager: [
    'item.view',
    'item.manage',
    'warehouse.view',
    'warehouse.manage',
    'gr.view',
    'gr.create',
    'movement.view',
    'movement.create',
    'qc.inspect',
    'qc.manage',
    'lot.view',
    'lot.manage',
    'stock.count',
    'alert.view',
    'forecast.view',
    'report.view',
    'user.manage',
  ],
  inventory_clerk: [
    'item.view',
    'item.manage',
    'warehouse.view',
    'movement.view',
    'movement.create',
    'lot.view',
    'stock.count',
    'alert.view',
    'forecast.view',
  ],
  qc_officer: ['item.view', 'gr.view', 'qc.inspect', 'lot.view'],
  receiver: ['item.view', 'gr.view', 'gr.create', 'qc.inspect', 'lot.view'],
};

export class CreateWarehouseUserDto {
  @ApiProperty({ example: 'receiver@hotel.com', description: 'Login email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    example: 'receiver',
    enum: WAREHOUSE_ROLES,
    description: 'Warehouse role',
  })
  @IsString()
  @IsIn(WAREHOUSE_ROLES as unknown as string[])
  role!: WarehouseRole;

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
    description: 'Link to HR Employee',
  })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['gr.create', 'qc.inspect', 'stock.count'],
    description: 'Fine-grained warehouse permission keys (overrides role default)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['wh-uuid-1', 'wh-uuid-2'],
    description:
      'Warehouse IDs this user can operate in. Empty / omitted = access to all warehouses in the tenant.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  warehouseIds?: string[];
}
