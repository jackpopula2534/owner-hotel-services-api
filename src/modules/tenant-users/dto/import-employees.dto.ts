import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TerminalGrantDto } from './terminal-grant.dto';

export class ImportEmployeeItemDto {
  @ApiProperty({ description: 'HR Employee.id' })
  @IsString()
  hrEmployeeId!: string;

  @ApiProperty({ type: [TerminalGrantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TerminalGrantDto)
  grants!: TerminalGrantDto[];
}

export class ImportEmployeesDto {
  @ApiProperty({ type: [ImportEmployeeItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportEmployeeItemDto)
  items!: ImportEmployeeItemDto[];

  @ApiProperty({ minLength: 8, description: 'Shared initial password for every imported user' })
  @IsString()
  @MinLength(8)
  defaultPassword!: string;
}
