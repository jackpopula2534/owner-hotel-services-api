import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateAddonPurchaseDto {
  @ApiProperty({
    example: 'CAMP_3D_MAP',
    description: 'รหัส add-on ที่ต้องการซื้อ (ราคาดึงจากแคตตาล็อกฝั่งเซิร์ฟเวอร์)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Z0-9_]+$/)
  addonCode: string;
}
