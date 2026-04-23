import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ArrayUnique,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Procurement roles.
 * - procurement_manager: head of procurement, usually highest approvalLimit
 * - buyer:               enters PR / RFQ / PO, compares quotes
 * - approver:            approves documents within assigned limit
 * - receiver:            checks incoming goods, signs GRN / QC
 */
export const PROCUREMENT_ROLES = [
  'procurement_manager',
  'buyer',
  'approver',
  'receiver',
] as const;

export type ProcurementRole = (typeof PROCUREMENT_ROLES)[number];

export class CreateProcurementUserDto {
  @ApiProperty({ example: 'buyer@hotel.com', description: 'Login email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    example: 'buyer',
    enum: PROCUREMENT_ROLES,
    description: 'Procurement role',
  })
  @IsString()
  @IsIn(PROCUREMENT_ROLES as unknown as string[])
  role!: ProcurementRole;

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
    example: 50000,
    description: 'Personal approval limit (THB). null = inherit role default',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  approvalLimit?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['pr.create', 'po.approve', 'supplier.manage'],
    description: 'Fine-grained procurement permission keys',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
