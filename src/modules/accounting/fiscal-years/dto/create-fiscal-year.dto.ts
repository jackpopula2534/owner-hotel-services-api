import { IsNotEmpty, IsUUID, IsInt, Min, Max, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateFiscalYearDto {
  @ApiProperty({ description: 'Property ID' })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({ description: 'ปีบัญชี (ค.ศ.)', example: 2025 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year: number;

  @ApiProperty({ description: 'วันเริ่มต้นปีบัญชี', example: '2025-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'วันสิ้นสุดปีบัญชี', example: '2025-12-31' })
  @IsDateString()
  endDate: string;
}
