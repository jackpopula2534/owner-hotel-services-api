import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SavePaymentSettingsDto {
  @ApiProperty({ description: 'เปิดใช้ PromptPay หรือไม่', example: true })
  @IsBoolean()
  promptpayEnabled: boolean;

  @ApiPropertyOptional({
    description: 'หมายเลข PromptPay (เบอร์โทรศัพท์ หรือ เลขบัตรประชาชน)',
    example: '0812345678',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  promptpayId?: string;

  @ApiPropertyOptional({ description: 'ชื่อบัญชี PromptPay', example: 'นายสมชาย ใจดี' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  promptpayAccountName?: string;

  @ApiProperty({ description: 'เปิดรับโอนผ่านบัญชีธนาคารหรือไม่', example: true })
  @IsBoolean()
  bankTransferEnabled: boolean;

  @ApiProperty({ description: 'เปิดรับชำระเงินสดหรือไม่', example: true })
  @IsBoolean()
  cashEnabled: boolean;

  @ApiPropertyOptional({
    description: 'คำแนะนำการชำระเงินสด',
    example: 'ชำระที่เคาน์เตอร์ Front Desk',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cashInstructions?: string;
}
