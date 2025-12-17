import { IsString } from 'class-validator';

export class UpgradePlanDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  newPlanId: string;
}


