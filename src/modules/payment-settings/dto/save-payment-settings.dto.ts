import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DEPOSIT_TYPES, DepositType } from '../../website/website-deposit';

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

  @ApiPropertyOptional({
    description: 'มัดจำตอนแขกจอง+โอน PromptPay ผ่านหน้าเว็บ: full = โอนเต็ม, percentage = % ของยอดรวม, fixed = บาทต่อการจอง',
    enum: DEPOSIT_TYPES,
    example: 'percentage',
  })
  @IsOptional()
  @IsIn(DEPOSIT_TYPES)
  websiteDepositType?: DepositType;

  @ApiPropertyOptional({ description: '% (1–99) หรือบาท ตาม websiteDepositType', example: 30, nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  websiteDepositValue?: number | null;
}
