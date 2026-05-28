import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const JOURNEY_TRIGGERS = [
  'booking.created',
  'booking.checked_in',
  'booking.checked_out',
  'guest.birthday',
  'manual',
] as const;

export type JourneyStepType = 'wait' | 'send' | 'tag';

/**
 * One step in a journey. Keep schema flat for JSON storage.
 *
 * Wait step      : { type: 'wait', delayHours: 24 }
 * Send step      : { type: 'send', channel: 'email', templateKey: 'pre-stay-welcome', subject: '...' }
 * Tag step       : { type: 'tag', segment: 'engaged' }
 */
export class JourneyStepDto {
  @ApiProperty({ enum: ['wait', 'send', 'tag'] })
  @IsEnum(['wait', 'send', 'tag'])
  type: JourneyStepType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  delayHours?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  templateKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bodyOverride?: string;

  @ApiProperty({ required: false, description: 'Tag/segment to assign' })
  @IsOptional()
  @IsString()
  segment?: string;
}

export class CreateJourneyDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: JOURNEY_TRIGGERS })
  @IsEnum(JOURNEY_TRIGGERS)
  triggerEvent: (typeof JOURNEY_TRIGGERS)[number];

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [JourneyStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JourneyStepDto)
  steps: JourneyStepDto[];
}

export class UpdateJourneyDto {
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
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [JourneyStepDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JourneyStepDto)
  steps?: JourneyStepDto[];
}
