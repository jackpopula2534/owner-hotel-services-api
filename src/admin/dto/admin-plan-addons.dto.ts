import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * DTOs for Admin → Plans → Add-ons management.
 *
 * Mirrors the Plan-Features pattern (admin-plans.dto.ts) so the frontend can
 * reuse the same UX as PlanFeatureManager.
 */

export class PlanAddonItemDto {
  @ApiProperty({ example: 'uuid-1234', description: 'Add-on ID (FK to add_ons.id)' })
  id: string;

  @ApiProperty({ example: 'uuid-5678', description: 'plan_addons join row ID' })
  planAddonId: string;

  @ApiProperty({ example: 'POS_MODULE' })
  addonCode: string;

  @ApiProperty({ example: 'POS System' })
  addonName: string;

  @ApiProperty({ example: 790, description: 'Price (THB) per billing cycle' })
  price: number;

  @ApiProperty({ example: 'monthly', enum: ['monthly', 'yearly', 'one_time'] })
  billingCycle: string;

  @ApiProperty({ example: 'Restaurant', required: false })
  category?: string | null;
}

export class AvailableAddonItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'POS_MODULE' })
  code: string;

  @ApiProperty({ example: 'POS System' })
  name: string;

  @ApiProperty({ example: 'รับออเดอร์ ส่งครัว ชำระเงิน', required: false })
  description?: string | null;

  @ApiProperty({ example: 790 })
  price: number;

  @ApiProperty({ example: 'monthly' })
  billingCycle: string;

  @ApiProperty({ example: 'Restaurant', required: false })
  category?: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;
}

export class PlanAddonsResponseDto {
  @ApiProperty({ type: [PlanAddonItemDto], description: 'Add-ons currently assigned to this plan' })
  assignedAddons: PlanAddonItemDto[];

  @ApiProperty({
    type: [AvailableAddonItemDto],
    description: 'Active Add-ons in the catalog that are not yet assigned to this plan',
  })
  availableAddons: AvailableAddonItemDto[];
}

export class AssignAddonToPlanDto {
  @ApiProperty({ description: 'Add-on ID to assign to the plan', example: 'uuid-1234' })
  @IsString()
  addonId: string;
}
