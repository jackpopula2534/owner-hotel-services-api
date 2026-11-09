import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HOTEL_TERMINAL_ROLES, HotelTerminalRole } from './create-hotel-terminal-user.dto';

export class BulkImportItemDto {
  @ApiProperty({ description: 'HR Employee.id' })
  @IsString()
  employeeId!: string;

  @ApiProperty({ enum: HOTEL_TERMINAL_ROLES, example: 'housekeeper' })
  @IsString()
  @IsIn(HOTEL_TERMINAL_ROLES as unknown as string[])
  role!: HotelTerminalRole;

  @ApiPropertyOptional({ description: 'Override propertyId' })
  @IsOptional()
  @IsString()
  propertyId?: string;
}

export class BulkImportFromEmployeesDto {
  @ApiProperty({
    type: [BulkImportItemDto],
    description: 'Employees to import with their assigned roles',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkImportItemDto)
  items!: BulkImportItemDto[];

  @ApiProperty({
    minLength: 8,
    description:
      'Default password applied to all imported users. Each user should change it on first login.',
  })
  @IsString()
  @MinLength(8)
  defaultPassword!: string;
}
