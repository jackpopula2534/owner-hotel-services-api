import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsOptional, IsEnum } from 'class-validator';

export class QuarantineLotDto {
  @ApiProperty({ description: 'Reason for quarantine (min 3 chars)', minLength: 3 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class ReleaseLotDto {
  @ApiPropertyOptional({ description: 'Notes on release' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export enum DisposalReason {
  EXPIRED = 'EXPIRED',
  DAMAGED = 'DAMAGED',
  CONTAMINATED = 'CONTAMINATED',
  OTHER = 'OTHER',
}

export class DisposeLotDto {
  @ApiProperty({ description: 'Reason for disposal', enum: DisposalReason })
  @IsEnum(DisposalReason)
  reason: DisposalReason;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
