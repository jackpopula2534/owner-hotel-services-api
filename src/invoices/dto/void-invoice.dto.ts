import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class VoidInvoiceDto {
  @ApiPropertyOptional({
    example: 'ออกใบแจ้งหนี้ผิด ต้องการยกเลิกเพื่อออกใหม่',
    description: 'Reason for voiding the invoice (optional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
