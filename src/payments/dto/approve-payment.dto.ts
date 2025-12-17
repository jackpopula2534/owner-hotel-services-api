import { IsString } from 'class-validator';

export class ApprovePaymentDto {
  @IsString()
  adminId: string;
}


