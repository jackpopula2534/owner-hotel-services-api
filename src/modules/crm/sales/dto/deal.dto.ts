import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEAL_STAGES = ['discovery', 'quoted', 'negotiation', 'won', 'lost'] as const;

/** Default win probability per stage — used as the initial value on stage move. */
export const STAGE_DEFAULT_PROBABILITY: Record<(typeof DEAL_STAGES)[number], number> = {
  discovery: 20,
  quoted: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};

export class CreateDealDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  partySize?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  checkInDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  checkOutDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateDealDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expectedCloseDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class MoveStageDto {
  @ApiProperty({ enum: DEAL_STAGES })
  @IsEnum(DEAL_STAGES)
  stage: (typeof DEAL_STAGES)[number];

  @ApiProperty({ required: false, description: 'Required when moving to "lost"' })
  @IsOptional()
  @IsString()
  lostReason?: string;
}

export class QueryDealsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ enum: DEAL_STAGES, required: false })
  @IsOptional()
  @IsEnum(DEAL_STAGES)
  stage?: (typeof DEAL_STAGES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  page?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  limit?: string;
}
