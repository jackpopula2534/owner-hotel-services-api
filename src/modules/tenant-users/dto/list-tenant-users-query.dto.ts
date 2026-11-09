import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TERMINAL_KEYS, type TerminalKey } from '../terminal-registry';

export const USER_STATUSES = ['active', 'suspended', 'inactive', 'expired'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export class ListTenantUsersQueryDto {
  @ApiPropertyOptional({ description: 'Search name / email / employee code' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: TERMINAL_KEYS })
  @IsOptional()
  @IsString()
  @IsIn(TERMINAL_KEYS as unknown as string[])
  terminal?: TerminalKey;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(USER_STATUSES as unknown as string[])
  status?: UserStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 25;
}

export class ImportableEmployeesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;
}
