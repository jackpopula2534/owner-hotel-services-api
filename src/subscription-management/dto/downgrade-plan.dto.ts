import { IsString } from 'class-validator';

export class DowngradePlanDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  newPlanId: string;
}


