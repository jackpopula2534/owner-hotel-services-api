import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsInt,
  Min,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

// ============ Request DTOs ============

export class UpdateSubscriptionFeatureDto {
  @ApiPropertyOptional({ description: 'New quantity for the add-on', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ description: 'New price for the add-on', example: 990 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Reason for the change' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Effective date for the change', example: '2024-02-01' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}

export class RemoveSubscriptionFeatureDto {
  @ApiPropertyOptional({ description: 'Reason for removal' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Effective date for removal', example: '2024-02-01' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Create credit for unused portion', default: true })
  @IsOptional()
  @IsBoolean()
  createCredit?: boolean;
}

export class AddSubscriptionFeatureDto {
  @ApiProperty({ description: 'Subscription ID (UUID or SUB-xxx code)' })
  @IsString()
  subscriptionId: string;

  @ApiProperty({ description: 'Feature ID (UUID)' })
  @IsString()
  featureId: string;

  @ApiPropertyOptional({ description: 'Quantity', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Custom price (if different from feature default)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Effective date', example: '2024-02-01' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @ApiPropertyOptional({ description: 'Create invoice for this add-on', default: true })
  @IsOptional()
  @IsBoolean()
  createInvoice?: boolean;
}

// ============ Response DTOs ============

export class SubscriptionFeatureItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'uuid-feature' })
  featureId: string;

  @ApiProperty({ example: 'Extra Analytics' })
  featureName: string;

  @ApiProperty({ example: 'รายงานและ Analytics ขั้นสูง' })
  featureDescription: string;

  @ApiProperty({ example: 'module' })
  featureType: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ example: 990 })
  price: number;

  @ApiProperty({ example: 990 })
  totalPrice: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2024-01-01' })
  createdAt: string;
}

export class SubscriptionFeaturesListDto {
  @ApiProperty({ example: 'SUB-001' })
  subscriptionId: string;

  @ApiProperty({ example: 'โรงแรมสุขใจ' })
  hotelName: string;

  @ApiProperty({ example: 'Professional' })
  planName: string;

  @ApiProperty({ example: 4990 })
  planPrice: number;

  @ApiProperty({ type: [SubscriptionFeatureItemDto] })
  addons: SubscriptionFeatureItemDto[];

  @ApiProperty({ example: 2480 })
  totalAddonPrice: number;

  @ApiProperty({ example: 7470 })
  totalMonthlyPrice: number;
}

export class UpdateFeatureResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Add-on updated successfully' })
  message: string;

  @ApiProperty()
  data: {
    id: string;
    featureName: string;
    oldPrice: number;
    newPrice: number;
    oldQuantity: number;
    newQuantity: number;
    proratedAmount: number;
    effectiveDate: string;
  };
}

export class RemoveFeatureResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Add-on removed successfully' })
  message: string;

  @ApiProperty()
  data: {
    removedFeature: string;
    creditAmount: number;
    creditCreated: boolean;
    effectiveDate: string;
  };
}

export class AddFeatureResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Add-on added successfully' })
  message: string;

  @ApiProperty()
  data: {
    id: string;
    featureName: string;
    price: number;
    quantity: number;
    invoiceCreated: boolean;
    invoiceNo?: string;
    proratedAmount?: number;
  };
}

// ============ Log DTOs ============

export class FeatureLogItemDto {
  @ApiProperty({ example: 'uuid-1234' })
  id: string;

  @ApiProperty({ example: 'Extra Analytics' })
  featureName: string;

  @ApiProperty({ enum: ['added', 'updated', 'removed'], example: 'updated' })
  action: string;

  @ApiPropertyOptional({ example: 500 })
  oldPrice?: number;

  @ApiPropertyOptional({ example: 990 })
  newPrice?: number;

  @ApiPropertyOptional({ example: 1 })
  oldQuantity?: number;

  @ApiPropertyOptional({ example: 5 })
  newQuantity?: number;

  @ApiPropertyOptional({ example: 245 })
  proratedAmount?: number;

  @ApiPropertyOptional({ example: 'Customer request' })
  reason?: string;

  @ApiProperty({ example: '2024-01-25T10:30:00Z' })
  createdAt: string;

  @ApiPropertyOptional({ example: 'admin@staysync.io' })
  createdBy?: string;
}

export class FeatureLogsListDto {
  @ApiProperty({ example: 'SUB-001' })
  subscriptionId: string;

  @ApiProperty({ type: [FeatureLogItemDto] })
  logs: FeatureLogItemDto[];

  @ApiProperty({ example: 10 })
  total: number;
}
