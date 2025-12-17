import { IsString, IsNumber, IsInt, IsBoolean, IsOptional } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsNumber()
  priceMonthly: number;

  @IsInt()
  maxRooms: number;

  @IsInt()
  maxUsers: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}


