import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpgradePlanDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  newPlanId: string;

  /**
   * Whether to issue a prorated upgrade invoice (UPG-…).
   * Defaults to true. The checkout flow (trial → paid) passes false because it
   * issues its own full-month invoice; creating the prorate invoice here too
   * produces a duplicate.
   */
  @IsOptional()
  @IsBoolean()
  createInvoice?: boolean;
}
