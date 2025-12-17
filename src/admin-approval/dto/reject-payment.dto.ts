import { IsString, IsOptional } from 'class-validator';

export class RejectPaymentDto {
  @IsString()
  adminId: string;

  @IsString()
  @IsOptional()
  reason?: string;
}


