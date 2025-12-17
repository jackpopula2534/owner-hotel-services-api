import { IsString, IsNumber, IsInt, IsOptional } from 'class-validator';

export class CreateSubscriptionFeatureDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  featureId: string;

  @IsInt()
  @IsOptional()
  quantity?: number;

  @IsNumber()
  price: number;
}


