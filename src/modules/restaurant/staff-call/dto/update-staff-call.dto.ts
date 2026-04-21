import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum CallStatusDto {
  PENDING = 'PENDING',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED',
}

export class UpdateStaffCallDto {
  @ApiPropertyOptional({ enum: CallStatusDto })
  @IsEnum(CallStatusDto)
  @IsOptional()
  status?: CallStatusDto;

  @ApiPropertyOptional({ description: 'Resolution note' })
  @IsString()
  @IsOptional()
  resolution?: string;
}

export class AcknowledgeCallDto {
  @ApiPropertyOptional({ description: 'Staff member ID who acknowledged' })
  @IsString()
  @IsOptional()
  staffId?: string;
}

export class ResolveCallDto {
  @ApiPropertyOptional({ description: 'Resolution note' })
  @IsString()
  @IsOptional()
  resolution?: string;

  @ApiPropertyOptional({ description: 'Staff member ID who resolved' })
  @IsString()
  @IsOptional()
  staffId?: string;
}
