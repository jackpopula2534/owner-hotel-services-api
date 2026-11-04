import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateItemDto } from './create-item.dto';

export class UpdateItemDto extends PartialType(CreateItemDto) {
  @ApiPropertyOptional({
    description: 'false = ปิดใช้งาน (ซ่อนจากการเบิก/สั่งซื้อ แต่ประวัติและสต็อกยังอยู่)',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
