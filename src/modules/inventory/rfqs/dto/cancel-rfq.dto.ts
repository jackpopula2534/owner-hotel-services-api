import { IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelRfqDto {
  @ApiProperty({
    example: 'Supplier ทั้งหมดปฏิเสธ ขอยกเลิกแล้วเปิดรอบใหม่',
    description: 'เหตุผลการยกเลิก',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
