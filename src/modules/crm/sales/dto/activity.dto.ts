import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting', 'task'] as const;

export class CreateActivityDto {
  @ApiProperty({ enum: ACTIVITY_TYPES })
  @IsEnum(ACTIVITY_TYPES)
  type: (typeof ACTIVITY_TYPES)[number];

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  body?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  dealId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @ApiProperty({ required: false, description: 'For task activities' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}

export class CompleteActivityDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}
