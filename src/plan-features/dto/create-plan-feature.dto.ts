import { IsString, IsUUID } from 'class-validator';

export class CreatePlanFeatureDto {
  @IsUUID()
  planId: string;

  @IsUUID()
  featureId: string;
}


