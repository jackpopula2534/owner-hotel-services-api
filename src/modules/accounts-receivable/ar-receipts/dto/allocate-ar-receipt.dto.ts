import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArReceiptAllocationDto } from './create-ar-receipt.dto';

export class AllocateArReceiptDto {
  @ApiProperty({
    description: 'ใบแจ้งหนี้ที่จะตัดจากเงินที่ยังไม่ได้จัดสรร',
    type: [ArReceiptAllocationDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ArReceiptAllocationDto)
  allocations: ArReceiptAllocationDto[];
}
