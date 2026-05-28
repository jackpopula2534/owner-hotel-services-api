import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const CAMPAIGN_CHANNELS = ['email', 'line', 'sms', 'push'] as const;
export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'running',
  'completed',
  'cancelled',
] as const;

/**
 * Segmentation rules. All fields are optional and AND-combined.
 * Stored as JSON in `CrmCampaign.audienceQuery`.
 */
export class AudienceQueryDto {
  @ApiProperty({ required: false, isArray: true, example: ['vip', 'loyal'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  segments?: string[];

  @ApiProperty({ required: false, isArray: true, example: ['individual'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contactTypes?: string[];

  @ApiProperty({ required: false, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredChannels?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  minLifetimeValue?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  minTotalStays?: number;
}

export class CreateCampaignDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: CAMPAIGN_CHANNELS })
  @IsEnum(CAMPAIGN_CHANNELS)
  channel: (typeof CAMPAIGN_CHANNELS)[number];

  @ApiProperty({ required: false, description: 'Handlebars template key' })
  @IsOptional()
  @IsString()
  templateKey?: string;

  @ApiProperty({ required: false, description: 'Required for email channel' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bodyOverride?: string;

  @ApiProperty({ required: false, description: 'JSON-stringified AudienceQueryDto' })
  @IsOptional()
  @IsString()
  audienceQuery?: string;

  @ApiProperty({ required: false, description: 'ISO datetime for delayed send' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class UpdateCampaignDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bodyOverride?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  templateKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  audienceQuery?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class QueryCampaignsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ enum: CAMPAIGN_STATUSES, required: false })
  @IsOptional()
  @IsEnum(CAMPAIGN_STATUSES)
  status?: (typeof CAMPAIGN_STATUSES)[number];

  @ApiProperty({ enum: CAMPAIGN_CHANNELS, required: false })
  @IsOptional()
  @IsEnum(CAMPAIGN_CHANNELS)
  channel?: (typeof CAMPAIGN_CHANNELS)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  page?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  limit?: string;
}
