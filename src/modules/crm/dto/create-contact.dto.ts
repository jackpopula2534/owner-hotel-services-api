import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const CONTACT_TYPES = ['individual', 'corporate', 'agent'] as const;
const CHANNELS = ['email', 'line', 'sms', 'push'] as const;
const SEGMENTS = ['vip', 'regular', 'churn_risk', 'new', 'corporate', 'loyal'] as const;

export class CreateContactDto {
  @ApiProperty({ required: false, description: 'Link to existing Guest record' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({ enum: CONTACT_TYPES, default: 'individual' })
  @IsOptional()
  @IsEnum(CONTACT_TYPES)
  contactType?: (typeof CONTACT_TYPES)[number];

  @ApiProperty({ enum: SEGMENTS, required: false })
  @IsOptional()
  @IsEnum(SEGMENTS)
  segment?: (typeof SEGMENTS)[number];

  @ApiProperty({ enum: CHANNELS, required: false })
  @IsOptional()
  @IsEnum(CHANNELS)
  preferredChannel?: (typeof CHANNELS)[number];

  @ApiProperty({ required: false, description: 'JSON-encoded tags array' })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rfmRecency?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rfmFrequency?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rfmMonetary?: number;
}

export class UpdateContactDto extends CreateContactDto {}

export class QueryContactsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ enum: SEGMENTS, required: false })
  @IsOptional()
  @IsEnum(SEGMENTS)
  segment?: (typeof SEGMENTS)[number];

  @ApiProperty({ enum: CONTACT_TYPES, required: false })
  @IsOptional()
  @IsEnum(CONTACT_TYPES)
  contactType?: (typeof CONTACT_TYPES)[number];

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  page?: string;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  limit?: string;
}
