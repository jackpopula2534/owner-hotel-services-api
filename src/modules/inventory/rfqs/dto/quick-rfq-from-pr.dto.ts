import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class QuickRfqFromPrDto {
  @ApiProperty({
    example: 'pr-uuid-1',
    description: 'PR id ที่ต้องการส่ง RFQ ไปยังซัพพลายเออร์',
  })
  @IsString()
  purchaseRequisitionId!: string;

  @ApiProperty({
    example: ['sup-uuid-1', 'sup-uuid-2'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'ต้องระบุซัพพลายเออร์อย่างน้อย 1 ราย' })
  @ArrayMinSize(1)
  @IsString({ each: true })
  supplierIds!: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
