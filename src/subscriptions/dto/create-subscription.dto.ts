import { IsString, IsDateString, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { SubscriptionStatus } from '../entities/subscription.entity';

export class CreateSubscriptionDto {
  @IsString()
  @IsOptional()
  subscriptionCode?: string;

  @IsString()
  tenantId: string;

  @IsString()
  planId: string;

  @IsString()
  @IsOptional()
  previousPlanId?: string;

  @IsEnum(SubscriptionStatus)
  @IsOptional()
  status?: SubscriptionStatus;

  @IsDateString()
  startDate: Date;

  @IsDateString()
  endDate: Date;

  @IsBoolean()
  @IsOptional()
  autoRenew?: boolean;
}


