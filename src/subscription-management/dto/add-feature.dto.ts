import { IsString } from 'class-validator';

export class AddFeatureDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  featureId: string;
}


