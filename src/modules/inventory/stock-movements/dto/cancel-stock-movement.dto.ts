import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelStockMovementDto {
  @ApiProperty({
    description: 'Reason for cancelling and reversing this stock movement',
    example: 'บันทึกผิดคลัง',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  reason: string;
}
