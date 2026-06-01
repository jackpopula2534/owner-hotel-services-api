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
 * Accounting roles.
 * - chief_accountant: head of accounting, full access
 * - accountant:       general accounting tasks
 * - ap_clerk:         accounts payable
 * - ar_clerk:         accounts receivable
 * - auditor:          read-only audit access
 */
export const ACCOUNTING_ROLES = [
  'chief_accountant',
  'accountant',
  'ap_clerk',
  'ar_clerk',
  'auditor',
] as const;

export type AccountingRole = (typeof ACCOUNTING_ROLES)[number];

/** Default permission matrix by role. */
export const DEFAULT_ACCOUNTING_PERMISSIONS: Record<AccountingRole, string[]> = {
  chief_accountant: [
    'journal.view',
    'journal.create',
    'journal.approve',
    'ar.view',
    'ar.manage',
    'ap.view',
    'ap.manage',
    'chart.view',
    'chart.manage',
    'asset.view',
    'asset.manage',
    'report.view',
    'report.export',
    'night_audit.view',
    'night_audit.run',
    'user.manage',
  ],
  accountant: [
    'journal.view',
    'journal.create',
    'ar.view',
    'ar.manage',
    'ap.view',
    'ap.manage',
    'chart.view',
    'asset.view',
    'report.view',
    'report.export',
  ],
  ap_clerk: ['ap.view', 'ap.manage', 'journal.view', 'report.view'],
  ar_clerk: ['ar.view', 'ar.manage', 'journal.view', 'report.view'],
  auditor: [
    'journal.view',
    'ar.view',
    'ap.view',
    'chart.view',
    'asset.view',
    'report.view',
    'report.export',
    'night_audit.view',
  ],
};

export class CreateAccountingUserDto {
  @ApiProperty({ example: 'accountant@hotel.com', description: 'Login email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    example: 'accountant',
    enum: ACCOUNTING_ROLES,
    description: 'Accounting role',
  })
  @IsString()
  @IsIn(ACCOUNTING_ROLES as unknown as string[])
  role!: AccountingRole;

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

  @ApiPropertyOptional({ example: 'EMP-001', description: 'Link to HR Employee' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['journal.view', 'ar.manage'],
    description: 'Fine-grained permission keys (overrides role default)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
