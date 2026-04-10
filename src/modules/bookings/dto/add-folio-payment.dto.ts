import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddFolioPaymentDto {
  @ApiProperty({ example: 1500, description: 'จำนวนเงินที่ชำระ' })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  amount: number;

  @ApiProperty({
    enum: ['transfer', 'qr', 'cash'],
    example: 'cash',
    description: 'วิธีการชำระเงิน: transfer=โอนเงิน, qr=QR Code, cash=เงินสด',
  })
  @IsEnum(['transfer', 'qr', 'cash'])
  @IsNotEmpty()
  method: 'transfer' | 'qr' | 'cash';

  @ApiPropertyOptional({ example: 'ชำระเงินสดที่เคาน์เตอร์' })
  @IsString()
  @IsOptional()
  notes?: string;
}
