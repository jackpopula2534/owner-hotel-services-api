import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CloseCashDrawerDto {
  @ApiProperty({ description: 'ยอดเงินที่นับได้จริง (blind count)', example: 4067 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  countedAmount: number;

  @ApiPropertyOptional({ description: 'หมายเหตุ (บังคับเมื่อยอดนับไม่ตรงระบบ)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'สรุปการนับแยกชนิดธนบัตร/เหรียญ เช่น "1000x2, 500x3"',
    example: '1000x2, 500x3, 100x4',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  denominations?: string;
}
