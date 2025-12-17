import { IsString, IsInt, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { TenantStatus } from '../entities/tenant.entity';

export class CreateTenantDto {
  @IsString()
  name: string;

  @IsInt()
  @IsOptional()
  roomCount?: number;

  @IsEnum(TenantStatus)
  @IsOptional()
  status?: TenantStatus;

  @IsDateString()
  @IsOptional()
  trialEndsAt?: Date;
}


