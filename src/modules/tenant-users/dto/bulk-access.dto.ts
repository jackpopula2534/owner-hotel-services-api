import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TERMINAL_KEYS, type TerminalKey } from '../terminal-registry';
import { TerminalGrantDto } from './terminal-grant.dto';

export class BulkAccessDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  userIds!: string[];

  @ApiPropertyOptional({ type: TerminalGrantDto, description: 'Grant this terminal/role to all' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TerminalGrantDto)
  grant?: TerminalGrantDto;

  @ApiPropertyOptional({ enum: TERMINAL_KEYS, description: 'Revoke this terminal from all' })
  @IsOptional()
  @IsString()
  @IsIn(TERMINAL_KEYS as unknown as string[])
  revoke?: TerminalKey;
}
