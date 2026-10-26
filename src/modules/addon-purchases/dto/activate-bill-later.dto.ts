import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';
import { CreateAddonPurchaseDto } from './create-addon-purchase.dto';

export class ActivateBillLaterDto extends CreateAddonPurchaseDto {
  @ApiProperty({
    example: true,
    description: 'ลูกค้ายอมรับเงื่อนไข: เก็บเงินรอบบิลถัดไป + สัญญาขั้นต่ำ 1 รอบ',
  })
  @IsBoolean()
  @Equals(true, { message: 'ต้องยอมรับเงื่อนไขก่อนเปิดใช้งาน' })
  accept: boolean;
}
