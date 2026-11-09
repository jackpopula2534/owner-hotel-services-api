import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TERMINAL_KEYS, type TerminalKey } from '../terminal-registry';

/** หนึ่งสิทธิ์เข้าใช้ต่อระบบย่อย — role ถูกตรวจกับ registry ใน service (ขึ้นกับ terminal) */
export class TerminalGrantDto {
  @ApiProperty({ enum: TERMINAL_KEYS, example: 'hotel-terminal' })
  @IsString()
  @IsIn(TERMINAL_KEYS as unknown as string[])
  terminal!: TerminalKey;

  @ApiProperty({ example: 'front_desk', description: 'Role within that terminal' })
  @IsString()
  @MaxLength(64)
  role!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Permission override; omitted = role default',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({ example: 50000, description: 'Procurement approval limit (THB)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  approvalLimit?: number | null;

  @ApiPropertyOptional({ type: [String], description: 'Scope ids, e.g. warehouseIds' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  scopeIds?: string[] | null;
}
