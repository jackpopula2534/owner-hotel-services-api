import { IsString, IsDateString, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus } from '../entities/subscription.entity';

export class CreateSubscriptionDto {
  @ApiPropertyOptional({
    example: 'SUB-001',
    description: 'Unique subscription code for tracking',
  })
  @IsString()
  @IsOptional()
  subscriptionCode?: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the tenant (hotel) subscribing',
  })
  @IsString()
  tenantId: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the plan being subscribed to',
  })
  @IsString()
  planId: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the previous plan if upgrading/downgrading',
  })
  @IsString()
  @IsOptional()
  previousPlanId?: string;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Subscription status (active, trial, expired, pending)',
  })
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  status?: SubscriptionStatus;

  @ApiProperty({
    example: '2026-03-01T00:00:00Z',
    description: 'Subscription start date',
  })
  @IsDateString()
  startDate: Date;

  @ApiProperty({
    example: '2026-04-01T00:00:00Z',
    description: 'Subscription end date',
  })
  @IsDateString()
  endDate: Date;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether subscription auto-renews at end date',
  })
  @IsBoolean()
  @IsOptional()
  autoRenew?: boolean;
}
