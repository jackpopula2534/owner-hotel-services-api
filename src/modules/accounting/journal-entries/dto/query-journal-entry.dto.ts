import { IsOptional, IsEnum, IsString, IsUUID, IsDateString, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { JournalSourceTypeEnum } from './create-journal-entry.dto';

export enum JournalEntryStatusEnum {
  DRAFT = 'DRAFT',
  POSTED = 'POSTED',
  REVERSED = 'REVERSED',
  VOID = 'VOID',
}

export class QueryJournalEntryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
  @ApiPropertyOptional({ enum: JournalEntryStatusEnum })
  @IsOptional()
  @IsEnum(JournalEntryStatusEnum)
  status?: JournalEntryStatusEnum;
  @ApiPropertyOptional({ enum: JournalSourceTypeEnum })
  @IsOptional()
  @IsEnum(JournalSourceTypeEnum)
  sourceType?: JournalSourceTypeEnum;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
