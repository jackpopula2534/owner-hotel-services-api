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
    type: [PublicPlanFeatureDto],
    description: 'Optional add-on features',
  })
  addOnFeatures?: PublicPlanFeatureDto[];
}

export class PublicPlansListDto {
  @ApiProperty({ type: [PublicPlanDto] })
  data: PublicPlanDto[];

  @ApiProperty({ example: 3 })
  total: number;
}
