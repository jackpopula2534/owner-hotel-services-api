import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Public Plan Response DTO for Sales Page
 * Returns only necessary information for displaying plans to potential customers
 */
export class PublicPlanFeatureDto {
  @ApiProperty({ example: 'extra-analytics' })
  code: string;

  @ApiProperty({ example: 'Extra Analytics' })
  name: string;

  @ApiProperty({ example: 990 })
  priceMonthly: number;
}

/**
 * Add-on bundled with a plan (admin-curated via /admin/plans/:id/addons).
 *
 * Distinct from `PublicPlanFeatureDto` — this comes from the `add_ons`
 * catalog (managed in /admin/addons) rather than the `features` table.
 *
 * `price` is informational only — once an add-on is included with a plan
 * it is granted to subscribers without an extra charge; the plan's monthly
 * price already accounts for it.
 */
export class PublicPlanAddonDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'POS_MODULE' })
  code: string;

  @ApiProperty({ example: 'POS System' })
  name: string;

  @ApiPropertyOptional({ example: 'ระบบ POS ครบวงจร' })
  description?: string;

  @ApiProperty({ example: 790 })
  price: number;

  @ApiProperty({
    example: 'monthly',
    enum: ['monthly', 'yearly', 'one_time'],
  })
  billingCycle: string;

  @ApiPropertyOptional({ example: 'Restaurant' })
  category?: string;

  @ApiPropertyOptional({ example: 'shopping-cart' })
  icon?: string;
}

export class PublicPlanDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'M' })
  code: string;

  @ApiProperty({ example: 'Professional' })
  name: string;

  @ApiPropertyOptional({
    example: 'เริ่มต้นใช้งานได้ทันที พร้อมทดลองใช้ฟรี 14 วัน',
  })
  description?: string;

  @ApiProperty({ example: 4990 })
  priceMonthly: number;

  @ApiPropertyOptional({
    example: 50898,
    description: 'Yearly price (if available)',
  })
  priceYearly?: number;

  @ApiPropertyOptional({
    example: 15,
    description: 'Discount percentage for yearly subscription',
  })
  yearlyDiscountPercent?: number;

  @ApiPropertyOptional({
    example: 8982,
    description: 'Amount saved when choosing yearly subscription',
  })
  yearlySavings?: number;

  @ApiProperty({ example: 50 })
  maxRooms: number;

  @ApiProperty({ example: 10 })
  maxUsers: number;

  @ApiPropertyOptional({ example: 2 })
  displayOrder?: number;

  @ApiPropertyOptional({ example: true })
  isPopular?: boolean;

  @ApiPropertyOptional({ example: 'ยอดนิยม' })
  badge?: string;

  @ApiPropertyOptional({ example: '#8B5CF6' })
  highlightColor?: string;

  @ApiPropertyOptional({
    example: ['รองรับ 50 ห้อง', 'ผู้ใช้งาน 10 คน', 'ระบบจองครบครัน'],
    description: 'Array of feature descriptions',
  })
  features?: string[];

  @ApiPropertyOptional({ example: 'เริ่มใช้งาน' })
  buttonText?: string;

  @ApiPropertyOptional({
    example: 'ระบบจัดการครบจบในที่เดียว',
    description: 'Short marketing subtitle',
  })
  subtitle?: string;

  @ApiPropertyOptional({
    example: 'โรงแรมขนาดเล็ก 1-20 ห้อง',
    description: 'Who this plan is best for',
  })
  targetAudience?: string;

  @ApiPropertyOptional({
    example: '~฿100/ห้อง/เดือน',
    description: 'Price per room label',
  })
  pricePerRoom?: string;

  @ApiPropertyOptional({
    type: [PublicPlanFeatureDto],
    description: 'Optional add-on features',
  })
  addOnFeatures?: PublicPlanFeatureDto[];

  @ApiPropertyOptional({
    type: [PublicPlanAddonDto],
    description:
      'Add-ons bundled with this plan (no extra charge). Sourced from plan_addons join table — set by admin in /admin/plans/:id/addons.',
  })
  includedAddOns?: PublicPlanAddonDto[];
}

export class PublicPlansListDto {
  @ApiProperty({ type: [PublicPlanDto] })
  data: PublicPlanDto[];

  @ApiProperty({ example: 3 })
  total: number;
}
