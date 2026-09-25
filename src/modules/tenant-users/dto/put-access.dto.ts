import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TerminalGrantDto } from './terminal-grant.dto';

/** แทนที่สิทธิ์ทั้งชุด — terminal ที่ไม่อยู่ในรายการจะถูกถอน */
export class PutAccessDto {
  @ApiProperty({ type: [TerminalGrantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TerminalGrantDto)
  grants!: TerminalGrantDto[];
}
